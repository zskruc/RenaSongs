package expo.modules.liquidglass

import android.annotation.SuppressLint
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Outline
import android.graphics.Path
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.ViewTreeObserver
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.ReactPointerEventsView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.liquidglass.menumotion.GlassMorphOutline
import expo.modules.liquidglass.menumotion.GlassMorphTuning
import expo.modules.liquidglass.menumotion.GlassMotion
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * A fixed Fabric layout with the source-to-menu motion from
 * rit3zh/expo-glass-custom-menu. The first child is the existing glass material;
 * subsequent children are arbitrary RN content, not native menu-item copies.
 * Springs, the liquid outline, and content reveal advance together on MAIN at
 * the actual display cadence, without JS timers or per-frame Fabric commits.
 */
class MenuMorphView(context: Context, appContext: AppContext) : ExpoView(context, appContext),
  ReactPointerEventsView, Choreographer.FrameCallback, ViewTreeObserver.OnPreDrawListener {
  private val onMotionStart by EventDispatcher()
  private val onMotionComplete by EventDispatcher()
  private val density = resources.displayMetrics.density.coerceAtLeast(0.1f)
  private val motion = GlassMotion()
  private val outline = GlassMorphOutline(density)
  private val contentClip = Path()
  private val localIncoming = RectF()
  private val materialBounds = RectF()
  private val target = RectF()
  private val source = RectF()
  private val through = RectF()
  private val location = IntArray(2)
  private val blurEffects = arrayOfNulls<RenderEffect>(19)
  private var requestedOpen = false
  private var requestedReady = false
  private var requestedSession = 0
  private var requestedRadius = 28f
  private var requestedSource: List<Double>? = null
  private var activeSession = Int.MIN_VALUE
  private var initialized = false
  private var preDrawSeen = false
  private var preDrawRegistered = false
  private var callbackPosted = false
  private var settled = false
  private var interactive = false
  private var lastFrameNanos = 0L
  private var lastBlurStep = -1
  private var emittedStart = false
  private var completedOpen: Boolean? = null
  private var targetRadius = 0f
  private var sourceRadiusRatio = 1f

  override val pointerEvents: PointerEvents
    get() = if (interactive) PointerEvents.BOX_NONE else PointerEvents.NONE

  init {
    clipChildren = false
    clipToPadding = false
    isClickable = false
    isFocusable = false
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    setWillNotDraw(false)
  }

  internal fun setOpen(value: Boolean) { requestedOpen = value }
  internal fun setReady(value: Boolean) { requestedReady = value }
  internal fun setSessionId(value: Int) { requestedSession = value }
  internal fun setRadius(value: Double) {
    if (value.isFinite()) requestedRadius = value.toFloat().coerceIn(0f, 200f)
  }
  internal fun setSourceRect(value: List<Double>?) {
    requestedSource = value?.takeIf { it.size >= 4 && it.all(Double::isFinite) }?.toList()
  }

  /** Called after Expo has applied the whole prop batch, irrespective of order. */
  internal fun commitProps() {
    if (activeSession != requestedSession) {
      stopFrames()
      activeSession = requestedSession
      initialized = false
      settled = false
      emittedStart = false
      completedOpen = null
      lastFrameNanos = 0L
      setInteractive(false)
      // A reused native view must not flash the preceding menu's display list.
      resetContent()
      invalidate()
    }
    if (initialized && motion.expanded != requestedOpen) {
      motion.retarget(requestedOpen)
      settled = false
      completedOpen = null
      emittedStart = false
      lastFrameNanos = 0L
      setInteractive(false)
      beginMotion()
      applyFrame()
    } else if (!initialized && !requestedOpen) {
      // Dismissed before Modal.onShow/layout: there is no visible shell to wait for.
      emitComplete(false)
    } else if (initialized && requestedOpen) {
      updateTarget()
      if (!settled) beginMotion()
    }
    requestStart()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    preDrawSeen = false
    if (!preDrawRegistered) {
      viewTreeObserver.addOnPreDrawListener(this)
      preDrawRegistered = true
    }
    requestStart()
  }

  override fun onDetachedFromWindow() {
    stopFrames()
    if (preDrawRegistered && viewTreeObserver.isAlive) viewTreeObserver.removeOnPreDrawListener(this)
    preDrawRegistered = false
    preDrawSeen = false
    initialized = false
    settled = false
    emittedStart = false
    completedOpen = null
    activeSession = Int.MIN_VALUE
    setInteractive(false)
    resetContent()
    super.onDetachedFromWindow()
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (visibility != VISIBLE) stopFrames() else if (isAttachedToWindow) {
      lastFrameNanos = 0L
      requestStart()
      if (initialized && !settled) beginMotion()
    }
  }

  override fun onPreDraw(): Boolean {
    preDrawSeen = true
    requestStart()
    if (initialized) updateTarget()
    return true
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    // Fabric measures children independently; LinearLayout measurement would
    // stack/stretch arbitrary RN content and corrupt the existing menu layout.
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
  }

  @SuppressLint("MissingSuperCall")
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    // Keep the target rectangle fixed for the entire animation, including exit.
    if (initialized) updateTarget()
    requestStart()
  }

  private fun requestStart() {
    if (initialized || !requestedOpen || !requestedReady || !preDrawSeen || !isAttachedToWindow ||
      windowVisibility != VISIBLE || width <= 0 || height <= 0 || childCount < 2) return
    if (getChildAt(0).width <= 0 || getChildAt(1).height <= 0) return
    getLocationOnScreen(location)
    target.set(location[0].toFloat(), location[1].toFloat(), location[0] + width.toFloat(), location[1] + height.toFloat())
    val rect = requestedSource
    if (rect != null && rect[2] > 0 && rect[3] > 0) {
      source.set((rect[0] * density).toFloat(), (rect[1] * density).toFloat(),
        ((rect[0] + rect[2]) * density).toFloat(), ((rect[1] + rect[3]) * density).toFloat())
    } else {
      val side = min(44f * density, min(target.width(), target.height()))
      source.set(target.centerX() - side / 2f, target.top, target.centerX() + side / 2f, target.top + side)
    }
    // Through is the pressed part of a wide trigger, as in upstream's ejection.
    // Keep it bounded to a button-sized square rather than the whole list row.
    val side = min(source.width(), source.height())
    sourceRadiusRatio = if (rect != null && rect.size > 4)
      ((rect[4] * density).toFloat() / max(side / 2f, 0.1f)).coerceIn(0f, 1f) else 1f
    through.set(source.centerX() - side / 2f, source.centerY() - side / 2f,
      source.centerX() + side / 2f, source.centerY() + side / 2f)
    targetRadius = requestedRadius * density
    motion.initialize(source, target, targetRadius, density, through, true, GlassMorphTuning(null, null))
    motion.retarget(true)
    initialized = true
    settled = false
    completedOpen = null
    lastFrameNanos = 0L
    beginMotion()
    applyFrame()
    // Initial source geometry is drawn in this pre-draw before the first tick.
    invalidate()
  }

  private fun updateTarget() {
    if (!initialized || width <= 0 || height <= 0) return
    getLocationOnScreen(location)
    val left = location[0].toFloat()
    val top = location[1].toFloat()
    val radius = requestedRadius * density
    if (abs(target.left - left) < 0.5f && abs(target.top - top) < 0.5f &&
      abs(target.width() - width) < 0.5f && abs(target.height() - height) < 0.5f &&
      abs(targetRadius - radius) < 0.5f) return
    target.set(left, top, left + width, top + height)
    targetRadius = radius
    motion.updateTarget(target, radius)
    settled = false
    beginMotion()
    applyFrame()
  }

  private fun beginMotion() {
    if (!isAttachedToWindow || windowVisibility != VISIBLE) return
    if (!emittedStart) {
      emittedStart = true
      onMotionStart(mapOf("sessionId" to activeSession, "open" to requestedOpen))
    }
    if (!callbackPosted) {
      callbackPosted = true
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  override fun doFrame(frameTimeNanos: Long) {
    callbackPosted = false
    if (!initialized || !isAttachedToWindow || windowVisibility != VISIBLE) return
    if (lastFrameNanos == 0L) {
      lastFrameNanos = frameTimeNanos
      // Do not spend the animation in Modal/window setup before its first frame.
      beginMotion()
      return
    }
    val seconds = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ValueAnimator.areAnimatorsEnabled()) 5f
      else ((frameTimeNanos - lastFrameNanos) / 1_000_000_000.0).toFloat().coerceIn(0f, 0.05f)
    lastFrameNanos = frameTimeNanos
    settled = motion.advanceBy(seconds)
    applyFrame()
    if (settled) {
      setInteractive(requestedOpen)
      emitComplete(requestedOpen)
    } else beginMotion()
  }

  private fun applyFrame() {
    if (!initialized) return
    val frame = motion.frame
    // Upstream's default trigger is a capsule. Preserve the actual trigger's
    // corner ratio when a rectangular action supplied a measured radius.
    // publish() restores its unmodified radius on every spring advance.
    frame.sourceRadius *= sourceRadiusRatio
    outline.update(frame, target.left, target.top, settled)
    localIncoming.set(frame.bounds)
    localIncoming.offset(-target.left, -target.top)
    contentClip.rewind()
    contentClip.addRoundRect(localIncoming, frame.radiusX, frame.radiusY, Path.Direction.CW)
    materialBounds.set(localIncoming)
    if (!settled) {
      materialBounds.union(frame.sourceLobe.left - target.left, frame.sourceLobe.top - target.top,
        frame.sourceLobe.right - target.left, frame.sourceLobe.bottom - target.top)
      // The Gaussian neck can gently bulge outside either lobe's rectangle.
      materialBounds.inset(-frame.smoothing, -frame.smoothing)
    }
    val sx = localIncoming.width() / max(width.toFloat(), 1f)
    val sy = localIncoming.height() / max(height.toFloat(), 1f)
    val reveal = if (settled && requestedOpen) 1f else frame.rowsOpacity.coerceIn(0f, 1f)
    val zoom = if (settled) 1f else frame.contentZoom
    for (index in 1 until childCount) {
      val child = getChildAt(index)
      child.pivotX = width / 2f - child.left
      child.pivotY = height / 2f - child.top
      child.translationX = localIncoming.centerX() - width / 2f
      child.translationY = localIncoming.centerY() - height / 2f
      child.scaleX = sx * zoom
      child.scaleY = sy * zoom
      child.alpha = reveal
    }
    val blurStep = if (settled) 0 else (frame.contentBlur / density).roundToInt().coerceIn(0, 18)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && blurStep != lastBlurStep) {
      lastBlurStep = blurStep
      val effect = if (blurStep == 0) null else blurEffects[blurStep] ?: RenderEffect.createBlurEffect(
        blurStep * density, blurStep * density, Shader.TileMode.CLAMP).also { blurEffects[blurStep] = it }
      for (index in 1 until childCount) getChildAt(index).setRenderEffect(effect)
    }
    // Native child transforms also transform Android/RN touch coordinates.
    setInteractive(requestedOpen && reveal > 0.78f)
    invalidate()
    (parent as? View)?.invalidate()
  }

  override fun dispatchDraw(canvas: Canvas) {
    if (!initialized || (settled && !requestedOpen)) return
    val material = getChildAt(0) ?: return
    val save = canvas.save()
    try {
      canvas.clipPath(outline.path)
      val materialSave = canvas.save()
      canvas.translate(materialBounds.left, materialBounds.top)
      canvas.scale(materialBounds.width() / max(material.width.toFloat(), 1f),
        materialBounds.height() / max(material.height.toFloat(), 1f))
      canvas.translate(-material.left.toFloat(), -material.top.toFloat())
      drawChild(canvas, material, drawingTime)
      canvas.restoreToCount(materialSave)
      canvas.clipPath(contentClip)
      for (index in 1 until childCount) drawChild(canvas, getChildAt(index), drawingTime)
    } finally { canvas.restoreToCount(save) }
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (!interactive) return false
    if (event.actionMasked == MotionEvent.ACTION_DOWN && !localIncoming.contains(event.x, event.y)) return false
    return super.dispatchTouchEvent(event)
  }

  private fun setInteractive(value: Boolean) {
    if (interactive == value) return
    interactive = value
    importantForAccessibility = if (value) IMPORTANT_FOR_ACCESSIBILITY_AUTO else IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }
  private fun stopFrames() {
    if (callbackPosted) Choreographer.getInstance().removeFrameCallback(this)
    callbackPosted = false
    lastFrameNanos = 0L
  }
  private fun emitComplete(open: Boolean) {
    if (completedOpen == open) return
    completedOpen = open
    onMotionComplete(mapOf("sessionId" to activeSession, "open" to open))
  }
  private fun resetContent() {
    lastBlurStep = -1
    for (index in 1 until childCount) {
      val child = getChildAt(index)
      child.translationX = 0f; child.translationY = 0f
      child.scaleX = 1f; child.scaleY = 1f; child.alpha = 1f
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) child.setRenderEffect(null)
    }
  }
}

/** Window-independent screen coordinates, measured on MAIN across RN Modals. */
internal fun measureMenuOrigin(view: View?): List<Float>? {
  if (view == null || !view.isAttachedToWindow || view.width <= 0 || view.height <= 0) return null
  val density = view.resources.displayMetrics.density
  if (!density.isFinite() || density <= 0f) return null
  val location = IntArray(2)
  view.getLocationOnScreen(location)
  val outline = Outline()
  val corner = try {
    view.outlineProvider?.getOutline(view, outline)
    outline.radius.takeIf { it.isFinite() && it > 0f } ?: min(view.width, view.height) / 2f
  } catch (_: Exception) { min(view.width, view.height) / 2f }
  return listOf(location[0] / density, location[1] / density,
    view.width * abs(view.scaleX) / density, view.height * abs(view.scaleY) / density, corner / density)
}
