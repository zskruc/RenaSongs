package expo.modules.liquidglass

import kotlin.math.ceil
import expo.modules.liquidglass.menumotion.GlassPortalBlur

/**
 * A presentation reserves one raster density for the entire moving material,
 * including its native alpha group. Coordinates outside this helper stay in
 * physical pixels. At rest the original full-resolution recipe is restored.
 */
internal class MenuMaterialRaster(
  private val maxPixels: Int = 720_000,
  val forceFullResolution: Boolean = false
) {
  var animationScale = 1f
    private set
  var scale = 1f
    private set
  private var viewportWidth = 1
  private var viewportHeight = 1

  fun reserve(width: Int, height: Int): Boolean {
    val w = width.coerceAtLeast(1)
    val h = height.coerceAtLeast(1)
    val previous = animationScale
    viewportWidth = w
    viewportHeight = h
    // Include ceil() edge pixels in the budget, even for very thin/wide menus.
    // This is reservation work, never a per-frame search or scale adjustment.
    val budget = maxPixels.coerceAtLeast(1).toLong()
    fun area(s: Double) = ceil(w * s).toLong().coerceAtLeast(1) * ceil(h * s).toLong().coerceAtLeast(1)
    // Explicit experiment only: keep one full-resolution epoch throughout the
    // presentation, rather than changing the optical recipe or spring motion.
    if (forceFullResolution || w.toLong() * h <= budget) animationScale = 1f
    else {
      var low = 0.0
      var high = 1.0
      repeat(40) {
        val middle = (low + high) * 0.5
        if (area(middle) <= budget) low = middle else high = middle
      }
      animationScale = Math.nextDown(low.toFloat()).coerceAtLeast(java.lang.Float.MIN_NORMAL)
    }
    return previous != animationScale
  }

  fun setAnimating(animated: Boolean): Boolean {
    val next = if (forceFullResolution || !animated) 1f else animationScale
    if (scale == next) return false
    scale = next
    return true
  }

  fun pixels(physical: Int): Int = MenuMaterialRasterEpoch(scale).pixels(physical)
  fun blurRadius(physicalRadius: Float): Float = MenuMaterialRasterEpoch(scale).blurRadius(physicalRadius)
  val width get() = pixels(viewportWidth)
  val height get() = pixels(viewportHeight)
  val inverseScale get() = 1f / scale

  fun clear() {
    animationScale = 1f
    scale = 1f
    viewportWidth = 1
    viewportHeight = 1
  }
}

/**
 * A composition captures this immutable cohort. An owner may request another
 * density while the previous display list is still drawing; every operation
 * in that old list must keep its old source conversion, dimensions and inverse
 * transform until the replacement composition is applied as one unit.
 */
internal data class MenuMaterialRasterEpoch(val scale: Float) {
  fun pixels(physical: Int): Int = ceil(physical.coerceAtLeast(1) * scale.toDouble()).toInt().coerceAtLeast(1)
  fun blurRadius(physicalRadius: Float): Float = if (scale == 1f) physicalRadius else
    GlassPortalBlur.radius(GlassPortalBlur.sigma(physicalRadius) * scale)
  val inverseScale get() = 1f / scale
}
