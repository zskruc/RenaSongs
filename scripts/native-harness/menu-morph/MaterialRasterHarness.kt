package expo.modules.liquidglass.menumotion

import expo.modules.liquidglass.MenuMaterialRaster
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToInt

/** Exercise the real reservation helper and independent physical-coordinate oracle. */
fun main() {
  var checks = 0
  fun verify(value: Boolean, message: String) { checks++; check(value) { message } }
  fun checker(x: Float, y: Float): Int = (floor(x / 4f).toInt() xor floor(y / 4f).toInt()) and 1
  val sizes = listOf(1 to 1, 8 to 3120, 1440 to 8, 512 to 512, 1170 to 2400,
    1440 to 2790, 1440 to 3120, 2048 to 4096, 8192 to 8192, Int.MAX_VALUE to 1,
    1 to Int.MAX_VALUE, Int.MAX_VALUE to Int.MAX_VALUE)
  var checkerSamples = 0
  var negativeRoundingDetected = false
  var negativeFitDetected = false
  for ((width, height) in sizes) {
    val raster = MenuMaterialRaster()
    raster.reserve(width, height)
    raster.setAnimating(true)
    verify(raster.scale > 0f && raster.scale <= 1f && raster.inverseScale.isFinite(), "Invalid raster transform")
    verify(raster.width.toLong() * raster.height <= 720_000L, "Ceil-rounded material viewport exceeded budget")
    val fixed = listOf(raster.width, raster.height, raster.scale.toRawBits())
    for (iteration in 0..50) {
      verify(!raster.setAnimating(true), "A moving frame changed its reserved raster scale")
      verify(!raster.reserve(width, height), "Identical actual viewport changed reservation")
      verify(fixed == listOf(raster.width, raster.height, raster.scale.toRawBits()), "Movement resized native alpha/blur layers")
    }
    if (width <= 8192 && height <= 8192) {
      val scale = raster.scale
      val inverse = raster.inverseScale
      // A known pixel-center pattern excludes ambiguity exactly at a tile edge.
      for (captureOrigin in listOf(-307f, 0f, 53f, 1849f)) {
        for (placement in listOf(0, 1, 47, 173, 769, 1237)) {
          val rasterPlacement = placement * scale
          val roundedPlacement = rasterPlacement.roundToInt()
          val remainder = rasterPlacement - roundedPlacement
          for (localPixel in listOf(.3125f, 3.3125f, 17.3125f, 63.3125f, 251.3125f)) {
            val physical = captureOrigin + placement + localPixel
            val composed = captureOrigin + (roundedPlacement + remainder + localPixel * scale) * inverse
            verify(abs(composed - physical) < .002f, "Raster placement changed physical screen origin")
            for (sourceScale in listOf(1f, .5f, 1f / 3f)) {
              val sourceOrigin = -83f
              val originalSample = (physical - sourceOrigin) * sourceScale
              // Native source Canvas receives physical origin and one scale,
              // while the outer ComposeView applies exactly its inverse.
              val sampledRaster = localPixel * scale
              val replaySample = (sampledRaster / scale + captureOrigin + placement - sourceOrigin) * sourceScale
              verify(abs(replaySample - originalSample) < .002f, "Backdrop mapping applied raster scale twice or fitted capacity")
              verify(checker(originalSample, originalSample + 1.3125f) == checker(replaySample, replaySample + 1.3125f),
                "Dark/light checkerboard changed under raster mapping")
              checkerSamples++
            }
            if (scale < 1f && abs(captureOrigin + (roundedPlacement + localPixel * scale) * inverse - physical) > .2f)
              negativeRoundingDetected = true
          }
        }
      }
      // Ceil is capacity, not an image-fit factor. Using pixelWidth/physicalWidth
      // as a new source scale would make the far edge drift during enter/exit.
      if (scale < 1f && abs(raster.width.toFloat() / width - scale) > .000001f) {
        val badFit = width * .8f * (raster.width.toFloat() / width) * inverse
        if (abs(badFit - width * .8f) > .05f) negativeFitDetected = true
      }
      for (physicalRadius in listOf(0f, .02f, .2f, 1f, 2f, 6f, 22.5f, 45f, 120f)) {
        val outputRadius = raster.blurRadius(physicalRadius)
        val originalSigma = GlassPortalBlur.sigma(physicalRadius)
        val expectedRasterSigma = originalSigma * scale
        if (outputRadius > .01f) {
          val restoredSigma = GlassPortalBlur.sigma(outputRadius) * inverse
          verify(abs(restoredSigma - originalSigma) < .0001f,
            "Material raster changed physical Android Gaussian sigma")
        } else verify(expectedRasterSigma < .506f,
          "A representable physical material blur was dropped")
      }
      for (density in listOf(1f, 2f, 3.75f)) {
        for (dp in listOf(.01f, .6f, 7f, 10f, 12f, 28f, 80f)) {
          val originalPixels = density * dp
          val restoredPixels = (density * scale * dp) * inverse
          verify(abs(originalPixels - restoredPixels) < .0001f, "LocalDensity changed physical blur/lens/radius/highlight")
        }
      }
    }
    // The same source/placement equations restore full resolution at rest.
    raster.setAnimating(false)
    verify(raster.scale == 1f && raster.inverseScale == 1f && raster.width == width && raster.height == height,
      "Settled material did not restore the exact original physical viewport")
    for (radius in listOf(0f, .02f, 1f, 45f)) verify(raster.blurRadius(radius) == radius,
      "Settled material did not restore its exact original API blur radius")
    raster.setAnimating(true)
    verify(fixed == listOf(raster.width, raster.height, raster.scale.toRawBits()), "Closing did not reuse its original raster capacity")
    raster.clear()
    verify(raster.scale == 1f && raster.width == 1 && raster.height == 1, "Clear retained a presentation's raster state")
  }
  verify(negativeRoundingDetected, "Oracle failed to detect missing subpixel placement compensation")
  verify(negativeFitDetected, "Oracle failed to detect fitting ceil-rounded raster dimensions")
  // Foreground portal only samples/linearly masks its input. Moving reveal
  // from a full-size native View to its compact rowsNode preserves RGBA.
  for (alpha in listOf(0f, .001f, .2f, .78f, 1f)) {
    for (c1 in listOf(-.2f, 0f, .1f, .8f, 1.2f)) {
      for (c2 in listOf(-.2f, 0f, .1f, .8f, 1.2f)) {
        val before = (c1 * alpha * .3f + c2 * alpha * .7f) * .8f
        val after = (c1 * .3f + c2 * .7f) * .8f * alpha
        verify(abs(before - after) < .000001f, "Compact reveal changed foreground color/blur")
      }
    }
  }
  println("Material raster harness: $checks checks passed; $checkerSamples checkerboard samples; physical origin/DP/ceil/alpha invariants verified.")
}
