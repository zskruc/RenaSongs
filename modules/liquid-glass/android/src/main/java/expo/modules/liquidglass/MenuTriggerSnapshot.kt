package expo.modules.liquidglass

import android.graphics.Canvas
import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.ColorFilter
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import android.os.SystemClock
import android.os.Process
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.SurfaceView
import android.view.TextureView
import android.graphics.drawable.Drawable
import com.facebook.react.R
import androidx.annotation.RequiresApi
import expo.modules.liquidglass.menumotion.GlassMorphFrame
import expo.modules.liquidglass.menumotion.MenuSourceOwnership
import expo.modules.liquidglass.menumotion.menuSourcePixels
import java.io.File
import java.io.FileOutputStream
import java.lang.ref.WeakReference
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** One measured trigger, never a retained View/event registry. All calls run on MAIN. */
@RequiresApi(Build.VERSION_CODES.S)
internal object MenuTriggerSnapshots {
  private const val MAX_PIXEL_COUNT = 360_000L
  private var active = WeakReference<MenuTriggerSnapshot>(null)
  private var lastCapture: Map<String, Any> = emptyMap()
  private var captureSerial = 0L
  private val diagnosticRun = "menu-source-${Process.myPid()}-${SystemClock.uptimeMillis()}"
  fun captureDiagnostics(): Map<String, Any> = lastCapture

  fun take(sourceScreen: RectF, exactView: View?): MenuTriggerSnapshot? {
    lastCapture = mapOf("sourceCaptureMode" to "geometry-only")
    // A replacement owns the real source, including if it reuses the same view.
    active.get()?.release()
    if (!valid(sourceScreen)) return null
    val view = exactView ?: return null
    val metadata = linkedMapOf<String, Any>("sourceCaptureMode" to "software-once",
      "sourceCaptureClass" to view.javaClass.name, "sourceCaptureChildCount" to if (view is ViewGroup) view.childCount else 0,
      "sourceCaptureTag" to view.id, "sourceCaptureWidth" to view.width, "sourceCaptureHeight" to view.height,
      "sourceCaptureViewAlpha" to view.alpha, "sourceCaptureTransitionAlpha" to view.transitionAlpha)
    lastCapture = metadata
    val density = view.resources.displayMetrics.density
    if (!density.isFinite() || density <= 0f || !view.isAttachedToWindow || !view.isShown ||
      view.width <= 0 || view.height <= 0 || view.alpha <= 0f || view.transitionAlpha <= 0f) return null
    // Never erase a whole list row, page, or a native glass surface to obtain a glyph.
    if (view.width > 256f * density || view.height > 96f * density || view.width.toLong() * view.height > MAX_PIXEL_COUNT ||
      view.scrollX != 0 || view.scrollY != 0 || containsGlass(view, 0) ||
      interactiveCount(view, 0) > 1) return null
    val location = IntArray(2)
    view.getLocationOnScreen(location)
    val live = RectF(location[0].toFloat(), location[1].toFloat(),
      location[0] + view.width * abs(view.scaleX), location[1] + view.height * abs(view.scaleY))
    val tolerance = 32f * density
    if (!sameOrigin(sourceScreen, live, tolerance)) return null
    // An exact-ref fast tap need not wait for JS measurement. Reconcile the
    // same normalized hit envelope against that live control synchronously.
    val sourceWidth = max(live.width(), 44f * density)
    val sourceHeight = max(live.height(), 44f * density)
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
      view.draw(software)
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
    val node = RenderNode("RenaSongs immutable menu trigger")
    node.setPosition(0, 0, view.width, view.height)
    try {
      val recording = node.beginRecording(view.width, view.height)
      try {
        recording.clipRect(0, 0, view.width, view.height)
        // Explicit pixel rectangles bypass Canvas/Bitmap density conversion.
        recording.drawBitmap(immutable, null, Rect(0, 0, view.width, view.height),
          Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
      } finally { node.endRecording() }
    } catch (_: RuntimeException) {
      metadata["sourceCaptureResult"] = "record-rejected"
      node.discardDisplayList()
      return null
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
    val snapshot = MenuTriggerSnapshot(view, node, immutable, metadata.toMap(), density, sourceScreen.width(), sourceScreen.height())
    active = WeakReference(snapshot)
    return snapshot
  }

  internal fun owns(snapshot: MenuTriggerSnapshot): Boolean = active.get() === snapshot
  internal fun forget(snapshot: MenuTriggerSnapshot) { if (owns(snapshot)) active.clear() }

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
    for (index in 0 until view.childCount) if (containsGlass(view.getChildAt(index), depth + 1)) return true
    return false
  }

  /** A toolbar can be small, but it is not one trigger. Fail closed on opaque trees. */
  private fun interactiveCount(view: View, depth: Int): Int {
    val role = view.getTag(R.id.accessibility_role)?.toString()?.uppercase()
    var count = if (view.isClickable || view.isLongClickable || role in setOf(
      "BUTTON", "IMAGEBUTTON", "LINK", "MENUITEM", "CHECKBOX", "RADIO", "SWITCH", "TOGGLEBUTTON")) 1 else 0
    if (view !is ViewGroup) return count
    if (depth >= 8 || view.childCount > 64) return 2
    for (index in 0 until view.childCount) {
      count += interactiveCount(view.getChildAt(index), depth + 1)
      if (count > 1) return count
    }
    return count
  }
}

/** RenderNode owns recorded pixels; only a weak source reference is needed for restoration. */
@RequiresApi(Build.VERSION_CODES.S)
internal class MenuTriggerSnapshot internal constructor(view: View, private val node: RenderNode,
  @Suppress("unused") private val sourcePixels: Bitmap, private val captureMetadata: Map<String, Any>,
  private val density: Float, private val morphSourceWidth: Float, private val morphSourceHeight: Float) {
  private val source = WeakReference(view)
  private val sourceId = view.id
  private val originalTransitionAlpha = view.transitionAlpha
  private val width = view.width.toFloat()
  private val height = view.height.toFloat()
  private val blurEffects = arrayOfNulls<RenderEffect>(18)
  private var lastBlurStep = -1
  private val ownership = MenuSourceOwnership()
  private var overlayRoot = WeakReference<View>(null)
  private val overlayFrame = GlassMorphFrame()
  private val overlayLocation = IntArray(2)
  private val clip = Rect()
  private val glyphBounds = RectF()
  private var hasFrame = false
  private var draws = 0L
  private var clipMisses = 0L
  private var closingAt = 0L
  private val samples = linkedMapOf<Int, Map<String, Any>>()
  private val overlayDrawable = object : Drawable() {
    override fun draw(canvas: Canvas) {
      if (WindowBackdrops.isCapturing || !hasFrame || ownership.released) return
      val root = overlayRoot.get() ?: return
      root.getLocationOnScreen(overlayLocation)
      drawSource(canvas, overlayFrame, overlayLocation[0].toFloat(), overlayLocation[1].toFloat())
    }
    override fun setAlpha(alpha: Int) = Unit
    override fun setColorFilter(filter: ColorFilter?) = Unit
    @Deprecated("Deprecated in Java") override fun getOpacity() = PixelFormat.TRANSLUCENT
  }

  /** Window-level ownership avoids every fixed-card/parent drawing clip. */
  fun attachOverlay(root: View): Boolean {
    if (ownership.released || !hasFrame || !root.isAttachedToWindow || !root.isHardwareAccelerated || root.width <= 0 || root.height <= 0 ||
      !node.hasDisplayList() || !MenuTriggerSnapshots.owns(this)) return false
    val view = source.get() ?: return false
    if (!view.isAttachedToWindow || view.id != sourceId || !view.isShown ||
      (!ownership.hidden && view.transitionAlpha != originalTransitionAlpha)) return false
    if (overlayRoot.get() !== root) detachOverlay()
    overlayRoot = WeakReference(root)
    overlayDrawable.setBounds(0, 0, root.width, root.height)
    try { root.overlay.add(overlayDrawable) } catch (_: RuntimeException) {
      try { root.overlay.remove(overlayDrawable) } catch (_: RuntimeException) { /* release retries the same weak root */ }
      if (overlayDrawable.callback == null) overlayRoot.clear()
      return false
    }
    if (!ownership.attach(MenuTriggerSnapshots.owns(this), view.id == sourceId, overlayDrawable.callback != null)) {
      root.overlay.remove(overlayDrawable); overlayRoot.clear(); return false
    }
    // Hide only after the full-window replacement has an actual drawing owner.
    view.transitionAlpha = 0f
    overlayDrawable.invalidateSelf()
    return true
  }

  fun detachOverlay() {
    val view = source.get()
    // The weak reference is the exact Java View instance we zeroed. Its React
    // tag may have changed during recycling; undo our owned alpha write there
    // too, without authorizing the recycled identity for capture or retarget.
    if (ownership.detach(MenuTriggerSnapshots.owns(this), view != null, view?.transitionAlpha == 0f))
      view?.transitionAlpha = originalTransitionAlpha
    try { overlayRoot.get()?.overlay?.remove(overlayDrawable) }
    catch (_: RuntimeException) { /* cleanup must not block node release/menu completion */ }
    finally { overlayRoot.clear() }
  }

  fun updateOverlay(frame: GlassMorphFrame) {
    if (ownership.released) return
    overlayFrame.copyFrom(frame)
    hasFrame = true
    overlayDrawable.invalidateSelf()
  }
  fun beginClosing() { closingAt = SystemClock.uptimeMillis(); samples.clear() }
  fun diagnostics(): Map<String, Any> = mapOf("sourceOverlayAttached" to ownership.attached,
    "sourceCloneDraws" to draws, "sourceCloneClipMisses" to clipMisses,
    "sourceCloneLastBounds" to listOf(glyphBounds.left, glyphBounds.top, glyphBounds.right, glyphBounds.bottom),
    "sourceCloneClosingSamples" to samples.values.toList(), "sourceCapture" to captureMetadata)

  /** Refresh only the same live weak source; never resolve a replacement row/tag. */
  fun currentScreenBounds(out: RectF): Boolean {
    if (ownership.released || !MenuTriggerSnapshots.owns(this)) return false
    val view = source.get() ?: return false
    if (!view.isAttachedToWindow || view.id != sourceId || !view.isShown || view.width <= 0 || view.height <= 0) return false
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

  private fun drawSource(canvas: Canvas, frame: GlassMorphFrame, originX: Float, originY: Float) {
    if (ownership.released || !canvas.isHardwareAccelerated || frame.sourceOpacity <= 0.001f) return
    val lobe = frame.sourceLobe
    val zoom = frame.sourceZoom
    node.setPivotX(width / 2f)
    node.setPivotY(height / 2f)
    // RN expands tiny measured icons to a 44dp hit origin. That expands the
    // morph geometry, not the glyph itself: preserve the actual recorded size.
    node.setScaleX(lobe.width() / max(morphSourceWidth, 1f) * zoom)
    node.setScaleY(lobe.height() / max(morphSourceHeight, 1f) * zoom)
    node.setTranslationX(lobe.centerX() - originX - width / 2f)
    node.setTranslationY(lobe.centerY() - originY - height / 2f)
    node.setAlpha(frame.sourceOpacity.coerceIn(0f, 1f))
    glyphBounds.set(lobe.centerX() - originX - width * node.scaleX / 2f,
      lobe.centerY() - originY - height * node.scaleY / 2f,
      lobe.centerX() - originX + width * node.scaleX / 2f,
      lobe.centerY() - originY + height * node.scaleY / 2f)
    canvas.getClipBounds(clip)
    val missed = glyphBounds.right <= clip.left || glyphBounds.left >= clip.right ||
      glyphBounds.bottom <= clip.top || glyphBounds.top >= clip.bottom
    draws++
    if (missed) clipMisses++
    if (closingAt > 0L) {
      val elapsed = SystemClock.uptimeMillis() - closingAt
      for (at in intArrayOf(50, 100, 150, 200, 300, 450)) if (elapsed >= at && !samples.containsKey(at)) {
        samples[at] = mapOf("atMs" to elapsed, "sourceAlpha" to frame.sourceOpacity,
          "bounds" to listOf(glyphBounds.left, glyphBounds.top, glyphBounds.right, glyphBounds.bottom),
          "clip" to listOf(clip.left, clip.top, clip.right, clip.bottom), "clipMiss" to missed)
      }
    }
    // The upstream source blur spans 0–4dp. Quarter-dp steps reuse its GPU effects.
    val step = (frame.sourceBlur / density * 4f).roundToInt().coerceIn(0, blurEffects.lastIndex)
    if (step != lastBlurStep) {
      lastBlurStep = step
      node.setRenderEffect(if (step == 0) null else blurEffects[step] ?: RenderEffect.createBlurEffect(
        step * density / 4f, step * density / 4f, Shader.TileMode.DECAL).also { blurEffects[step] = it })
    }
    canvas.drawRenderNode(node)
  }

  fun release() {
    if (!ownership.release()) return
    detachOverlay()
    if (MenuTriggerSnapshots.owns(this)) MenuTriggerSnapshots.forget(this)
    source.clear()
    node.setAlpha(0f)
    node.setRenderEffect(null)
    node.discardDisplayList()
    blurEffects.fill(null)
  }
}
