package expo.modules.liquidglass

import kotlin.math.ceil
import kotlin.math.floor

/** Exact screen grid of a bounded raw-source blit, never a fitted screenshot. */
internal data class MenuHandoffPatchRegion(val left: Int, val top: Int, val right: Int, val bottom: Int,
  val pixelLeft: Int, val pixelTop: Int, val pixelRight: Int, val pixelBottom: Int,
  val destinationLeft: Float, val destinationTop: Float,
  val destinationRight: Float, val destinationBottom: Float) {
  val width get() = right - left
  val height get() = bottom - top
}

internal fun menuHandoffPatchRegion(sourceLeft: Float, sourceTop: Float, sourceRight: Float,
  sourceBottom: Float, frameX: Int, frameY: Int, scale: Float, frameWidth: Int, frameHeight: Int,
  maxPixels: Int = 360_000): MenuHandoffPatchRegion? {
  if (!sourceLeft.isFinite() || !sourceTop.isFinite() || !sourceRight.isFinite() || !sourceBottom.isFinite() ||
    sourceRight <= sourceLeft || sourceBottom <= sourceTop || !scale.isFinite() || scale <= 0f ||
    scale > 1f || !(1f / scale).isFinite() || frameWidth <= 0 || frameHeight <= 0 || maxPixels <= 0) return null
  val left = floor(sourceLeft - 2f).toInt(); val top = floor(sourceTop - 2f).toInt()
  val right = ceil(sourceRight + 2f).toInt(); val bottom = ceil(sourceBottom + 2f).toInt()
  val width = right.toLong() - left; val height = bottom.toLong() - top
  if (width <= 0L || height <= 0L || width > maxPixels || height > maxPixels || width > maxPixels / height) return null
  val pixelLeft = floor((left.toLong() - frameX) * scale.toDouble()).toInt()
  val pixelTop = floor((top.toLong() - frameY) * scale.toDouble()).toInt()
  val pixelRight = ceil((right.toLong() - frameX) * scale.toDouble()).toInt()
  val pixelBottom = ceil((bottom.toLong() - frameY) * scale.toDouble()).toInt()
  if (pixelLeft < 0 || pixelTop < 0 || pixelRight > frameWidth || pixelBottom > frameHeight ||
    pixelLeft >= pixelRight || pixelTop >= pixelBottom) return null
  return MenuHandoffPatchRegion(left, top, right, bottom, pixelLeft, pixelTop, pixelRight, pixelBottom,
    (frameX.toLong() - left).toFloat() + pixelLeft / scale,
    (frameY.toLong() - top).toFloat() + pixelTop / scale,
    (frameX.toLong() - left).toFloat() + pixelRight / scale,
    (frameY.toLong() - top).toFloat() + pixelBottom / scale)
}

/** All open/rest observations are exact. Only the already-locked terminal
 * transaction may freeze its small source ROI across the source restore draw. */
internal fun menuHandoffPatchKeyMatches(expected: MenuUnderlayKey, current: MenuUnderlayKey?,
  preparedMetadata: Long, currentMetadata: Long, handoff: Boolean, elapsedHandoffMs: Long): Boolean {
  if (current == null || preparedMetadata != currentMetadata) return false
  if (!handoff) return expected == current
  return elapsedHandoffMs in 0L..200L && current.sceneVersion >= expected.sceneVersion &&
    current.copy(sceneVersion = expected.sceneVersion) == expected
}
