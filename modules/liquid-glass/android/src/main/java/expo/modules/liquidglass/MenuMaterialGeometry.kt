package expo.modules.liquidglass

import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.PI
import kotlin.math.sqrt

/**
 * Menu texture coordinates are physical screen pixels, never morph scale.
 * Capture ROI reserves the full physical travel envelope once; only its glass
 * child is measured/placed at the live shell rectangle. MenuMaterialRaster
 * separately maps that geometry into a fixed animation density, leaving these
 * source coordinates independent of transient material resolution.
 */
internal class MenuMaterialGeometry {
  var active = false
    private set
  var captureLeft = 0
    private set
  var captureTop = 0
    private set
  var captureRight = 0
    private set
  var captureBottom = 0
    private set
  var left = 0
    private set
  var top = 0
    private set
  var right = 1
    private set
  var bottom = 1
    private set
  val captureWidth get() = max(captureRight - captureLeft, 1)
  val captureHeight get() = max(captureBottom - captureTop, 1)
  val width get() = max(right - left, 1)
  val height get() = max(bottom - top, 1)
  val placementX get() = left - captureLeft
  val placementY get() = top - captureTop
  var sizeChanged = false
    private set
  var placementChanged = false
    private set

  fun reserve(l: Float, t: Float, r: Float, b: Float): Boolean {
    if (!finiteRect(l, t, r, b)) return false
    val nextLeft = floor(l).toInt()
    val nextTop = floor(t).toInt()
    val nextRight = ceil(r).toInt()
    val nextBottom = ceil(b).toInt()
    val changed = !active || captureLeft != nextLeft || captureTop != nextTop ||
      captureRight != nextRight || captureBottom != nextBottom
    active = true
    captureLeft = nextLeft; captureTop = nextTop
    captureRight = nextRight; captureBottom = nextBottom
    return changed
  }

  fun update(l: Float, t: Float, r: Float, b: Float): Boolean {
    sizeChanged = false
    placementChanged = false
    if (!active || !finiteRect(l, t, r, b)) return false
    val nextLeft = floor(l).toInt()
    val nextTop = floor(t).toInt()
    val nextRight = ceil(r).toInt()
    val nextBottom = ceil(b).toInt()
    sizeChanged = width != max(nextRight - nextLeft, 1) || height != max(nextBottom - nextTop, 1)
    placementChanged = left != nextLeft || top != nextTop
    val changed = sizeChanged || placementChanged
    left = nextLeft; top = nextTop; right = nextRight; bottom = nextBottom
    return changed
  }

  fun clear(): Boolean {
    if (!active) return false
    active = false
    return true
  }

  private fun finiteRect(l: Float, t: Float, r: Float, b: Float): Boolean =
    l.isFinite() && t.isFinite() && r.isFinite() && b.isFinite() && l < r && t < b
}

internal data class MenuLayerCapacity(val width: Int, val height: Int)

/**
 * Reserve actual default-spring extents, not 120% of a travel-sized viewport.
 * Width/height and incoming scale share the default spring response, so their
 * product is a quadratic in its unit step response. Include both expansion and
 * absorption extrema plus a physical guard; no motion/optical values change.
 */
internal fun menuLayerCapacity(width: Float, height: Float, sourceHeight: Float, density: Float): MenuLayerCapacity {
  val w = width.coerceAtLeast(1f)
  val h = height.coerceAtLeast(1f)
  val initialScale = max(0.5f * sourceHeight / max(w, h), 1f / w)
  fun responseMaximum(damping: Float): Float = 1f + exp((-PI * damping / sqrt(1f - damping * damping)).toFloat())
  fun productMaximum(a0: Float, a1: Float, b0: Float, b1: Float, response: Float): Float {
    val a = a1 * b1
    val b = a0 * b1 + a1 * b0
    fun value(t: Float) = (a0 + a1 * t) * (b0 + b1 * t)
    var maximum = max(value(0f), value(response))
    if (a < 0f) {
      val vertex = -b / (2f * a)
      if (vertex > 0f && vertex < response) maximum = max(maximum, value(vertex))
    }
    return maximum
  }
  val eject = responseMaximum(0.75f)
  val absorb = responseMaximum(0.8f)
  val maxWidth = w * max(initialScale, max(initialScale + (1f - initialScale) * eject, 1f))
  val maxHeight = max(productMaximum(w, h - w, initialScale, 1f - initialScale, eject),
    productMaximum(h, w - h, 1f, initialScale - 1f, absorb))
  val guard = max(4f * density, 4f)
  fun bucket(value: Float): Int = (ceil((value + guard) / 32f).toInt() * 32).coerceAtLeast(1)
  return MenuLayerCapacity(bucket(maxWidth), bucket(maxHeight))
}
