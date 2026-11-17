package expo.modules.liquidglass.menumotion

import android.graphics.RectF
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** Foreground-only raster bounds; source capture/material bounds stay separate. */
internal class GlassPortalRaster(private val density: Float) {
  val bounds = RectF()
  var scale = 1f
    private set
  var width = 0
    private set
  var height = 0
    private set

  fun update(incoming: RectF, source: RectF?, limits: RectF, screenBlur: Float): Boolean {
    // Original renderer has 28dp portal reach inside a capture expanded by
    // 48dp. Include the actual visible Gaussian reach, bounded by that same
    // original total guard, rather than filtering the whole travel envelope.
    val guard = max(28f * density, min(3f * max(screenBlur, 0f), 76f * density)) + 2f
    val left = max(min(incoming.left, source?.left ?: incoming.left) - guard, limits.left)
    val top = max(min(incoming.top, source?.top ?: incoming.top) - guard, limits.top)
    val right = min(max(incoming.right, source?.right ?: incoming.right) + guard, limits.right)
    val bottom = min(max(incoming.bottom, source?.bottom ?: incoming.bottom) + guard, limits.bottom)
    if (!left.isFinite() || !top.isFinite() || !right.isFinite() || !bottom.isFinite() ||
      right <= left || bottom <= top) {
      width = 0; height = 0
      return false
    }
    bounds.set(left, top, right, bottom)
    val area = bounds.width() * bounds.height()
    scale = min(1f, sqrt(MaximumPixels / max(area, 1f)))
    width = max(1, ceil(bounds.width() * scale).toInt())
    height = max(1, ceil(bounds.height() * scale).toInt())
    return true
  }

  private companion object {
    const val MaximumPixels = 720_000f
  }
}
