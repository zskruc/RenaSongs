package expo.modules.liquidglass

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Outline
import android.graphics.Path
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
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
import expo.modules.liquidglass.menumotion.GlassForegroundPortal
import expo.modules.liquidglass.menumotion.GlassFrameClock
import expo.modules.liquidglass.menumotion.GlassMorphTuning
import expo.modules.liquidglass.menumotion.GlassMotion
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

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
  private val captureEnvelope = RectF()
  private val target = RectF()
  private val source = RectF()
  private val through = RectF()
  private val location = IntArray(2)
  private val rootLocation = IntArray(2)
  private val frameClock = GlassFrameClock()
  private val foregroundPortal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) GlassForegroundPortal(density) else null
  private val foregroundBounds = RectF()
  private var triggerSnapshot: MenuTriggerSnapshot? = null
  // App buttons deliberately retain their original plain Pressable material.
  // Upstream only adds a second glass lobe when the actual trigger is glass.
  private val sourceHasGlass = false
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
  private var animationScale = 1f
  private var lockedFieldStep = 0f
  private var motionTrace = false
  private var motionStartedAt = 0L
  private var motionFrames = 0
  private var emittedStart = false
  private var completedOpen: Boolean? = null
  private var targetRadius = 0f

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
      frameClock.restart(animationScale)
      setInteractive(false)
      (getChildAt(0) as? LiquidGlassView)?.clearMenuMorph()
      releaseTrigger()
      foregroundPortal?.release()
      // A reused native view must not flash the preceding menu's display list.
      resetContent()
      invalidate()
    }
    if (initialized && motion.expanded != requestedOpen) {
      motion.retarget(requestedOpen)
      settled = false
      completedOpen = null
      emittedStart = false
      frameClock.restart(animationScale)
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
    (getChildAt(0) as? LiquidGlassView)?.clearMenuMorph()
    releaseTrigger()
    foregroundPortal?.release()
    resetContent()
    super.onDetachedFromWindow()
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (visibility != VISIBLE) stopFrames() else if (isAttachedToWindow) {
      frameClock.restart(animationScale)
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
    // The library's default is morphOrigin="trigger", not press-following.
    // Forcing followsPress multiplies spring position by growth and introduces
    // an initially sticky, then sudden leap for distant right-aligned cards.
    through.set(source)
    triggerSnapshot = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MenuTriggerSnapshots.take(source) else null
    reserveMaterialEnvelope()
    targetRadius = requestedRadius * density
    motion.initialize(source, target, targetRadius, density, through, false, GlassMorphTuning(null, null))
    motion.retarget(true)
    initialized = true
    settled = false
    completedOpen = null
    frameClock.restart(animationScale)
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
    reserveMaterialEnvelope()
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
      motionTrace = Log.isLoggable("ResonusGlass", Log.DEBUG)
      motionStartedAt = SystemClock.uptimeMillis()
      motionFrames = 0
      foregroundPortal?.diagnosticsEnabled = motionTrace
      animationScale = try { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) }
        catch (_: RuntimeException) { 1f }
      frameClock.restart(animationScale)
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
    val seconds = frameClock.advance(frameTimeNanos, display?.refreshRate ?: 60f)
    motionFrames++
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
    outline.update(frame, target.left, target.top, settled, sourceHasGlass, lockedFieldStep)
    foregroundPortal?.update(frame, target.left, target.top, sourceHasGlass, outline.smoothedField)
    localIncoming.set(frame.bounds)
    localIncoming.offset(-target.left, -target.top)
    contentClip.rewind()
    contentClip.addRoundRect(localIncoming, frame.radiusX, frame.radiusY, Path.Direction.CW)
    materialBounds.set(localIncoming)
    if (!settled && sourceHasGlass) {
      materialBounds.union(frame.sourceLobe.left - target.left, frame.sourceLobe.top - target.top,
        frame.sourceLobe.right - target.left, frame.sourceLobe.bottom - target.top)
      // The Gaussian neck can gently bulge outside either lobe's rectangle.
      materialBounds.inset(-frame.smoothing, -frame.smoothing)
    }
    (getChildAt(0) as? LiquidGlassView)?.updateMenuMorph(
      target.left + materialBounds.left, target.top + materialBounds.top,
      target.left + materialBounds.right, target.top + materialBounds.bottom, frame.radiusX, frame.radiusY)
    getChildAt(0)?.alpha = if (sourceHasGlass) 1f else frame.contentProgress.coerceIn(0f, 1f)
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
      val contentBlur = if (settled) 0f else frame.contentBlur
      if (foregroundPortal != null) foregroundPortal.setContentBlur(child, contentBlur, child.scaleX, child.scaleY)
      else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val corrected = contentBlur / max(min(abs(child.scaleX), abs(child.scaleY)), 0.25f)
        child.setRenderEffect(if (corrected > 0.01f) RenderEffect.createBlurEffect(corrected, corrected, Shader.TileMode.DECAL) else null)
      }
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
      // The background's native drawing child moves/measures in physical
      // pixels and samples its true screen origin. Never scale a captured page
      // into the changing shell: that makes the page slide/zoom inside glass.
      drawChild(canvas, material, drawingTime)
    } finally { canvas.restoreToCount(save) }
    val portal = foregroundPortal
    if (portal != null && canvas.isHardwareAccelerated && !settled) {
      portal.draw(canvas, foregroundBounds, true) { recording ->
        for (index in 1 until childCount) drawChild(recording, getChildAt(index), drawingTime)
      }
    } else if (portal != null && canvas.isHardwareAccelerated) {
      val contentSave = canvas.save()
      canvas.clipPath(contentClip)
      portal.draw(canvas, foregroundBounds, false) { recording ->
        for (index in 1 until childCount) drawChild(recording, getChildAt(index), drawingTime)
      }
      canvas.restoreToCount(contentSave)
    } else {
      val contentSave = canvas.save()
      canvas.clipPath(contentClip)
      for (index in 1 until childCount) drawChild(canvas, getChildAt(index), drawingTime)
      canvas.restoreToCount(contentSave)
    }
    // A nonglass trigger's foreground is drawn outside the glass portal, as in
    // GlassMenuSession. Its real view is restored exactly at session cleanup.
    triggerSnapshot?.draw(canvas, motion.frame, target.left, target.top)
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
  private fun reserveMaterialEnvelope() {
    val material = getChildAt(0) as? LiquidGlassView ?: return
    captureEnvelope.set(target)
    captureEnvelope.union(source)
    // Reserve movement/rebound once, bounded by this Modal's actual window.
    val guard = 48f * density
    captureEnvelope.inset(-guard, -guard)
    rootView.getLocationOnScreen(rootLocation)
    if (!captureEnvelope.intersect(rootLocation[0].toFloat(), rootLocation[1].toFloat(),
        rootLocation[0] + rootView.width.toFloat(), rootLocation[1] + rootView.height.toFloat())) return
    val capacity = menuLayerCapacity(target.width(), target.height(), source.height(), density)
    material.reserveMenuMorph(captureEnvelope, capacity.width, capacity.height)
    foregroundPortal?.reserve(target, target.left, target.top, captureEnvelope)
    lockedFieldStep = max(5f * density, max(captureEnvelope.width(), captureEnvelope.height()) / 64f)
    foregroundBounds.set(captureEnvelope)
    foregroundBounds.offset(-target.left, -target.top)
  }
  private fun stopFrames() {
    if (callbackPosted) Choreographer.getInstance().removeFrameCallback(this)
    callbackPosted = false
    frameClock.restart(animationScale)
  }
  private fun emitComplete(open: Boolean) {
    if (completedOpen == open) return
    completedOpen = open
    if (motionTrace) Log.d("ResonusGlass", "menuMotion session=$activeSession open=$open " +
      "durationMs=${SystemClock.uptimeMillis() - motionStartedAt} frames=$motionFrames " +
      "portal=${foregroundPortal?.diagnostics()}")
    if (!open) { releaseTrigger(); foregroundPortal?.release() }
    onMotionComplete(mapOf("sessionId" to activeSession, "open" to open))
  }
  private fun resetContent() {
    for (index in 1 until childCount) {
      val child = getChildAt(index)
      child.translationX = 0f; child.translationY = 0f
      child.scaleX = 1f; child.scaleY = 1f; child.alpha = 1f
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) child.setRenderEffect(null)
    }
    getChildAt(0)?.alpha = 1f
  }
  private fun releaseTrigger() { triggerSnapshot?.release(); triggerSnapshot = null }
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
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MenuTriggerSnapshots.register(view,
    RectF(location[0].toFloat(), location[1].toFloat(),
      location[0] + view.width * abs(view.scaleX), location[1] + view.height * abs(view.scaleY)))
  return listOf(location[0] / density, location[1] / density,
    view.width * abs(view.scaleX) / density, view.height * abs(view.scaleY) / density, corner / density)
}
