package expo.modules.liquidglass.menumotion

import java.security.MessageDigest

internal data class MenuSourcePixelsStats(val nonTransparent: Int, val opaque: Int, val bright: Int,
  val maxAlpha: Int, val alphaSum: Long, val sha256: String) {
  val hasContent get() = nonTransparent > 0 && maxAlpha > 0
}

/** Canonical ARGB bytes, including transparent pixels; no View/RenderNode dependency. */
internal fun menuSourcePixels(width: Int, height: Int, pixels: IntArray): MenuSourcePixelsStats {
  require(width > 0 && height > 0 && width.toLong() * height == pixels.size.toLong())
  require(width.toLong() * height <= 360_000L)
  val digest = MessageDigest.getInstance("SHA-256")
  val buffer = ByteArray(2048)
  var used = 0
  var nonTransparent = 0
  var opaque = 0
  var bright = 0
  var maxAlpha = 0
  var alphaSum = 0L
  for (pixel in pixels) {
    val a = pixel ushr 24
    val r = pixel ushr 16 and 255
    val g = pixel ushr 8 and 255
    val b = pixel and 255
    if (a > 0) nonTransparent++
    if (a == 255) opaque++
    if (a >= 128 && r >= 220 && g >= 220 && b >= 220) bright++
    maxAlpha = maxOf(maxAlpha, a)
    alphaSum += a
    buffer[used++] = a.toByte(); buffer[used++] = r.toByte()
    buffer[used++] = g.toByte(); buffer[used++] = b.toByte()
    if (used == buffer.size) { digest.update(buffer, 0, used); used = 0 }
  }
  if (used > 0) digest.update(buffer, 0, used)
  val hash = digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
  return MenuSourcePixelsStats(nonTransparent, opaque, bright, maxAlpha, alphaSum, hash)
}
