package expo.modules.liquidglass

import android.graphics.Canvas
import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import android.os.SystemClock
import android.os.Process
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.SurfaceView
import android.view.TextureView
import com.facebook.react.R
import androidx.annotation.RequiresApi
import expo.modules.liquidglass.menumotion.GlassMorphFrame
import expo.modules.liquidglass.menumotion.MenuSourceOwnership
import expo.modules.liquidglass.menumotion.menuSourcePixels
import expo.modules.liquidglass.menumotion.MenuSourceCapture
import expo.modules.liquidglass.menumotion.handoffMenuSourceAfterRegistration
import java.io.File
import java.io.FileOutputStream
import java.lang.ref.WeakReference
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.ceil

/** One measured trigger, never a retained View/event registry. All calls run on MAIN. */
@RequiresApi(Build.VERSION_CODES.S)
internal object MenuTriggerSnapshots {
  private const val MAX_PIXEL_COUNT = 360_000L
  private var active = WeakReference<MenuTriggerSnapshot>(null)
  private val capturedOwners = ArrayList<WeakReference<MenuTriggerSnapshot>>()
  private var captureDepth = 0
  private var lastCapture: Map<String, Any> = emptyMap()
  private var captureSerial = 0L
  private val diagnosticRun = "menu-source-${Process.myPid()}-${SystemClock.uptimeMillis()}"
  fun captureDiagnostics(): Map<String, Any> = lastCapture
  fun beginCapture(root: View, captureSource: View, activityDecor: View?) {
    captureDepth++
    active.get()?.let { if (it.suppressForCapture(root, captureSource, activityDecor)) capturedOwners.add(WeakReference(it)) }
  }
  fun endCapture() {
    captureDepth = (captureDepth - 1).coerceAtLeast(0)
    if (captureDepth != 0) return
    val owners = capturedOwners.toList()
    capturedOwners.clear()
    owners.forEach { it.get()?.restoreAfterCapture() }
  }

  fun take(sourceScreen: RectF, exactView: View?, authorizedGroup: Boolean = false): MenuTriggerSnapshot? {
    lastCapture = mapOf("sourceCaptureMode" to "geometry-only")
    // A replacement owns the real source, including if it reuses the same view.
    active.get()?.release()
    if (!valid(sourceScreen)) return null
    val view = exactView ?: return null
    val groupedSource = authorizedGroup && view is MenuTriggerGroupView
    if (authorizedGroup && !groupedSource) return null
    // The source material keeps its real solid RGBA separately from foreground
    // pixels. Unknown gradient/image backgrounds cannot be faithfully handed
    // to that field, so keep the original group instead of baking/doubling it.
    if (groupedSource && (view as MenuTriggerGroupView).sourceFillColor() == null) return null
    val metadata = linkedMapOf<String, Any>("sourceCaptureMode" to "software-once",
      "sourceCaptureClass" to view.javaClass.name, "sourceCaptureChildCount" to if (view is ViewGroup) view.childCount else 0,
      "sourceCaptureTag" to view.id, "sourceCaptureWidth" to view.width, "sourceCaptureHeight" to view.height,
      "sourceCaptureViewAlpha" to view.alpha, "sourceCaptureTransitionAlpha" to view.transitionAlpha,
      "sourceCaptureExplicitGroup" to groupedSource)
    lastCapture = metadata
    val density = view.resources.displayMetrics.density
    if (!density.isFinite() || density <= 0f || !view.isAttachedToWindow || !view.isShown ||
      view.width <= 0 || view.height <= 0 || view.alpha <= 0f || view.transitionAlpha <= 0f) return null
    // Never erase a whole list row, page, or a native glass surface to obtain a glyph.
    if (view.width > 256f * density || view.height > 96f * density || view.width.toLong() * view.height > MAX_PIXEL_COUNT ||
      view.scrollX != 0 || view.scrollY != 0 || containsGlass(view, 0)) return null
    // Only the dedicated, explicitly referenced native group may contain more
    // than one control. A coincidentally small shared row is still not a group.
    if (!groupedSource && interactiveCount(view, 0) > 1) return null
    if (groupedSource && interactiveCount(view, 0, 6) > 6) return null
    val location = IntArray(2)
    view.getLocationOnScreen(location)
    val live = RectF(location[0].toFloat(), location[1].toFloat(),
      location[0] + view.width * abs(view.scaleX), location[1] + view.height * abs(view.scaleY))
    val tolerance = 32f * density
    if (!sameOrigin(sourceScreen, live, tolerance)) return null
    // An exact-ref fast tap need not wait for JS measurement. Reconcile the
    // same normalized hit envelope against that live control synchronously.
    val sourceWidth = if (groupedSource) live.width() else max(live.width(), 44f * density)
    val sourceHeight = if (groupedSource) live.height() else max(live.height(), 44f * density)
    sourceScreen.set(live.centerX() - sourceWidth / 2f, live.centerY() - sourceHeight / 2f,
      live.centerX() + sourceWidth / 2f, live.centerY() + sourceHeight / 2f)
    // A hardware view.draw(RenderNode canvas) can retain live child display-list
    // references. Pixel commands below must be independent before source alpha
    // changes or any Activity/backdrop redraw can alter those child nodes.
    val started = SystemClock.uptimeMillis()
    var mutable: Bitmap? = null
    val immutable: Bitmap
    try {
      mutable = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
      mutable.density = view.resources.displayMetrics.densityDpi
      val software = Canvas(mutable)
      software.clipRect(0, 0, view.width, view.height)
      // The source glass is rendered by the menu's shared material field.
      // Capture only group children, exactly like upstream recordContent(), so
      // its original JS/native background is not tinted/drawn a second time.
      if (groupedSource) (view as MenuTriggerGroupView).drawMenuForeground(software)
      else view.draw(software)
      val pixels = IntArray(view.width * view.height)
      mutable.getPixels(pixels, 0, view.width, 0, 0, view.width, view.height)
      val stats = menuSourcePixels(view.width, view.height, pixels)
      metadata["sourceBitmapAlphaPixels"] = stats.nonTransparent
      metadata["sourceBitmapOpaquePixels"] = stats.opaque
      metadata["sourceBitmapBrightPixels"] = stats.bright
      metadata["sourceBitmapMaxAlpha"] = stats.maxAlpha
      metadata["sourceBitmapAlphaSum"] = stats.alphaSum
      metadata["sourceBitmapSha256"] = stats.sha256
      if (!stats.hasContent) { metadata["sourceCaptureResult"] = "empty-rejected"; return null }
      immutable = mutable.copy(Bitmap.Config.ARGB_8888, false) ?: run {
        metadata["sourceCaptureResult"] = "copy-rejected"; return null
      }
      if (immutable.isMutable) { metadata["sourceCaptureResult"] = "mutable-rejected"; return null }
    } catch (error: RuntimeException) {
      metadata["sourceCaptureResult"] = "software-unsupported"
      metadata["sourceCaptureErrorClass"] = error.javaClass.name
      return null
    } catch (_: OutOfMemoryError) {
      metadata["sourceCaptureResult"] = "memory-rejected"
      return null
    } finally {
      // This buffer was never submitted to HWUI. The immutable copy is retained
      // normally, without recycling pixels still referenced by a RenderThread.
      mutable?.recycle()
      metadata["sourceCaptureDurationMs"] = SystemClock.uptimeMillis() - started
    }
    metadata["sourceCaptureResult"] = "immutable-ready"
    metadata["sourceBitmapMutable"] = immutable.isMutable
    metadata["sourceBitmapDensity"] = immutable.density
    metadata["sourceBitmapPixelBytes"] = immutable.byteCount
    if (Log.isLoggable("ResonusGlassSource", Log.DEBUG)) {
      val directory = File(view.context.externalCacheDir ?: view.context.cacheDir, diagnosticRun)
      val file = File(directory, "trigger-${view.id}-${++captureSerial}.png")
      metadata["sourceCapturePng"] = file.absolutePath
      val hash = metadata["sourceBitmapSha256"]
      Thread({
        try {
          if (!directory.isDirectory && !directory.mkdirs()) return@Thread
          FileOutputStream(file).use { immutable.compress(Bitmap.CompressFormat.PNG, 100, it) }
          Log.d("ResonusGlass", "sourceCapturePng=${file.absolutePath} sourceBitmapSha256=$hash")
        } catch (_: Exception) { Log.d("ResonusGlass", "sourceCapturePng=write-failed") }
      }, "menu-source-png").apply { isDaemon = true; priority = Thread.MIN_PRIORITY; start() }
    }
    val guard = ceil(13f * density).toInt()
    if ((view.width + guard * 2).toLong() * (view.height + guard * 2) > 720_000L) {
      metadata["sourceCaptureResult"] = "owner-budget-rejected"
      return null
    }
    val snapshot = MenuTriggerSnapshot(view, immutable, metadata.toMap(), density,
      sourceScreen.width(), sourceScreen.height(), groupedSource)
    active = WeakReference(snapshot)
    return snapshot
  }

  internal fun owns(snapshot: MenuTriggerSnapshot): Boolean = active.get() === snapshot
  internal fun forget(snapshot: MenuTriggerSnapshot) { if (owns(snapshot)) active.clear() }
  /** Restore before RN can recycle the original physical group's native tag. */
  internal fun releaseSource(view: View) {
    active.get()?.takeIf { it.referencesSource(view) }?.onSourceDetached(view)
  }

  private fun valid(rect: RectF): Boolean = rect.left.isFinite() && rect.top.isFinite() &&
    rect.right.isFinite() && rect.bottom.isFinite() && rect.width() > 0f && rect.height() > 0f

  private fun sameOrigin(a: RectF, b: RectF, tolerance: Float): Boolean =
    abs(a.centerX() - b.centerX()) <= tolerance && abs(a.centerY() - b.centerY()) <= tolerance &&
      a.left <= b.right + tolerance && a.right >= b.left - tolerance &&
      a.top <= b.bottom + tolerance && a.bottom >= b.top - tolerance

  private fun containsGlass(view: View, depth: Int): Boolean {
    if (view is LiquidGlassView || view is MenuMorphView || view is SurfaceView || view is TextureView) return true
    if (view !is ViewGroup) return false
    if (depth >= 4 || view.childCount > 16) return true
    for (index in 0 until view.childCount) {
      val child = view.getChildAt(index) ?: return true
      if (child.parent !== view || containsGlass(child, depth + 1)) return true
    }
    return false
  }

  /** A toolbar can be small, but it is not one trigger. Fail closed on opaque trees. */
  private fun interactiveCount(view: View, depth: Int, maximum: Int = 1): Int {
    val role = view.getTag(R.id.accessibility_role)?.toString()?.uppercase()
    var count = if (view.isClickable || view.isLongClickable || role in setOf(
      "BUTTON", "IMAGEBUTTON", "LINK", "MENUITEM", "CHECKBOX", "RADIO", "SWITCH", "TOGGLEBUTTON")) 1 else 0
    if (view !is ViewGroup) return count
    if (depth >= 8 || view.childCount > 64) return maximum + 1
    for (index in 0 until view.childCount) {
      val child = view.getChildAt(index) ?: continue
      if (child.parent !== view) return maximum + 1
      count += interactiveCount(child, depth + 1, maximum)
      if (count > maximum) return count
    }
    return count
  }
}

/** A small overlay View replays immutable pixels; source restoration retains only a weak View reference. */
@RequiresApi(Build.VERSION_CODES.S)
internal class MenuTriggerSnapshot internal constructor(view: View,
  @Suppress("unused") private val sourcePixels: Bitmap, private val captureMetadata: Map<String, Any>,
  private val density: Float, private val morphSourceWidth: Float, private val morphSourceHeight: Float,
  internal val isGroupedSource: Boolean = false) {
  private companion object {
    val CLOSING_SAMPLE_TIMES_MS = longArrayOf(50L, 100L, 150L, 200L, 300L, 450L)
  }

  // Resolve once per source session. Ordinary motion must not allocate diagnostic
  // samples or query Canvas clips/uptime while HWUI replays the immutable pixels.
  private val diagnosticsEnabled = Log.isLoggable("ResonusGlass", Log.DEBUG) ||
    Log.isLoggable("ResonusGlassSource", Log.DEBUG)
  private val source = WeakReference(view)
  private val sourceId = view.id
  private val sourceParent = WeakReference(view.parent as? View)
  private val sourceRoot = WeakReference(view.rootView)
  private val originalTransitionAlpha = view.transitionAlpha
  private val width = view.width.toFloat()
  private val height = view.height.toFloat()
  private val blurEffects = arrayOfNulls<RenderEffect>(18)
  private var lastBlurStep = -1
  private val ownership = MenuSourceOwnership()
  private val captureState = MenuSourceCapture()
  private val sourcePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val guard = ceil(13f * density).toInt()
  private val pixelRect = Rect(guard, guard, guard + view.width, guard + view.height)
  private var overlayRoot = WeakReference<View>(null)
  private val overlayFrame = GlassMorphFrame()
  private val overlayLocation = IntArray(2)
  private val clip = Rect()
  private val glyphBounds = RectF()
  private var hasFrame = false
  private var groupedRendering = false
  private var sourceLeaseReturned = false
  private var sourceLeaseReturnCount = 0L
  private var sourceAlphaRestoreCount = 0L
  private var idChangedBeforeReturn = false
  private var sourceListenerAttached = false
  private val sourceAttachListener = object : View.OnAttachStateChangeListener {
    override fun onViewAttachedToWindow(view: View) = Unit
    override fun onViewDetachedFromWindow(view: View) { onSourceDetached(view) }
  }
  /** Borrow immutable pixels only; the drawing owner must never recycle them. */
  internal val groupForegroundBitmap: Bitmap? get() = sourcePixels.takeIf { isGroupedSource && !ownership.released }
  internal val groupForegroundWidth: Int get() = sourcePixels.width
  internal val groupForegroundHeight: Int get() = sourcePixels.height

  /** Called only after the native window foreground owner is really attached.
   * It must own group pixels and glass in one portal, never a second old copy. */
  internal fun setGroupedRendering(enabled: Boolean) {
    if (!isGroupedSource || ownership.released || groupedRendering == enabled) return
    if (!enabled && ownership.attached) detachOverlay()
    groupedRendering = enabled
  }
  private var draws = 0L
  private var clipMisses = 0L
  private var lastRecordingAt = 0L
  private var lastRecordedClipMiss = false
  private var closingAt = 0L
  private var nextClosingSample = 0
  private var captureSuppressions = 0L
  private var captureRestores = 0L
  private var captureDraws = 0L
  private val samples = linkedMapOf<Int, Map<String, Any>>()
  private val sourceOwner = object : View(view.context) {
    init {
      isClickable = false; isFocusable = false
      importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
      setWillNotDraw(false)
      isForceDarkAllowed = false
    }
    override fun onDraw(canvas: Canvas) {
      if (!hasFrame || ownership.released) return
      // Real pixels always live in this independent small View display list.
      // Capture exclusion changes visibility, never erases this drawing body.
      canvas.drawBitmap(sourcePixels, null, pixelRect, sourcePaint)
      if (diagnosticsEnabled) {
        if (WindowBackdrops.isCapturing) captureDraws++
        recordDraw(canvas)
      }
    }
  }

  internal fun referencesSource(view: View): Boolean = source.get() === view

  /** Returning an original View is separate from retiring its drawing owner.
   * Immutable foreground pixels may finish a close after the source detaches. */
  internal fun onSourceDetached(view: View) {
    if (source.get() !== view) return
    returnSourceLease(view)
    source.clear()
    sourceParent.clear()
    sourceRoot.clear()
  }

  private fun returnSourceLease(view: View?) {
    if (sourceLeaseReturned) return
    sourceLeaseReturned = true
    val currentOwner = MenuTriggerSnapshots.owns(this)
    // Capture/retarget remain tag-strict. Cleanup owns the weak physical
    // instance's still-zero alpha, including an id reset before detach.
    val exactSource = view != null && source.get() === view
    val hadLease = ownership.hidden
    idChangedBeforeReturn = hadLease && currentOwner && exactSource && view?.id != sourceId
    if (hadLease && currentOwner && exactSource) sourceLeaseReturnCount++
    if (ownership.returnSource(currentOwner, exactSource, view?.transitionAlpha == 0f)) {
      view?.transitionAlpha = originalTransitionAlpha
      sourceAlphaRestoreCount++
    }
    if (isGroupedSource && hadLease && currentOwner && exactSource)
      (view as? MenuTriggerGroupView)?.setMenuSourceActive(false)
    if (sourceListenerAttached) view?.removeOnAttachStateChangeListener(sourceAttachListener)
    sourceListenerAttached = false
  }

  private fun sameSourcePlacement(view: View): Boolean = !isGroupedSource ||
    (view.parent === sourceParent.get() && view.rootView === sourceRoot.get())

  /** Keep the immutable group foreground alive until its real Activity has
   * committed the restored original. The native owner supplies bounded wait /
   * cancellation; a missing or replaced source must never block dismissal. */
  internal fun restoreSourceForHandoff(registerBeforeRestore: (View) -> Boolean): Boolean {
    val view = source.get() ?: return false
    val root = sourceRoot.get() ?: return false
    return handoffMenuSourceAfterRegistration(
      valid = { isGroupedSource && !ownership.released && !sourceLeaseReturned && ownership.attached && ownership.hidden &&
        MenuTriggerSnapshots.owns(this) && source.get() === view && view.id == sourceId &&
        view.transitionAlpha == 0f && view.isAttachedToWindow && view.isShown && sameSourcePlacement(view) && view.rootView === root &&
        root.isAttachedToWindow && root.isHardwareAccelerated && root.isShown &&
        root.windowVisibility == View.VISIBLE && root.viewTreeObserver.isAlive },
      register = { registerBeforeRestore(root) },
      restore = { returnSourceLease(view) }
    )
  }

  /** A bounded View owns pixels/filtering; no Drawable or borrowed RenderNode. */
  fun attachOverlay(root: View): Boolean {
    if (ownership.released || sourceLeaseReturned || (isGroupedSource && !groupedRendering) || !hasFrame || root !is ViewGroup || !root.isAttachedToWindow ||
      !root.isHardwareAccelerated || root.width <= 0 || root.height <= 0 || !MenuTriggerSnapshots.owns(this)) return false
    val view = source.get() ?: return false
    if (!view.isAttachedToWindow || view.id != sourceId || !view.isShown || !sameSourcePlacement(view) ||
      (!ownership.hidden && view.transitionAlpha != originalTransitionAlpha)) return false
    val previousRoot = overlayRoot.get()
    if (previousRoot != null && previousRoot !== root) { detachOverlay(); return false }
    if (ownership.attached && previousRoot === root) return true
    overlayRoot = WeakReference(root)
    val ownerWidth = width.toInt() + guard * 2
    val ownerHeight = height.toInt() + guard * 2
    sourceOwner.measure(View.MeasureSpec.makeMeasureSpec(ownerWidth, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(ownerHeight, View.MeasureSpec.EXACTLY))
    sourceOwner.layout(0, 0, ownerWidth, ownerHeight)
    try { root.overlay.add(sourceOwner) } catch (_: RuntimeException) {
      try { root.overlay.remove(sourceOwner) } catch (_: RuntimeException) { /* release retries */ }
      if (sourceOwner.parent == null) overlayRoot.clear()
      return false
    }
    if (!ownership.attach(MenuTriggerSnapshots.owns(this), view.id == sourceId, sourceOwner.parent != null)) {
      root.overlay.remove(sourceOwner); overlayRoot.clear(); return false
    }
    sourceOwner.visibility = if (groupedRendering) View.INVISIBLE else View.VISIBLE
    applyOwnerFrame()
    view.transitionAlpha = 0f
    view.addOnAttachStateChangeListener(sourceAttachListener)
    sourceListenerAttached = true
    if (isGroupedSource) (view as? MenuTriggerGroupView)?.setMenuSourceActive(true)
    sourceOwner.invalidate()
    root.invalidate()
    return true
  }

  fun detachOverlay() {
    val view = source.get()
    returnSourceLease(view)
    ownership.detach(false, false, false)
    sourceOwner.visibility = View.INVISIBLE
    try { (overlayRoot.get() as? ViewGroup)?.overlay?.remove(sourceOwner) }
    catch (_: RuntimeException) { /* cleanup cannot block completion */ }
    finally { overlayRoot.clear() }
  }

  fun updateOverlay(frame: GlassMorphFrame) {
    if (ownership.released) return
    overlayFrame.copyFrom(frame)
    hasFrame = true
    applyOwnerFrame()
    // Only RenderNode properties change during motion. The bitmap drawing body
    // remains valid; invalidating it here would re-record identical pixels each
    // tick instead of letting HWUI replay the sourceOwner's cached display list.
  }

  private fun applyOwnerFrame() {
    val root = overlayRoot.get() ?: return
    root.getLocationOnScreen(overlayLocation)
    val frame = overlayFrame
    val sx = frame.sourceLobe.width() / max(morphSourceWidth, 1f) * frame.sourceZoom
    val sy = frame.sourceLobe.height() / max(morphSourceHeight, 1f) * frame.sourceZoom
    sourceOwner.pivotX = sourceOwner.width / 2f
    sourceOwner.pivotY = sourceOwner.height / 2f
    sourceOwner.translationX = frame.sourceLobe.centerX() - overlayLocation[0] - sourceOwner.width / 2f
    sourceOwner.translationY = frame.sourceLobe.centerY() - overlayLocation[1] - sourceOwner.height / 2f
    sourceOwner.scaleX = sx
    sourceOwner.scaleY = sy
    sourceOwner.alpha = frame.sourceOpacity.coerceIn(0f, 1f)
    val step = (frame.sourceBlur / density * 4f).roundToInt().coerceIn(0, blurEffects.lastIndex)
    if (step != lastBlurStep) {
      lastBlurStep = step
      sourceOwner.setRenderEffect(if (step == 0) null else blurEffects[step] ?: RenderEffect.createBlurEffect(
        step * density / 4f, step * density / 4f, Shader.TileMode.DECAL).also { blurEffects[step] = it })
    }
    glyphBounds.set(frame.sourceLobe.centerX() - overlayLocation[0] - width * sx / 2f,
      frame.sourceLobe.centerY() - overlayLocation[1] - height * sy / 2f,
      frame.sourceLobe.centerX() - overlayLocation[0] + width * sx / 2f,
      frame.sourceLobe.centerY() - overlayLocation[1] + height * sy / 2f)
    if (diagnosticsEnabled) recordOwnerFrame()
  }

  fun suppressForCapture(root: View, captureSource: View, activityDecor: View?): Boolean {
    val ownerRoot = overlayRoot.get() ?: return false
    val included = ownerRoot === captureSource ||
      (captureSource === root && ownerRoot === activityDecor)
    if (!captureState.stage(included, MenuTriggerSnapshots.owns(this) && ownership.attached,
        sourceOwner.visibility == View.VISIBLE && sourceOwner.alpha > .001f)) return false
    WindowBackdrops.onMenuSourceCaptureStaging(ownerRoot)
    sourceOwner.visibility = View.INVISIBLE
    captureSuppressions++
    return true
  }

  fun restoreAfterCapture() {
    if (!captureState.finish(true, MenuTriggerSnapshots.owns(this) && ownership.attached && !ownership.released)) return
    sourceOwner.visibility = if (groupedRendering) View.INVISIBLE else View.VISIBLE
    sourceOwner.invalidate()
    overlayRoot.get()?.invalidate()
    captureRestores++
  }

  fun beginClosing() {
    if (!diagnosticsEnabled) return
    closingAt = SystemClock.uptimeMillis()
    nextClosingSample = 0
    samples.clear()
  }
  fun diagnostics(): Map<String, Any> {
    val root = overlayRoot.get()
    val chain = ArrayList<Map<String, Any>>()
    var ancestor: View? = sourceOwner
    while (ancestor != null && chain.size < 8) {
      chain.add(mapOf("class" to ancestor.javaClass.name, "alpha" to ancestor.alpha,
        "transitionAlpha" to ancestor.transitionAlpha, "visibility" to ancestor.visibility))
      ancestor = ancestor.parent as? View
    }
    return mapOf("sourceOverlayAttached" to ownership.attached,
      "sourceOwnerKind" to if (groupedRendering) "group-window-foreground" else "bounded-view",
      "sourceCaptureExplicitGroup" to isGroupedSource,
      "sourceLeaseReturned" to sourceLeaseReturned, "idChangedBeforeReturn" to idChangedBeforeReturn,
      "sourceLeaseReturnCount" to sourceLeaseReturnCount, "sourceAlphaRestoreCount" to sourceAlphaRestoreCount,
      "sourceOwnerWidth" to sourceOwner.width, "sourceOwnerHeight" to sourceOwner.height,
      "sourceOwnerPixels" to sourceOwner.width.toLong() * sourceOwner.height,
      "sourceOwnerRootClass" to (root?.javaClass?.name ?: "none"),
      "sourceOwnerRootAlpha" to (root?.alpha ?: -1f), "sourceOwnerRootTransitionAlpha" to (root?.transitionAlpha ?: -1f),
      "sourceOwnerChain" to chain, "sourceCaptureSuppressCount" to captureSuppressions,
      "sourceCaptureRestoreCount" to captureRestores, "sourceOwnerCaptureDraws" to captureDraws,
      "sourceOwnerDiagnosticsEnabled" to diagnosticsEnabled,
      "sourceOwnerDisplayListRecordings" to draws,
      // Compatibility alias: these count onDraw/display-list recordings, not
      // visible GPU frames. Cached pixels can be visible without another onDraw.
      "sourceCloneDraws" to draws, "sourceCloneClipMisses" to clipMisses,
      "sourceCloneLastBounds" to listOf(glyphBounds.left, glyphBounds.top, glyphBounds.right, glyphBounds.bottom),
      "sourceOwnerLastRecordedLocalClip" to if (draws > 0L) listOf(clip.left, clip.top, clip.right, clip.bottom) else emptyList<Int>(),
      "sourceOwnerLastRecordedClipMiss" to lastRecordedClipMiss,
      "sourceCloneClosingSamples" to samples.values.toList(), "sourceCapture" to captureMetadata)
  }

  /** Refresh only the same live weak source; never resolve a replacement row/tag. */
  fun currentScreenBounds(out: RectF): Boolean {
    if (ownership.released || sourceLeaseReturned || !MenuTriggerSnapshots.owns(this)) return false
    val view = source.get() ?: return false
    if (!view.isAttachedToWindow || view.id != sourceId || !view.isShown || !sameSourcePlacement(view) || view.width <= 0 || view.height <= 0) return false
    val location = IntArray(2)
    view.getLocationOnScreen(location)
    val sx = abs(view.scaleX)
    val sy = abs(view.scaleY)
    if (!sx.isFinite() || !sy.isFinite() || sx <= 0f || sy <= 0f) return false
    // Keep the original normalized hit diameter; refresh its actual center.
    val x = location[0] + view.width * sx / 2f
    val y = location[1] + view.height * sy / 2f
    out.set(x - morphSourceWidth / 2f, y - morphSourceHeight / 2f,
      x + morphSourceWidth / 2f, y + morphSourceHeight / 2f)
    return true
  }

  private fun recordDraw(canvas: Canvas) {
    // Called only by the DEBUG onDraw path. This is a real local Canvas clip at
    // display-list recording time, not an assertion that a GPU frame was drawn.
    canvas.getClipBounds(clip)
    lastRecordedClipMiss = !Rect.intersects(clip, pixelRect)
    lastRecordingAt = SystemClock.uptimeMillis()
    draws++
    if (lastRecordedClipMiss) clipMisses++
  }

  private fun recordOwnerFrame() {
    if (closingAt == 0L || nextClosingSample >= CLOSING_SAMPLE_TIMES_MS.size) return
    val now = SystemClock.uptimeMillis()
    val elapsed = now - closingAt
    while (nextClosingSample < CLOSING_SAMPLE_TIMES_MS.size &&
      elapsed >= CLOSING_SAMPLE_TIMES_MS[nextClosingSample]) {
      val at = CLOSING_SAMPLE_TIMES_MS[nextClosingSample++].toInt()
      samples[at] = mapOf("atMs" to elapsed, "sampleOrigin" to "view-properties",
        "sourceAlpha" to sourceOwner.alpha,
        "bounds" to listOf(glyphBounds.left, glyphBounds.top, glyphBounds.right, glyphBounds.bottom),
        "displayListRecordings" to draws,
        "lastRecordingAgeMs" to if (lastRecordingAt > 0L) now - lastRecordingAt else -1L,
        "lastRecordedLocalClip" to if (draws > 0L) listOf(clip.left, clip.top, clip.right, clip.bottom) else emptyList<Int>(),
        "lastRecordedClipMiss" to lastRecordedClipMiss)
    }
  }

  fun release() {
    if (!ownership.release()) return
    detachOverlay()
    if (MenuTriggerSnapshots.owns(this)) MenuTriggerSnapshots.forget(this)
    source.clear()
    sourceParent.clear()
    sourceRoot.clear()
    captureState.release()
    sourceOwner.alpha = 0f
    sourceOwner.setRenderEffect(null)
    blurEffects.fill(null)
  }
}
