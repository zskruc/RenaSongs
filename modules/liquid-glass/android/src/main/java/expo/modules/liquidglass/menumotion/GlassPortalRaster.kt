package expo.modules.liquidglass.menumotion

import android.graphics.RectF
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** One fixed filtered capacity/scale per native menu presentation. */
internal class GlassPortalRaster(private val density: Float,
  private val motionMaximumPixels: Float = MaximumPixels) {
  val bounds = RectF()
  var scale = 1f
    private set
  var width = 0
    private set
  var height = 0
    private set
  private var physicalWidth = 0f
  private var physicalHeight = 0f
  private var reserved = false

  /**
   * Reserve maximum size, not the source-to-destination travel distance.
   * 1.2 covers the upstream spring rebound. The initial incoming circle uses
   * target width for its height, including for short landscape controls.
   * Repeated calls with unchanged real layout never change GPU dimensions.
   */
  fun reserve(targetWidth: Float, targetHeight: Float, windowWidth: Float, windowHeight: Float,
    hasGlassSource: Boolean = false): Boolean {
    if (!targetWidth.isFinite() || !targetHeight.isFinite() || !windowWidth.isFinite() ||
      !windowHeight.isFinite() || targetWidth <= 0f || targetHeight <= 0f || windowWidth <= 0f || windowHeight <= 0f) return false
    val guard = 76f * density + 2f
    val nextPhysicalWidth = if (hasGlassSource) windowWidth else min(windowWidth, targetWidth * 1.2f + guard * 2f)
    val nextPhysicalHeight = if (hasGlassSource) windowHeight else
      min(windowHeight, max(targetWidth, targetHeight) * 1.2f + guard * 2f)
    // The optional smaller motion raster never affects a whole-toolbar source.
    // Settled content still uses the existing direct full-resolution draw.
    val maximumPixels = if (hasGlassSource || !motionMaximumPixels.isFinite() || motionMaximumPixels <= 0f)
      MaximumPixels else motionMaximumPixels
    val nextScale = min(1f, sqrt(maximumPixels / max(nextPhysicalWidth * nextPhysicalHeight, 1f)))
    val nextWidth = max(1, ceil(nextPhysicalWidth * nextScale).toInt())
    val nextHeight = max(1, ceil(nextPhysicalHeight * nextScale).toInt())
    val changed = !reserved || physicalWidth != nextPhysicalWidth || physicalHeight != nextPhysicalHeight ||
      scale != nextScale || width != nextWidth || height != nextHeight
    physicalWidth = nextPhysicalWidth; physicalHeight = nextPhysicalHeight
    scale = nextScale; width = nextWidth; height = nextHeight
    reserved = true
    return changed
  }

  /** Motion only changes physical placement; filter size and sampling scale stay fixed. */
  fun update(incoming: RectF, source: RectF?, limits: RectF, @Suppress("UNUSED_PARAMETER") screenBlur: Float): Boolean {
    if (!reserved || !incoming.left.isFinite() || !incoming.top.isFinite() || !incoming.right.isFinite() ||
      !incoming.bottom.isFinite() || incoming.width() <= 0f || incoming.height() <= 0f) return false
    val left = min(incoming.left, source?.left ?: incoming.left)
    val top = min(incoming.top, source?.top ?: incoming.top)
    val right = max(incoming.right, source?.right ?: incoming.right)
    val bottom = max(incoming.bottom, source?.bottom ?: incoming.bottom)
    if (!left.isFinite() || !top.isFinite() || !right.isFinite() || !bottom.isFinite() ||
      right <= limits.left || bottom <= limits.top || left >= limits.right || top >= limits.bottom) return false
    val minLeft = limits.left
    val maxLeft = max(minLeft, limits.right - physicalWidth)
    val minTop = limits.top
    val maxTop = max(minTop, limits.bottom - physicalHeight)
    val x = ((left + right - physicalWidth) / 2f).coerceIn(minLeft, maxLeft)
    val y = ((top + bottom - physicalHeight) / 2f).coerceIn(minTop, maxTop)
    bounds.set(x, y, x + physicalWidth, y + physicalHeight)
    return true
  }

  private companion object {
    const val MaximumPixels = 720_000f
  }
}
