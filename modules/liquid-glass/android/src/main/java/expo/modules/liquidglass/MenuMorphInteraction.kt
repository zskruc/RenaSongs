package expo.modules.liquidglass

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.os.Build
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.SeekBar
import com.facebook.react.uimanager.events.NativeGestureUtil
import expo.modules.kotlin.AppContext
import expo.modules.liquidglass.menumotion.MenuInteractionMotion
import expo.modules.liquidglass.menumotion.MenuInteractionRow
import kotlin.math.abs

/** Explicit finite rows only. Arbitrary RN content keeps its own gesture owner. */
internal class MenuMorphInteraction(private val host: ViewGroup, private val context: AppContext,
  private val density: Float, private val mapPoint: (Float, Float, FloatArray) -> Unit,
  private val requestFrame: () -> Unit, private val select: (String, Long) -> Unit) {
  var motion = MenuInteractionMotion(density)
    private set
  private var records: List<MenuMorphRowRecord> = emptyList()
  private var gestureRows: List<MenuInteractionRow> = emptyList()
  private var owning = false
  private var observing = false
  private var scrollCancelled = false
  private var selectionPending = false
  private var suppressUntilAllUp = false
  private var startY = 0f
  private var lastX = 0f
  private var lastY = 0f
  private var gestureId = 0L
  private val point = FloatArray(2)
  private val bounds = Rect()
  private val visibleBounds = Rect()
  private val hostLocation = IntArray(2)
  private val clippedPoint = FloatArray(2)
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  var selectionDispatches = 0L
    private set
  var gestureCancels = 0L
    private set
  val isGestureActive get() = owning || observing || suppressUntilAllUp

  fun setRows(value: List<MenuMorphRowRecord>?) { records = value?.take(256)?.toList() ?: emptyList() }
  fun reset() {
    cancel()
    motion = MenuInteractionMotion(density)
    selectionPending = false
    selectionDispatches = 0
    gestureCancels = 0
  }
  fun close() { cancel(); motion.release() }
  fun cancel() {
    if (owning) {
      val now = SystemClock.uptimeMillis()
      val event = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, lastX, lastY, 0)
      try { finishNative(event) } finally { event.recycle() }
    }
    if (observing) gestureCancels++
    observing = false
    scrollCancelled = false
    suppressUntilAllUp = false
    gestureRows = emptyList()
    motion.cancel()
  }

  fun dispatch(event: MotionEvent, ready: Boolean, passThrough: () -> Boolean): Boolean {
    lastX = event.x; lastY = event.y
    if (!ready) { if (owning || observing) cancel(); return false }
    if (suppressUntilAllUp) {
      if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
        finishNative(event)
        suppressUntilAllUp = false
      }
      return true
    }
    if (event.actionMasked == MotionEvent.ACTION_DOWN) begin(event)
    if (!observing) return if (selectionPending) true else passThrough()
    val ownedStream = owning
    mapPoint(event.x, event.y, point)
    when (event.actionMasked) {
      MotionEvent.ACTION_MOVE -> {
        if (!owning && abs(event.y - startY) > 10f * density) {
          if (!scrollCancelled) { motion.cancelForScroll(); gestureCancels++; scrollCancelled = true }
        } else if (!scrollCancelled) {
          val changes = motion.rowChanges
          motion.move(point[0], point[1], event.x, event.y)
          if (changes != motion.rowChanges) host.performHapticFeedback(if (Build.VERSION.SDK_INT >= 34)
            HapticFeedbackConstants.SEGMENT_FREQUENT_TICK else HapticFeedbackConstants.CLOCK_TICK)
        }
        requestFrame()
      }
      MotionEvent.ACTION_UP -> {
        val row = if (!scrollCancelled) motion.up(point[0], point[1]) else { motion.release(); null }
        observing = false
        if (owning) finishNative(event)
        if (ownedStream && row != null && validSelection(row)) {
          selectionPending = !row.keepOpen
          selectionDispatches++
          select(row.id, gestureId)
        }
        gestureRows = emptyList()
        requestFrame()
      }
      MotionEvent.ACTION_POINTER_DOWN -> {
        // Revoke the original RN press even for the passive-scroll path, then
        // keep native cancellation ownership until the final finger leaves.
        if (!owning) {
          NativeGestureUtil.notifyNativeGestureStarted(host, event)
          owning = true
        }
        suppressUntilAllUp = true
        motion.cancel(); gestureCancels++
        observing = false
        gestureRows = emptyList()
        requestFrame()
      }
      MotionEvent.ACTION_CANCEL -> {
        motion.cancel(); gestureCancels++
        observing = false
        if (owning) finishNative(event)
        gestureRows = emptyList()
        requestFrame()
      }
    }
    return if (ownedStream || suppressUntilAllUp) true else passThrough()
  }

  private fun begin(event: MotionEvent) {
    if (selectionPending || records.isEmpty()) return
    val resolved = ArrayList<MenuInteractionRow>()
    var hitView: View? = null
    mapPoint(event.x, event.y, point)
    host.getLocationInWindow(hostLocation)
    for (row in records) {
      val view = try { context.findView<View>(row.tag) } catch (_: Exception) { null } ?: continue
      if (row.id.isEmpty() || !view.isAttachedToWindow || view.rootView !== host.rootView ||
        !view.isShown || view.alpha <= .001f || view.width <= 0 || view.height <= 0 || !descendant(view)) continue
      bounds.set(0, 0, view.width, view.height)
      host.offsetDescendantRectToMyCoords(view, bounds)
      val rect = RectF(bounds)
      // isShown ignores clipping. Resolve the actually visible scroll/window
      // intersection once on DOWN, then keep pure model bounds during drag.
      if (!view.getGlobalVisibleRect(visibleBounds)) continue
      mapPoint((visibleBounds.left - hostLocation[0]).toFloat(),
        (visibleBounds.top - hostLocation[1]).toFloat(), clippedPoint)
      val visibleLeft = clippedPoint[0]
      val visibleTop = clippedPoint[1]
      mapPoint((visibleBounds.right - hostLocation[0]).toFloat(),
        (visibleBounds.bottom - hostLocation[1]).toFloat(), clippedPoint)
      if (!rect.intersect(visibleLeft, visibleTop, clippedPoint[0], clippedPoint[1])) continue
      val item = MenuInteractionRow(row.id, rect, row.enabled, row.keepOpen,
        row.fullWidth && rect.width() >= host.width * .65f)
      resolved.add(item)
      if (row.enabled && point[0] >= rect.left && point[0] < rect.right &&
        point[1] >= rect.top && point[1] < rect.bottom) hitView = view
    }
    val hit = hitView ?: return
    if (containsInput(hit)) return
    gestureRows = resolved
    motion.setRows(resolved)
    motion.updatePlate(host.width.toFloat())
    if (!motion.down(point[0], point[1], event.x, event.y)) return
    startY = event.y
    observing = true
    scrollCancelled = false
    gestureId++
    owning = !scrollableAncestor(hit)
    if (owning) {
      NativeGestureUtil.notifyNativeGestureStarted(host, event)
      host.parent?.requestDisallowInterceptTouchEvent(true)
    }
    requestFrame()
  }

  private fun validSelection(row: MenuInteractionRow): Boolean {
    val record = records.firstOrNull { it.id == row.id && it.enabled } ?: return false
    val view = try { context.findView<View>(record.tag) } catch (_: Exception) { null } ?: return false
    host.getLocationInWindow(hostLocation)
    return view.isAttachedToWindow && view.rootView === host.rootView && descendant(view) && view.isShown &&
      view.getGlobalVisibleRect(visibleBounds) &&
      visibleBounds.contains((hostLocation[0] + lastX).toInt(), (hostLocation[1] + lastY).toInt())
  }
  private fun finishNative(event: MotionEvent) {
    if (!owning) return
    NativeGestureUtil.notifyNativeGestureEnded(host, event)
    host.parent?.requestDisallowInterceptTouchEvent(false)
    owning = false
  }
  private fun descendant(view: View): Boolean {
    var parent = view.parent
    while (parent is View) { if (parent === host) return true; parent = parent.parent }
    return false
  }
  private fun scrollableAncestor(view: View): Boolean {
    var current: View? = view
    while (current != null && current !== host) {
      if (current.canScrollVertically(-1) || current.canScrollVertically(1) ||
        current.canScrollHorizontally(-1) || current.canScrollHorizontally(1)) return true
      current = current.parent as? View
    }
    return false
  }
  private fun containsInput(view: View, depth: Int = 0): Boolean {
    if (view is EditText || view is SeekBar || view is LiquidGlassInteractiveControl) return true
    if (view !is ViewGroup) return false
    if (depth > 8) return true
    for (index in 0 until view.childCount) if (containsInput(view.getChildAt(index), depth + 1)) return true
    return false
  }

  /** Original plate recipe, rendered with the same body transform and budget. */
  fun drawPlate(canvas: Canvas, shown: RectF, zoom: Float, dark: Boolean, strength: Float) {
    if (motion.plateAlpha <= .001f) return
    motion.updatePlate(host.width.toFloat())
    val plate = motion.plateRect
    if (plate.width() <= 0f || plate.height() <= 0f) return
    val alpha = motion.plateAlpha * strength
    val base = if (dark) .155f else .09f
    fun shade(opacity: Float): Int = Color.argb((opacity.coerceIn(0f, 1f) * 255f).toInt(),
      if (dark) 235 else 60, if (dark) 235 else 60, if (dark) 245 else 67)
    paint.shader = RadialGradient(motion.lightPositionX.coerceIn(plate.left, plate.right), plate.centerY(),
      plate.width() * .62f, shade((base + if (dark) .03f else 0f) * alpha), shade(base * alpha), Shader.TileMode.CLAMP)
    val save = canvas.save()
    canvas.translate(shown.centerX() - host.width / 2f * shown.width() / host.width * zoom,
      shown.centerY() - host.height / 2f * shown.height() / host.height * zoom)
    canvas.scale(shown.width() / host.width * zoom, shown.height() / host.height * zoom)
    canvas.drawRoundRect(plate, plate.height() / 2f, plate.height() / 2f, paint)
    canvas.restoreToCount(save)
    paint.shader = null
  }
}
