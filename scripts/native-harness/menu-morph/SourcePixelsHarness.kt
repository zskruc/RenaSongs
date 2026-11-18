package expo.modules.liquidglass.menumotion

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

/** Pure acceptance of a completed ARGB capture. This cannot prove Android
 * Bitmap immutability, software View rendering, or visible hardware replay;
 * those are independently checked by source contracts and device pixels. */
fun main() {
  var checks = 0
  fun verify(value: Boolean, message: String) { checks++; check(value) { message } }
  fun rejected(message: String, block: () -> Unit) {
    var rejected = false
    try { block() } catch (_: IllegalArgumentException) { rejected = true }
    verify(rejected, message)
  }
  fun referenceHash(pixels: IntArray): String {
    // Independent whole-buffer big-endian representation: an Android ARGB int
    // becomes A,R,G,B regardless of host byte order or digest chunk boundaries.
    val bytes = ByteBuffer.allocate(pixels.size * 4).order(ByteOrder.BIG_ENDIAN)
    pixels.forEach(bytes::putInt)
    return MessageDigest.getInstance("SHA-256").digest(bytes.array())
      .joinToString("") { "%02x".format(it.toInt() and 255) }
  }

  val transparent = menuSourcePixels(4, 2, intArrayOf(
    0, 0x00ffffff, 0x00ff0000, 0x0000ff00, 0x000000ff, 0x00123456, 0x007fffff, 0x00aaaaaa))
  verify(!transparent.hasContent, "Transparent RGB bytes authorized hiding the real source")
  verify(transparent.nonTransparent == 0 && transparent.opaque == 0 && transparent.bright == 0,
    "Transparent RGB bytes were counted as rendered glyph pixels")
  verify(transparent.maxAlpha == 0 && transparent.alphaSum == 0L,
    "Fully transparent capture retained a visible alpha")

  val black = menuSourcePixels(2, 2, intArrayOf(0xff000000.toInt(), 0x80000000.toInt(), 0x01000000, 0))
  verify(black.hasContent, "A valid black glyph was rejected because it contains no white pixels")
  verify(black.nonTransparent == 3 && black.opaque == 1 && black.bright == 0,
    "Dark-mode-independent black glyph pixel classification changed")
  verify(black.maxAlpha == 255 && black.alphaSum == 384L, "Black glyph alpha totals changed")

  // A white pixel with tiny alpha is valid content, but is not evidence of a
  // fully visible white toolbar glyph. Keep these two acceptance checks apart.
  val faint = menuSourcePixels(1, 1, intArrayOf(0x01ffffff))
  verify(faint.hasContent && faint.bright == 0 && faint.maxAlpha == 1,
    "The capture gate was confused with the stronger white-glyph video check")
  for (alpha in listOf(0, 1, 127, 128, 254, 255)) {
    for (channel in listOf(0, 219, 220, 255)) {
      for (dimChannel in 0..3) {
        val r = if (dimChannel == 1) channel else 255
        val g = if (dimChannel == 2) channel else 255
        val b = if (dimChannel == 3) channel else 255
        val pixel = (alpha shl 24) or (r shl 16) or (g shl 8) or b
        val stats = menuSourcePixels(1, 1, intArrayOf(pixel))
        val expectedBright = alpha >= 128 && (dimChannel == 0 || channel >= 220)
        verify(stats.bright == if (expectedBright) 1 else 0,
          "Bright evidence threshold changed: alpha=$alpha channel=$channel dim=$dimChannel")
        verify(stats.hasContent == (alpha > 0) && stats.opaque == if (alpha == 255) 1 else 0,
          "Alpha visibility/opacity threshold changed: alpha=$alpha")
      }
    }
  }

  // Exercise the exact full-chunk boundary, its neighbors, multiple flushes,
  // non-square captures, and the maximum allowed capture, using an independent
  // hash implementation instead of repeating the production 2048-byte loop.
  for ((width, height) in listOf(1 to 1, 511 to 1, 512 to 1, 513 to 1,
      1023 to 1, 1024 to 1, 1025 to 1, 127 to 19, 600 to 600)) {
    val pixels = IntArray(width * height) { i ->
      ((i * 73 + 19) shl 24) or (((i * 37 + 11) and 255) shl 16) or
        (((i * 97 + 23) and 255) shl 8) or ((i * 17 + 29) and 255)
    }
    val stats = menuSourcePixels(width, height, pixels)
    verify(stats.sha256 == referenceHash(pixels), "Canonical ARGB hash changed at $width x $height")
    verify(stats.sha256.length == 64 && stats.sha256.all { it in "0123456789abcdef" },
      "Capture hash is not canonical lower-case SHA-256")
    val expectedAlpha = pixels.sumOf { (it ushr 24).toLong() }
    verify(stats.alphaSum == expectedAlpha, "Alpha aggregation changed at $width x $height")
    verify(stats.nonTransparent == pixels.count { it ushr 24 > 0 },
      "Visible-pixel count changed at $width x $height")
  }

  val original = intArrayOf(0xff336699.toInt(), 0x80ffffff.toInt(), 0, 0x01020304)
  val saved = original.copyOf()
  val beforeMutation = menuSourcePixels(2, 2, original)
  original.fill(0)
  verify(beforeMutation.hasContent && beforeMutation.sha256 == referenceHash(saved),
    "Completed capture statistics retained mutable source-array storage")
  verify(menuSourcePixels(2, 2, original).sha256 != beforeMutation.sha256,
    "Hash did not distinguish a later blank capture from earlier valid pixels")
  verify(menuSourcePixels(4, 1, saved).sha256 == beforeMutation.sha256,
    "Identical physical pixel bytes hash differently when only row shape changes")
  verify(menuSourcePixels(2, 2, saved.reversedArray()).sha256 != beforeMutation.sha256,
    "Capture hash ignored actual pixel order")

  rejected("Zero width was accepted") { menuSourcePixels(0, 1, intArrayOf()) }
  rejected("Negative width was accepted") { menuSourcePixels(-1, 1, intArrayOf()) }
  rejected("Zero height was accepted") { menuSourcePixels(1, 0, intArrayOf()) }
  rejected("Negative height was accepted") { menuSourcePixels(1, -1, intArrayOf()) }
  rejected("Truncated capture was accepted") { menuSourcePixels(2, 2, intArrayOf(1, 2, 3)) }
  rejected("Surplus capture pixels were accepted") { menuSourcePixels(1, 1, intArrayOf(1, 2)) }
  rejected("Overflowed dimension product was accepted") { menuSourcePixels(Int.MAX_VALUE, Int.MAX_VALUE, intArrayOf(1)) }
  rejected("Capture above 360000 pixels was accepted") { menuSourcePixels(360001, 1, IntArray(360001)) }
  rejected("Non-square capture above budget was accepted") { menuSourcePixels(601, 600, IntArray(601 * 600)) }

  println("Source pixels harness passed: $checks checks; transparent/black/faint glyph gates, bright-evidence boundaries, canonical ARGB/chunk hashes, immutable statistics and capture budget (actual Bitmap replay remains device-only).")
}
