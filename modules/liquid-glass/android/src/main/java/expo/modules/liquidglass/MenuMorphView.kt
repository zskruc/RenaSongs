package expo.modules.liquidglass

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Outline
import android.graphics.Path
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.os.SystemClock
import android.os.Trace
import android.os.Handler
import android.os.Looper
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
import expo.modules.liquidglass.menumotion.GlassMorphFrame
import expo.modules.liquidglass.menumotion.GlassAbsorbRecord
import expo.modules.liquidglass.menumotion.GlassJelly
import expo.modules.liquidglass.menumotion.MenuSourceHandoff
import expo.modules.liquidglass.menumotion.menuSourceTag
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Static markers are inactive unless a shell/app trace is being recorded. */
private inline fun <T> traceMenu(name: String, block: () -> T): T {
  val tracing = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && Trace.isEnabled()
  if (tracing) Trace.beginSection(name)
  return try { block() } finally { if (tracing) Trace.endSection() }
}

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
  private val onMenuSelect by EventDispatcher()
  private val density = resources.displayMetrics.density.coerceAtLeast(0.1f)
  private val motion = GlassMotion()
  private val liveFrame = GlassMorphFrame()
  private val interaction = MenuMorphInteraction(this, appContext, density,
    mapPoint = { x, y, out ->
      val zoom = if (settled) 1f else motion.frame.contentZoom
      out[0] = (x - localIncoming.centerX()) / max(localIncoming.width() / max(width.toFloat(), 1f) * zoom, .001f) + width / 2f
      out[1] = (y - localIncoming.centerY()) / max(localIncoming.height() / max(height.toFloat(), 1f) * zoom, .001f) + height / 2f
    }, requestFrame = { requestInteractionFrame() }, select = { rowId, gestureId ->
      onMenuSelect(mapOf("sessionId" to activeSession, "rowId" to rowId, "gestureId" to gestureId))
    })
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
  private var groupForeground: MenuGroupForeground? = null
  private var windowDrawing: MenuMorphWindowOwner? = null
  private var groupFillColor: Int? = null
  private val sourceFillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val sourceFillBounds = RectF()
  private val terminalSourceLight by lazy { if (Build.VERSION.SDK_INT >= 33) MenuPressLight() else null }
  private val sourceHandoff = MenuSourceHandoff()
  private val mainHandler = Handler(Looper.getMainLooper())
  private var handoffTicket: MenuSourceHandoff.Ticket? = null
  private var handoffObserver: ViewTreeObserver? = null
  private var handoffCommitCallback: Runnable? = null
  private var handoffTimeout: Runnable? = null
  private var atomicSourceHandoff: MenuAtomicSourceHandoff? = null
  private var handoffStartedAt = 0L
  private var sourceHandoffRegistered = 0
  private var sourceHandoffCommits = 0
  private var sourceHandoffFallbacks = 0
  private var sourceHandoffLastReason = "none"
  private var sourceHandoffLastMs = 0L
  private var sourceAtomicAttempts = 0
  private var sourceAtomicStaged = 0
  private var sourceAtomicUncertain = 0
  private var sourceAtomicCommits = 0
  private var sourceAtomicTimeouts = 0
  private var sourceAtomicState = "not-attempted"
  private var sourceAtomicPatchSkipped = false
  private var preparedHandoffPatch: MenuHandoffPatch? = null
  private var prepareHandoffPatchCallback: Runnable? = null
  private var handoffPatchState = "not-prepared"
  private var handoffPatchDrawDeclines = 0
  internal val menuTargetLeft get() = target.left
  internal val menuTargetTop get() = target.top
  // Only the explicitly registered whole toolbar has a glass source. Generic
  // and single-icon origins retain their existing nonglass fallback.
  private var sourceHasGlass = false
  private var groupRequested = false
  private var groupEligible = false
  private var sourceJelly: GlassJelly? = null
  private var sourceControlHeight = 1f
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
  private var finiteRows = false
  private var menuDragEnabled = true
  private var jellyFrames = 0L
  private var plateFrames = 0L

  override val pointerEvents: PointerEvents
    get() = if (interactive || finiteInputReady()) PointerEvents.BOX_NONE else PointerEvents.NONE

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
    requestedSource = value?.takeIf { it.size >= 4 && it.take(5).all(Double::isFinite) }?.take(7)?.toList()
  }
  internal fun setMenuRows(value: List<MenuMorphRowRecord>?) {
    finiteRows = !value.isNullOrEmpty()
    interaction.setRows(value)
  }
  internal fun setMenuDragEnabled(value: Boolean) {
    if (!value && menuDragEnabled) { interaction.cancel(); requestInteractionFrame() }
    menuDragEnabled = value
  }
  private fun finiteInputReady() = initialized && requestedReady && requestedOpen && finiteRows && menuDragEnabled

  /** Called after Expo has applied the whole prop batch, irrespective of order. */
  internal fun commitProps() {
    if (activeSession != requestedSession) {
      cancelSourceHandoff()
      stopFrames()
      activeSession = requestedSession
      initialized = false
      settled = false
      emittedStart = false
      completedOpen = null
      frameClock.restart(animationScale)
      interaction.reset()
      jellyFrames = 0L; plateFrames = 0L
      sourceHandoffRegistered = 0; sourceHandoffCommits = 0; sourceHandoffFallbacks = 0
      sourceHandoffLastReason = "none"; sourceHandoffLastMs = 0L
      sourceAtomicAttempts = 0; sourceAtomicStaged = 0; sourceAtomicUncertain = 0; sourceAtomicCommits = 0; sourceAtomicTimeouts = 0
      sourceAtomicState = "not-attempted"; sourceAtomicPatchSkipped = false
      handoffPatchState = "not-prepared"; handoffPatchDrawDeclines = 0
      setInteractive(false)
      (getChildAt(0) as? LiquidGlassView)?.clearMenuMorph()
      releaseTrigger()
      foregroundPortal?.release()
      // A reused native view must not flash the preceding menu's display list.
      resetContent()
      invalidate()
    }
    if (sourceHandoff.pending && requestedOpen) {
      // Reopen starts a fresh source lease. The old committed-buffer callback
      // must neither remove this presentation nor complete its JS controller.
      cancelSourceHandoff()
      releaseTrigger()
      foregroundPortal?.release()
      initialized = false; settled = false; emittedStart = false; completedOpen = null
      (getChildAt(0) as? LiquidGlassView)?.clearMenuMorph()
      resetContent()
    }
    if (initialized && motion.expanded != requestedOpen) {
      if (!requestedOpen) {
        cancelHandoffPatchPreparation()
        interaction.close()
        triggerSnapshot?.beginClosing()
        val refreshed = RectF()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && triggerSnapshot?.currentScreenBounds(refreshed) == true) {
          source.set(refreshed)
          motion.updateSource(source, through)
          if (!captureEnvelope.contains(refreshed)) reserveMaterialEnvelope()
        }
      }
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
      if (!settled || !interaction.motion.isSettled) beginMotion()
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
    cancelSourceHandoff()
    stopFrames()
    interaction.reset()
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
    if (visibility != VISIBLE) {
      handoffTicket?.let { finishSourceHandoff(it, false, "window-hidden") }
      interaction.close(); stopFrames(); triggerSnapshot?.detachOverlay(); windowDrawing?.detach()
    } else if (isAttachedToWindow) {
      if (sourceHasGlass && windowDrawing?.attach(rootView, captureEnvelope) != true) {
        releaseTrigger()
        applyFrame()
      }
      if (triggerSnapshot?.attachOverlay(rootView) == false) { releaseTrigger(); applyFrame() }
      frameClock.restart(animationScale)
      requestStart()
      if (initialized && (!settled || !interaction.motion.isSettled)) beginMotion()
    }
  }

  override fun onPreDraw(): Boolean {
    preDrawSeen = true
    requestStart()
    if (initialized && !sourceHandoff.pending) updateTarget()
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
    // Only an explicit exact Pressable ref may hide a source. Geometry-only
    // root touches never borrow a global pending descendant/toolbar snapshot.
    val sourceTag = menuSourceTag(rect?.getOrNull(5))
    val buttonView = sourceTag?.let { tag ->
      try { appContext.findView<View>(tag)?.takeIf { it.id == tag } } catch (_: Exception) { null }
    }
    through.set(source)
    val groupTag = menuSourceTag(rect?.getOrNull(6))
    groupRequested = groupTag != null
    val groupView = groupTag?.let { tag ->
      try { (appContext.findView<View>(tag) as? MenuTriggerGroupView)?.takeIf {
        it.id == tag && it.isAttachedToWindow && it.sourceFillColor() != null &&
          buttonView != null && isGroupDescendant(buttonView, it)
      } } catch (_: Exception) { null }
    }
    groupEligible = groupView != null
    if (groupView != null) {
      // Through is the specific button; source is the entire explicit pill.
      // Synchronous exact measurements also cover a fast tap before JS's async
      // geometry callback, without turning a common ancestor into an anchor.
      buttonView?.let { setScreenBounds(it, through, normalizeTouch = true) }
      setScreenBounds(groupView, source, normalizeTouch = false)
    }
    triggerSnapshot = traceMenu("RenaMenu/captureTrigger") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MenuTriggerSnapshots.take(source, groupView ?: buttonView,
        authorizedGroup = groupView != null) else null
    }
    sourceHasGlass = groupView != null && triggerSnapshot?.isGroupedSource == true
    groupFillColor = if (sourceHasGlass) groupView?.sourceFillColor() else null
    sourceJelly = if (sourceHasGlass) groupView?.jelly else null
    sourceControlHeight = groupView?.height?.toFloat() ?: 1f
    if (groupView != null && !sourceHasGlass) {
      source.set(through)
      triggerSnapshot = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        MenuTriggerSnapshots.take(source, buttonView) else null
      through.set(source)
    } else if (groupView == null) through.set(source)
    reserveMaterialEnvelope()
    if (sourceHasGlass) {
      val drawing = MenuMorphWindowOwner(this)
      val pixels = triggerSnapshot?.groupForegroundBitmap
      if (pixels != null && drawing.attach(rootView, captureEnvelope)) {
        windowDrawing = drawing
        groupForeground = MenuGroupForeground(pixels, pixels.width.toFloat(), pixels.height.toFloat())
        triggerSnapshot?.setGroupedRendering(true)
      } else {
        drawing.detach()
        // No window drawing owner means no permission to erase a whole group.
        // Fall back to the exact single trigger, retaining the successful 191
        // independent-small-View path and never hiding the pill by itself.
        releaseTrigger()
        source.set(through)
        triggerSnapshot = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
          MenuTriggerSnapshots.take(source, buttonView) else null
        through.set(source)
        reserveMaterialEnvelope()
      }
    }
    targetRadius = requestedRadius * density
    motion.initialize(source, target, targetRadius, density, through, false,
      GlassMorphTuning(null, if (sourceHasGlass) GlassAbsorbRecord(duration = .48f) else null))
    motion.retarget(true)
    initialized = true
    settled = false
    completedOpen = null
    frameClock.restart(animationScale)
    beginMotion()
    applyFrame()
    if (triggerSnapshot?.attachOverlay(rootView) == false) { releaseTrigger(); applyFrame() }
    // Initial source geometry is drawn in this pre-draw before the first tick.
    invalidate()
  }

  private fun updateTarget() {
    if (!initialized || sourceHandoff.pending || width <= 0 || height <= 0) return
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

  private fun requestInteractionFrame() {
    if (!initialized || !requestedOpen || !isAttachedToWindow || windowVisibility != VISIBLE) return
    if (!callbackPosted) frameClock.restart(animationScale)
    applyFrame()
    beginMotion()
  }

  override fun doFrame(frameTimeNanos: Long) {
    traceMenu("RenaMenu/doFrame") {
      callbackPosted = false
      if (!initialized || !isAttachedToWindow || windowVisibility != VISIBLE) return
      val seconds = frameClock.advance(frameTimeNanos, display?.refreshRate ?: 60f)
      motionFrames++
      settled = motion.advanceBy(seconds)
      sourceJelly?.advance(seconds)
      interaction.motion.advance(seconds)
      if (!interaction.motion.jellySettled) jellyFrames++
      if (interaction.motion.plateAlpha > .001f) plateFrames++
      applyFrame()
      if (settled) {
        setInteractive(requestedOpen)
        emitComplete(requestedOpen)
      }
      if (!settled || (requestedOpen && !interaction.motion.isSettled)) beginMotion()
    }
  }

  private fun applyFrame() {
    traceMenu("RenaMenu/applyFrame") {
      if (!initialized) return
      liveFrame.copyFrom(motion.frame)
      updateSourcePose(liveFrame)
      triggerSnapshot?.updateOverlay(liveFrame)
      groupForeground?.update(liveFrame, target.left, target.top)
      interaction.motion.deform(liveFrame.bounds,
        if (source.centerX() > rootLocation[0] + rootView.width / 2f) -1f else 1f,
        if (target.centerY() < source.centerY()) -1f else 1f)
      val frame = liveFrame
      traceMenu("RenaMenu/outline") {
        outline.update(frame, target.left, target.top, settled, sourceHasGlass, lockedFieldStep)
      }
      traceMenu("RenaMenu/portalState") {
        foregroundPortal?.update(frame, target.left, target.top, sourceHasGlass, outline.smoothedField)
      }
      (getChildAt(0) as? LiquidGlassView)?.updateMenuField(frame, outline.path, target.left, target.top,
        sourceHasGlass && !settled, outline.smoothedField)
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
      val menuGlow = interaction.motion.glowValue * frame.contentProgress
      val jelly = sourceJelly
      val groupGlow = (jelly?.glowValue ?: 0f) * (1f - frame.contentProgress)
      val groupLight = jelly != null && groupGlow > menuGlow
      (getChildAt(0) as? LiquidGlassView)?.updateMenuPressLight(
        if (groupLight) source.left + jelly!!.lightPositionX else target.left + interaction.motion.lightPositionX,
        if (groupLight) source.top + jelly!!.lightPositionY else target.top + interaction.motion.lightPositionY,
        max(menuGlow, groupGlow), groupLight)
      traceMenu("RenaMenu/materialState") { (getChildAt(0) as? LiquidGlassView)?.updateMenuMorph(
        target.left + materialBounds.left, target.top + materialBounds.top,
        target.left + materialBounds.right, target.top + materialBounds.bottom, frame.radiusX, frame.radiusY,
        // A completely closed host is not drawn. Leave its bounded layers in
        // place until teardown rather than allocating a hidden full-size frame.
        !settled || !requestedOpen || interaction.isGestureActive || !interaction.motion.isSettled,
        // The existing toolbar has a plain RGBA fill. Crossfade that actual
        // source recipe into the unchanged menu recipe, rather than flashing a
        // new glass material over the pill at takeover or at final restoration.
        frame.contentProgress.coerceIn(0f, 1f)) }
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
        // The portal composites reveal in its bounded rows RenderNode. Setting
        // native body alpha first promotes the original full-layout RN view to
        // a second physical-size offscreen layer before it reaches that node.
        child.alpha = if (foregroundPortal != null && isHardwareAccelerated) 1f else reveal
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
      windowDrawing?.invalidate()
      (parent as? View)?.invalidate()
    }
  }

  override fun dispatchDraw(canvas: Canvas) {
    if (windowDrawing != null) return
    drawWindowFrame(canvas)
  }

  internal fun drawWindowFrame(canvas: Canvas) {
    if (!initialized) return
    if (settled && !requestedOpen) {
      if (sourceHandoff.pending) drawTerminalSource(canvas)
      return
    }
    val material = getChildAt(0) ?: return
    val save = canvas.save()
    try {
      canvas.clipPath(outline.path)
      // The background's native drawing child moves/measures in physical
      // pixels and samples its true screen origin. Never scale a captured page
      // into the changing shell: that makes the page slide/zoom inside glass.
      traceMenu("RenaMenu/drawMaterial") { drawChild(canvas, material, drawingTime) }
    } finally { canvas.restoreToCount(save) }
    drawSourceFill(canvas, liveFrame.contentProgress, true)
    if (sourceHasGlass) {
      val lightSave = canvas.save()
      canvas.clipPath(outline.path)
      canvas.translate(materialBounds.left, materialBounds.top)
      (material as? LiquidGlassView)?.drawMenuWindowPressLight(canvas,
        target.left + materialBounds.left, target.top + materialBounds.top,
        materialBounds.width(), materialBounds.height())
      canvas.restoreToCount(lightSave)
    }
    val portal = foregroundPortal
    val materialView = material as? LiquidGlassView
    fun drawRows(recording: Canvas) {
      traceMenu("RenaMenu/recordRows") {
        interaction.drawPlate(recording, localIncoming, if (settled) 1f else liveFrame.contentZoom,
          materialView?.dark ?: false, materialView?.highlightOpacity ?: 1f)
        for (index in 1 until childCount) drawChild(recording, getChildAt(index), drawingTime)
      }
    }
    if (portal != null && canvas.isHardwareAccelerated && !settled) {
      traceMenu("RenaMenu/drawPortal") { portal.draw(canvas, foregroundBounds, true, ::drawRows,
        if (sourceHasGlass) ({ recording -> groupForeground?.draw(recording) }) else null) }
    } else if (portal != null && canvas.isHardwareAccelerated) {
      val contentSave = canvas.save()
      canvas.clipPath(contentClip)
      portal.draw(canvas, foregroundBounds, false, ::drawRows)
      canvas.restoreToCount(contentSave)
    } else {
      val contentSave = canvas.save()
      canvas.clipPath(contentClip)
      drawRows(canvas)
      canvas.restoreToCount(contentSave)
      groupForeground?.draw(canvas)
    }
    // A bounded source View in the window overlay stays outside card clipping.
  }

  private fun drawSourceFill(canvas: Canvas, progress: Float, clipToMorph: Boolean) {
    val color = groupFillColor ?: return
    sourceFillBounds.set(liveFrame.sourceLobe)
    sourceFillBounds.offset(-target.left, -target.top)
    val alpha = menuGroupSourceFillAlpha(color, progress)
    if (alpha == 0) return
    sourceFillPaint.color = color
    sourceFillPaint.alpha = alpha
    val save = canvas.save()
    if (clipToMorph) canvas.clipPath(outline.path)
    canvas.drawRoundRect(sourceFillBounds, liveFrame.sourceRadius, liveFrame.sourceRadius, sourceFillPaint)
    canvas.restoreToCount(save)
  }

  /** No rows, material, incoming-circle clip or portal remains at handoff. */
  private fun drawTerminalSource(canvas: Canvas) {
    liveFrame.copyFrom(motion.frame)
    updateSourcePose(liveFrame)
    groupForeground?.update(liveFrame, target.left, target.top)
    sourceFillBounds.set(liveFrame.sourceLobe)
    sourceFillBounds.offset(-target.left, -target.top)
    preparedHandoffPatch?.let { patch ->
      if ((getChildAt(0) as? LiquidGlassView)?.isMenuHandoffPatchCurrent(patch, this) == true &&
        patch.draw(canvas, target.left, target.top, sourceFillBounds)) {
        handoffPatchState = "opaque-terminal"
      } else {
        handoffPatchState = "terminal-key-invalidated"
        handoffPatchDrawDeclines++
        preparedHandoffPatch = null
      }
    }
    drawSourceFill(canvas, 0f, false)
    val jelly = sourceJelly
    if (jelly != null && jelly.glowValue > .001f && canvas.isHardwareAccelerated) {
      val save = canvas.save()
      canvas.translate(sourceFillBounds.left, sourceFillBounds.top)
      terminalSourceLight?.draw(canvas, sourceFillBounds.width(), sourceFillBounds.height(),
        liveFrame.sourceRadius, density, 1f,
        source.left + jelly.lightPositionX - target.left - sourceFillBounds.left,
        source.top + jelly.lightPositionY - target.top - sourceFillBounds.top,
        jelly.glowValue, trigger = true)
      canvas.restoreToCount(save)
    }
    groupForeground?.draw(canvas)
  }

  private fun updateSourcePose(frame: GlassMorphFrame) {
    sourceJelly?.let { jelly ->
      val swell = jelly.swell(sourceControlHeight, density, 1f) - 1f
      frame.sourceLobe.inset(-frame.sourceLobe.width() * swell / 2f, -frame.sourceLobe.height() * swell / 2f)
      frame.sourceRadius = min(frame.sourceLobe.width(), frame.sourceLobe.height()) / 2f
    }
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (!interactive && !finiteInputReady()) return false
    if (event.actionMasked == MotionEvent.ACTION_DOWN && !localIncoming.contains(event.x, event.y)) return false
    if (!menuDragEnabled) return super.dispatchTouchEvent(event)
    return interaction.dispatch(event, requestedOpen && initialized) {
      if (interactive) super.dispatchTouchEvent(event) else false
    }
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
    foregroundPortal?.reserve(target, target.left, target.top, captureEnvelope, sourceHasGlass)
    lockedFieldStep = max(5f * density, max(captureEnvelope.width(), captureEnvelope.height()) / 64f)
    foregroundBounds.set(captureEnvelope)
    foregroundBounds.offset(-target.left, -target.top)
    windowDrawing?.attach(rootView, captureEnvelope)
  }
  private fun stopFrames() {
    if (callbackPosted) Choreographer.getInstance().removeFrameCallback(this)
    callbackPosted = false
    frameClock.restart(animationScale)
  }
  private fun emitComplete(open: Boolean, allowHandoff: Boolean = true) {
    if (completedOpen == open) return
    if (!open && allowHandoff && sourceHasGlass && beginSourceHandoff()) return
    completedOpen = open
    val completedSource = triggerSnapshot
    val wasGroupedSource = sourceHasGlass
    val hadGroupForeground = groupForeground != null
    val foregroundDiagnostics = if (motionTrace) groupForeground?.diagnostics() else null
    val sourceFill = groupFillColor
    val completedWindow = windowDrawing
    val patchDiagnostics = if (motionTrace) preparedHandoffPatch?.diagnostics() else null
    // Log the actual return, not a promise to restore the source after logging.
    if (!open) { releaseTrigger(); foregroundPortal?.release() }
    if (motionTrace) Log.d("ResonusGlass", "menuMotion session=$activeSession open=$open " +
      "durationMs=${SystemClock.uptimeMillis() - motionStartedAt} frames=$motionFrames " +
      "portal=${foregroundPortal?.diagnostics()} " +
      "materialRaster=${(getChildAt(0) as? LiquidGlassView)?.menuRasterDiagnostics()} " +
      "menuJellyFrames=$jellyFrames menuPlateFrames=$plateFrames menuSelectionDispatches=${interaction.selectionDispatches} " +
      "menuGroupRequested=$groupRequested menuGroupEligible=$groupEligible menuGroupedSource=$wasGroupedSource " +
      "menuGroupForeground=$hadGroupForeground menuWindowOwner=${completedWindow?.diagnostics()} " +
      "sourceForeground=$foregroundDiagnostics " +
      "menuSourceBounds=$source menuThroughBounds=$through menuSourceFillAlpha=${sourceFill?.ushr(24)} " +
      "sourceHandoffRegistered=$sourceHandoffRegistered sourceHandoffCommits=$sourceHandoffCommits " +
      "sourceHandoffFallbacks=$sourceHandoffFallbacks sourceHandoffReason=$sourceHandoffLastReason sourceHandoffMs=$sourceHandoffLastMs " +
      "sourceAtomicAttempts=$sourceAtomicAttempts sourceAtomicStaged=$sourceAtomicStaged sourceAtomicUncertain=$sourceAtomicUncertain sourceAtomicCommits=$sourceAtomicCommits " +
      "sourceAtomicTimeouts=$sourceAtomicTimeouts sourceAtomicState=$sourceAtomicState sourceAtomicPatchSkipped=$sourceAtomicPatchSkipped " +
      "sourceHandoffPatchState=$handoffPatchState sourceHandoffPatchDeclines=$handoffPatchDrawDeclines sourceHandoffPatch=$patchDiagnostics " +
      "menuGestureCancels=${interaction.gestureCancels} triggerSnapshotPresent=${completedSource != null} " +
      "sourceClone=${completedSource?.diagnostics()} sourceCapture=${MenuTriggerSnapshots.captureDiagnostics()}")
    onMotionComplete(mapOf("sessionId" to activeSession, "open" to open))
    if (open) queueHandoffPatchPreparation()
  }

  private fun queueHandoffPatchPreparation() {
    cancelHandoffPatchPreparation()
    if (!sourceHasGlass) return
    if (atomicSourceHandoffAvailable()) {
      sourceAtomicPatchSkipped = true
      handoffPatchState = "atomic-eligible-no-copy"
      return
    }
    val session = activeSession
    val preparation = Runnable {
      prepareHandoffPatchCallback = null
      if (activeSession != session || !requestedOpen || !settled || !sourceHasGlass || !isAttachedToWindow) return@Runnable
      if (atomicSourceHandoffAvailable()) {
        sourceAtomicPatchSkipped = true
        handoffPatchState = "atomic-eligible-no-copy"
        return@Runnable
      }
      val snapshot = triggerSnapshot ?: return@Runnable
      val sourceView = snapshot.sourceForHandoff() ?: run { handoffPatchState = "source-unavailable"; return@Runnable }
      preparedHandoffPatch = (getChildAt(0) as? LiquidGlassView)?.prepareMenuHandoffPatch(
        this, sourceView, RectF(source), snapshot.sourceHiddenAtUptime)
      handoffPatchState = if (preparedHandoffPatch != null) "prepared" else "qualification-or-copy-rejected"
    }
    prepareHandoffPatchCallback = preparation
    // Only once after open/rest, away from both animation and close frames.
    mainHandler.postDelayed(preparation, 48L)
  }

  private fun cancelHandoffPatchPreparation() {
    prepareHandoffPatchCallback?.let { mainHandler.removeCallbacks(it) }
    prepareHandoffPatchCallback = null
  }

  private fun beginSourceHandoff(): Boolean {
    if (sourceHandoff.pending) return true
    val snapshot = triggerSnapshot ?: return false
    val ticket = sourceHandoff.begin(activeSession) ?: return false
    handoffTicket = ticket
    handoffStartedAt = SystemClock.uptimeMillis()
    if (tryBeginAtomicSourceHandoff(snapshot, ticket)) return true
    preparedHandoffPatch?.let { patch ->
      if ((getChildAt(0) as? LiquidGlassView)?.isMenuHandoffPatchCurrent(patch, this) == true) {
        patch.beginHandoff()
      } else {
        preparedHandoffPatch = null
        handoffPatchState = "changed-before-handoff"
      }
    }
    if (preparedHandoffPatch == null && handoffPatchState == "not-prepared") handoffPatchState = "quick-close-no-patch"
    val registered = snapshot.restoreSourceForHandoff { sourceRoot ->
      val observer = sourceRoot.viewTreeObserver
      if (!observer.isAlive || !sourceRoot.isAttachedToWindow || !sourceRoot.isHardwareAccelerated) false
      else {
        val callback = Runnable { mainHandler.post { finishSourceHandoff(ticket, true, "source-buffer-committed") } }
        handoffObserver = observer
        handoffCommitCallback = callback
        observer.registerFrameCommitCallback(callback)
        sourceRoot.invalidate()
        true
      }
    }
    if (!registered) {
      cancelSourceHandoff()
      sourceHandoffLastReason = "source-unavailable"
      sourceHandoffFallbacks++
      return false
    }
    sourceHandoffRegistered++
    val timeout = Runnable { finishSourceHandoff(ticket, false, "commit-timeout") }
    handoffTimeout = timeout
    mainHandler.postDelayed(timeout, 200L)
    windowDrawing?.invalidate()
    return true
  }

  private fun atomicSourceHandoffAvailable(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return false
    val sourceRoot = triggerSnapshot?.sourceForHandoff()?.rootView ?: return false
    val dialogRoot = windowDrawing?.atomicHandoffRoot() ?: return false
    return try { MenuAtomicSourceHandoff.eligible(sourceRoot, dialogRoot) }
    catch (_: RuntimeException) { false }
    catch (_: LinkageError) { false }
  }

  private fun tryBeginAtomicSourceHandoff(snapshot: MenuTriggerSnapshot, ticket: MenuSourceHandoff.Ticket): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return false
    val sourceRoot = snapshot.sourceForHandoff()?.rootView ?: return false
    val drawing = windowDrawing ?: return false
    val dialogRoot = drawing.atomicHandoffRoot() ?: return false
    val eligible = try { MenuAtomicSourceHandoff.eligible(sourceRoot, dialogRoot) }
      catch (_: RuntimeException) { false } catch (_: LinkageError) { false }
    if (!eligible) return false
    sourceAtomicAttempts++
    val atomic = MenuAtomicSourceHandoff(mainHandler) {
      if (handoffTicket == ticket && isAttachedToWindow) {
        sourceAtomicCommits++
        finishSourceHandoff(ticket, true, "surface-transaction-committed")
      }
    }
    atomicSourceHandoff = atomic
    val result = atomic.begin(sourceRoot, dialogRoot) {
      // No ViewRoot mutation occurs in either add(null). Return the lease only
      // after both memberships and the transaction-committed listener exist.
      val restored = snapshot.restoreSourceForHandoff { currentSourceRoot ->
        currentSourceRoot === sourceRoot && windowDrawing === drawing &&
          drawing.atomicHandoffRoot() === dialogRoot && handoffTicket == ticket &&
          activeSession == ticket.session && !requestedOpen && isAttachedToWindow
      }
      if (restored) {
        drawing.hideForAtomicHandoff()
        sourceRoot.invalidate()
        dialogRoot.invalidate()
      }
      restored
    }
    sourceAtomicState = "source=${result.sourceJoined},target=${result.targetJoined},staged=${result.staged},uncertain=${result.stageUncertain},ready=${result.markedReady},${result.failure}"
    if (!result.staged && !result.stageUncertain) {
      // The finite failed group was released in finally. No source lease has
      // changed, so the existing lower-API/qualification fallback is still safe.
      atomic.cancel()
      atomicSourceHandoff = null
      return false
    }
    if (result.staged) sourceAtomicStaged++
    if (result.stageUncertain) sourceAtomicUncertain++
    sourceHandoffRegistered++
    preparedHandoffPatch = null
    handoffPatchState = "atomic-no-patch"
    // There is no public SSG cancel. Never launch the old 200ms fallback over
    // a staged sync; leave both roots alive for the compositor transaction.
    val timeout = Runnable {
      if (handoffTicket == ticket) {
        sourceAtomicTimeouts++
        finishSourceHandoff(ticket, false, "surface-transaction-timeout")
      }
    }
    handoffTimeout = timeout
    mainHandler.postDelayed(timeout, 2_000L)
    return true
  }

  private fun finishSourceHandoff(ticket: MenuSourceHandoff.Ticket, committed: Boolean, reason: String) {
    if (!sourceHandoff.finish(ticket, activeSession, requestedOpen)) return
    clearHandoffCallbacks()
    sourceHandoffLastMs = SystemClock.uptimeMillis() - handoffStartedAt
    sourceHandoffLastReason = reason
    if (committed) sourceHandoffCommits++ else sourceHandoffFallbacks++
    emitComplete(false, allowHandoff = false)
  }

  private fun clearHandoffCallbacks() {
    atomicSourceHandoff?.cancel()
    atomicSourceHandoff = null
    handoffTimeout?.let { mainHandler.removeCallbacks(it) }
    handoffTimeout = null
    val callback = handoffCommitCallback
    val observer = handoffObserver
    if (callback != null && observer?.isAlive == true) {
      try { observer.unregisterFrameCommitCallback(callback) } catch (_: RuntimeException) { }
    }
    handoffCommitCallback = null; handoffObserver = null; handoffTicket = null
  }

  private fun cancelSourceHandoff() {
    sourceHandoff.cancel()
    clearHandoffCallbacks()
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
  private fun releaseTrigger() {
    cancelHandoffPatchPreparation()
    preparedHandoffPatch = null
    triggerSnapshot?.release(); triggerSnapshot = null
    windowDrawing?.detach(); windowDrawing = null
    groupForeground?.release(); groupForeground = null
    sourceJelly = null; sourceHasGlass = false; groupFillColor = null
  }

  private fun isGroupDescendant(view: View, group: View): Boolean {
    var current: View? = view
    while (current != null) {
      if (current === group) return true
      current = current.parent as? View
    }
    return false
  }

  private fun setScreenBounds(view: View, out: RectF, normalizeTouch: Boolean) {
    view.getLocationOnScreen(location)
    val w = view.width * abs(view.scaleX)
    val h = view.height * abs(view.scaleY)
    val normalizedW = if (normalizeTouch) max(w, 44f * density) else w
    val normalizedH = if (normalizeTouch) max(h, 44f * density) else h
    val centerX = location[0] + w / 2f
    val centerY = location[1] + h / 2f
    out.set(centerX - normalizedW / 2f, centerY - normalizedH / 2f,
      centerX + normalizedW / 2f, centerY + normalizedH / 2f)
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
  // Measurement is read-only. Snapshot ownership comes only from sourceRect's
  // explicit sixth tag, synchronously resolved when that menu actually opens.
  return listOf(location[0] / density, location[1] / density,
    view.width * abs(view.scaleX) / density, view.height * abs(view.scaleY) / density, corner / density)
}
