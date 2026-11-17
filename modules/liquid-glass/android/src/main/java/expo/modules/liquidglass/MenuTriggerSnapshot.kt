package expo.modules.liquidglass

import android.graphics.Canvas
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import androidx.annotation.RequiresApi
import expo.modules.liquidglass.menumotion.GlassMorphFrame
import java.lang.ref.WeakReference
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** One measured trigger, never a retained View/event registry. All calls run on MAIN. */
@RequiresApi(Build.VERSION_CODES.S)
internal object MenuTriggerSnapshots {
  private const val MAX_AGE_MS = 1200L
  private var pending: Origin? = null
  private var active = WeakReference<MenuTriggerSnapshot>(null)

  private class Origin(view: View, bounds: RectF) {
    val view = WeakReference(view)
    val bounds = RectF(bounds)
    val at = SystemClock.uptimeMillis()
  }

  fun register(view: View, screenBounds: RectF) {
    pending = if (valid(screenBounds)) Origin(view, screenBounds) else null
  }

  fun take(sourceScreen: RectF): MenuTriggerSnapshot? {
    val candidate = pending
    pending = null
    // A replacement owns the real source, including if it reuses the same view.
    active.get()?.release()
    val now = SystemClock.uptimeMillis()
    if (candidate == null || now < candidate.at || now - candidate.at > MAX_AGE_MS || !valid(sourceScreen)) return null
    val view = candidate.view.get() ?: return null
    val density = view.resources.displayMetrics.density
    if (!density.isFinite() || density <= 0f || !view.isAttachedToWindow || !view.isShown ||
      view.width <= 0 || view.height <= 0 || view.alpha <= 0f || view.transitionAlpha <= 0f) return null
    // Never erase a whole list row, page, or a native glass surface to obtain a glyph.
    if (view.width > 256f * density || view.height > 96f * density || containsGlass(view, 0)) return null
    val location = IntArray(2)
    view.getLocationOnScreen(location)
    val live = RectF(location[0].toFloat(), location[1].toFloat(),
      location[0] + view.width * abs(view.scaleX), location[1] + view.height * abs(view.scaleY))
    val tolerance = 32f * density
    if (!sameOrigin(candidate.bounds, live, tolerance) || !sameOrigin(sourceScreen, live, tolerance)) return null
    val node = RenderNode("RenaSongs menu trigger")
    node.setPosition(0, 0, view.width, view.height)
    try {
      val recording = node.beginRecording(view.width, view.height)
      try {
        recording.clipRect(0, 0, view.width, view.height)
        view.draw(recording)
      } finally { node.endRecording() }
    } catch (_: RuntimeException) {
      node.discardDisplayList()
      return null
    }
    val snapshot = MenuTriggerSnapshot(view, node, density, sourceScreen.width(), sourceScreen.height())
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
    if (view is LiquidGlassView || view is MenuMorphView) return true
    if (view !is ViewGroup) return false
    if (depth >= 4 || view.childCount > 16) return true
    for (index in 0 until view.childCount) if (containsGlass(view.getChildAt(index), depth + 1)) return true
    return false
  }
}

/** RenderNode owns recorded pixels; only a weak source reference is needed for restoration. */
@RequiresApi(Build.VERSION_CODES.S)
internal class MenuTriggerSnapshot internal constructor(view: View, private val node: RenderNode,
  private val density: Float, private val morphSourceWidth: Float, private val morphSourceHeight: Float) {
  private val source = WeakReference(view)
  private val originalTransitionAlpha = view.transitionAlpha
  private val width = view.width.toFloat()
  private val height = view.height.toFloat()
  private val blurEffects = arrayOfNulls<RenderEffect>(18)
  private var lastBlurStep = -1
  private var released = false

  init { view.transitionAlpha = 0f }

  fun draw(canvas: Canvas, frame: GlassMorphFrame, originX: Float, originY: Float) {
    if (released || !canvas.isHardwareAccelerated || frame.sourceOpacity <= 0.001f) return
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
    if (released) return
    released = true
    if (MenuTriggerSnapshots.owns(this)) {
      source.get()?.let { it.transitionAlpha = originalTransitionAlpha }
      MenuTriggerSnapshots.forget(this)
    }
    source.clear()
    node.setAlpha(0f)
    node.setRenderEffect(null)
    node.discardDisplayList()
    blurEffects.fill(null)
  }
}
