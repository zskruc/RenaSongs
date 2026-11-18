package expo.modules.liquidglass.menumotion

import expo.modules.liquidglass.MenuMaterialRaster
import expo.modules.liquidglass.MenuMaterialRasterEpoch
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

  // 197's full-resolution branch is an explicitly enabled experiment. It may
  // exceed the ordinary pixel budget, but must not add a resize/scale epoch on
  // open, reverse, close, retarget, clear or reuse. This is not a performance
  // assertion: real GPU cost and appearance still require the device A/B run.
  for (budget in listOf(1, 10_000, 720_000)) {
    val full = MenuMaterialRaster(budget, forceFullResolution = true)
    verify(full.forceFullResolution, "The explicit full-resolution flag was lost")
    val fullSizes = listOf(0 to -1, 1 to 1, 8 to 3120, 512 to 512, 1170 to 2400,
      1440 to 3120, 2048 to 4096, 8192 to 8192, Int.MAX_VALUE to 1,
      1 to Int.MAX_VALUE, Int.MAX_VALUE to Int.MAX_VALUE, 320 to 640)
    val retainedEpochs = ArrayList<MenuMaterialRasterEpoch>()
    for ((requestedWidth, requestedHeight) in fullSizes) {
      val width = requestedWidth.coerceAtLeast(1)
      val height = requestedHeight.coerceAtLeast(1)
      verify(!full.reserve(requestedWidth, requestedHeight), "A full-resolution reserve changed its animation scale")
      verify(full.animationScale == 1f && full.scale == 1f && full.inverseScale == 1f,
        "Full-resolution retarget introduced a lower-resolution epoch")
      verify(full.width == width && full.height == height,
        "Full-resolution reservation fitted, cropped or overflowed physical dimensions")
      if (width.toLong() * height > budget)
        verify(full.width.toLong() * full.height > budget, "The opt-in experiment silently applied the ordinary bounded budget")
      for (animating in listOf(true, true, false, true, false, false, true)) {
        verify(!full.setAnimating(animating), "Full-resolution enter/rest/close created an unnecessary scale handoff")
        verify(full.animationScale == 1f && full.scale == 1f && full.inverseScale == 1f,
          "Full-resolution motion did not remain in one physical-pixel epoch")
        verify(full.width == width && full.height == height, "Opening or closing changed full-resolution capacity")
        val epoch = MenuMaterialRasterEpoch(full.scale).also { retainedEpochs.add(it) }
        verify(epoch.pixels(width) == width && epoch.pixels(height) == height && epoch.inverseScale == 1f,
          "The material's committed cohort disagreed with its physical resolution")
        for (physical in listOf(-3, 0, 1, 47, 173, 1170, Int.MAX_VALUE))
          verify(full.pixels(physical) == physical.coerceAtLeast(1), "Full-resolution capacity conversion introduced ceil fitting")
        for (radius in listOf(0f, .02f, 1f, 6f, 22.5f, 45f, 120f))
          verify(full.blurRadius(radius) == radius && epoch.blurRadius(radius) == radius,
            "Full-resolution experiment changed the original physical blur recipe")
      }
      // Verify ordinary source coordinates, including a nonzero/negative
      // capture origin, quarter-pixel local position and fractional source DPI.
      for (origin in listOf(-307f, 53f, 1849f)) for (placement in listOf(1, 173, 769)) {
        for (local in listOf(.3125f, 17.3125f, 251.3125f)) {
          val physical = origin + placement + local
          val rasterPlacement = placement * full.scale
          val integerPlacement = rasterPlacement.roundToInt()
          val residual = rasterPlacement - integerPlacement
          val restored = origin + (integerPlacement + residual + local * full.scale) * full.inverseScale
          verify(abs(restored - physical) < .0001f, "Full-resolution geometry moved the existing physical menu")
          for (sourceScale in listOf(1f, .5f, 1f / 3f)) {
            val expected = (physical + 83f) * sourceScale
            val sampled = (local * full.scale / full.scale + origin + placement + 83f) * sourceScale
            verify(abs(sampled - expected) < .002f && checker(sampled, sampled + 1.3125f) == checker(expected, expected + 1.3125f),
              "Full-resolution source mapping changed physical backdrop/color samples")
            checkerSamples++
          }
        }
      }
      for (density in listOf(1f, 2f, 3.75f)) for (dp in listOf(.6f, 12f, 28f, 80f))
        verify(density * full.scale * dp * full.inverseScale == density * dp,
          "Full-resolution experiment changed physical lens/radius/highlight density")
      retainedEpochs.forEach { epoch ->
        verify(epoch.scale == 1f && epoch.inverseScale == 1f, "A later retarget mutated an already recorded full-resolution cohort")
      }
    }
    full.clear()
    verify(full.forceFullResolution && full.animationScale == 1f && full.scale == 1f && full.width == 1 && full.height == 1,
      "Clear changed the experimental policy or retained old physical dimensions")
    verify(!full.setAnimating(true), "A cleared full-resolution instance introduced a motion epoch")
    full.reserve(1440, 3120)
    verify(!full.setAnimating(true) && full.width == 1440 && full.height == 3120 && full.scale == 1f,
      "Reusing a full-resolution instance silently returned to bounded mode")
  }

  // Omitting the flag and explicitly disabling it must remain identical. The
  // existing 196 budget/origin/ceil/alpha tests above remain unmodified.
  for (budget in listOf(1, 10_000, 720_000)) {
    val implicit = MenuMaterialRaster(budget)
    val explicit = MenuMaterialRaster(budget, forceFullResolution = false)
    verify(!implicit.forceFullResolution && !explicit.forceFullResolution, "Default raster mode is no longer bounded")
    for ((width, height) in sizes + listOf(320 to 640)) {
      verify(implicit.reserve(width, height) == explicit.reserve(width, height), "Explicit false changed the default reserve transaction")
      for (animating in listOf(true, false, true, true, false)) {
        verify(implicit.setAnimating(animating) == explicit.setAnimating(animating), "Explicit false changed the default epoch transition")
        verify(implicit.animationScale == explicit.animationScale && implicit.scale == explicit.scale &&
          implicit.inverseScale == explicit.inverseScale && implicit.width == explicit.width && implicit.height == explicit.height,
          "Default and explicitly bounded material state diverged")
        if (animating) verify(implicit.width.toLong() * implicit.height <= budget,
          "The experiment changed the ordinary bounded-mode budget")
      }
    }
    implicit.clear(); explicit.clear()
    verify(implicit.scale == explicit.scale && implicit.width == explicit.width && implicit.height == explicit.height,
      "Explicit false changed default clear semantics")
  }

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
