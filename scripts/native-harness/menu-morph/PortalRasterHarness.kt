package expo.modules.liquidglass.menumotion

import android.graphics.RectF
import kotlin.math.abs
import kotlin.math.max

/** GPU-independent checks for transient filter area and coordinate semantics. */
fun main() {
  var checks = 0
  fun verify(value: Boolean, message: String) { checks++; check(value) { message } }
  val density = 3.75f
  val window = RectF(-1100f, -400f, 340f, 2720f)
  val raster = GlassPortalRaster(density)
  var maximum = 0L
  verify(!raster.update(RectF(0f, 0f, 100f, 100f), null, window, 0f), "Unreserved filters must not allocate from a moving first frame")
  verify(raster.reserve(1200f, 2400f, window.width(), window.height(), true), "First session reservation was lost")
  val fixedWidth = raster.width
  val fixedHeight = raster.height
  val fixedScale = raster.scale.toRawBits()
  for (index in 0..1500) {
    val t = index / 1500f
    val width = 16f + 1180f * t
    val height = 16f + 2400f * t
    val incoming = RectF(-width / 2f, 500f - height / 2f, width / 2f, 500f + height / 2f)
    val source = if (index % 2 == 0) null else RectF(-1000f, 2300f, -835f, 2465f)
    verify(raster.update(incoming, source, window, (1f - t) * 72f * density), "Visible incoming was discarded")
    val b = raster.bounds
    verify(raster.width == fixedWidth && raster.height == fixedHeight && raster.scale.toRawBits() == fixedScale,
      "A motion frame resized the filtered layer or changed physical sampling scale")
    verify(!raster.reserve(1200f, 2400f, window.width(), window.height(), true), "Unchanged layout re-reserved capacity")
    verify(b.left >= window.left && b.top >= window.top && b.right <= window.right && b.bottom <= window.bottom,
      "Filter escaped actual window bounds")
    verify(raster.scale > 0f && raster.scale <= 1f, "Raster scale outside physical domain")
    val pixels = raster.width.toLong() * raster.height
    maximum = max(maximum, pixels)
    // Ceil rounds up each dimension by less than one raster pixel.
    verify(pixels <= 730_000L, "Transient layer exceeded its pixel budget")
    val physicalX = b.left + b.width() * .73f
    val physicalY = b.top + b.height() * .29f
    val sampledX = (physicalX - b.left) * raster.scale
    val sampledY = (physicalY - b.top) * raster.scale
    verify(abs(sampledX / raster.scale + b.left - physicalX) < .001f &&
      abs(sampledY / raster.scale + b.top - physicalY) < .001f, "Shader mapping changed physical sampling origin")
    val amount = -75f * density * (1f - t)
    val warpedRasterX = sampledX + amount * raster.scale * .8f
    verify(abs(warpedRasterX / raster.scale + b.left - (physicalX + amount * .8f)) < .001f,
      "Downsampling changed physical refraction amount")
  }
  // Exercise actual default spring envelopes, including short cards whose
  // early incoming circle can be taller than their final target height.
  val phone = RectF(0f, 0f, 1440f, 3120f)
  for (targetHeight in listOf(330f, 600f, 1200f, 2400f)) {
    val destination = RectF(120f, 345f, 1320f, 345f + targetHeight)
    val trigger = RectF(1110f, 1600f, 1275f, 1765f)
    val fixed = GlassPortalRaster(density)
    fixed.reserve(destination.width(), destination.height(), phone.width(), phone.height())
    val allocation = listOf(fixed.width, fixed.height, fixed.scale.toRawBits())
    val motion = GlassMotion()
    motion.initialize(trigger, destination, 28f * density, density, trigger, false, GlassMorphTuning(null, null))
    for (open in listOf(true, false)) {
      motion.retarget(open)
      var settled = false
      var count = 0
      while (!settled && count++ < 400) {
        settled = motion.advanceBy(1f / 120f)
        val shape = motion.frame.bounds
        verify(fixed.update(shape, null, phone, motion.frame.contentBlur), "A real spring frame was discarded")
        verify(listOf(fixed.width, fixed.height, fixed.scale.toRawBits()) == allocation,
          "Open/close changed a presentation's GPU dimensions")
        verify(fixed.bounds.left <= max(shape.left, phone.left) + .01f &&
          fixed.bounds.top <= max(shape.top, phone.top) + .01f &&
          fixed.bounds.right >= minOf(shape.right, phone.right) - .01f &&
          fixed.bounds.bottom >= minOf(shape.bottom, phone.bottom) - .01f,
          "Fixed capacity clipped an actual default-spring body")
      }
      verify(settled, "Actual default spring failed to settle")
    }
  }
  // Combining the original two passes in sigma space must preserve their
  // Gaussian variance after both the native view transform and raster scale.
  for (radius in listOf(0f, .02f, .1f, 1f, 6f, 18f, 72f, 270f)) {
    for (axisScale in listOf(.02f, .25f, .7f, 1f, 1.65f)) {
      for (portalRadius in listOf(0f, .02f, 1f, 6f, 22.5f)) {
        for (rasterScale in listOf(.35f, .5f, .8f, 1f)) {
          val rowsSigma = GlassPortalBlur.sigma(radius) * axisScale
          val portalSigma = GlassPortalBlur.sigma(portalRadius)
          val combined = GlassPortalBlur.combinedRadius(rowsSigma, portalSigma, rasterScale)
          val expectedVariance = (rowsSigma * rowsSigma + portalSigma * portalSigma) * rasterScale * rasterScale
          if (combined > .01f) {
            val actualSigma = GlassPortalBlur.sigma(combined)
            verify(abs(actualSigma * actualSigma - expectedVariance) < max(.003f, expectedVariance * .000001f),
              "Compact Gaussian changed the original transformed variance")
          } else verify(expectedVariance < .257f, "A visible Gaussian was dropped")
        }
      }
    }
  }
  val small = RectF(0f, 0f, 50f, 50f)
  val smallRaster = GlassPortalRaster(density)
  verify(smallRaster.reserve(50f, 50f, window.width(), window.height()), "Small control reservation was lost")
  verify(smallRaster.update(small, null, window, 0f) && smallRaster.scale == 1f, "Small menus must retain full resolution")
  verify(smallRaster.bounds.width() < window.width() / 2f && smallRaster.bounds.height() < window.height() / 2f,
    "A small foreground still filtered the full travel envelope")
  verify(raster.reserve(600f, 900f, window.width(), window.height()), "An actual new target layout must resize its capacity once")
  val resizedWidth = raster.width
  val resizedHeight = raster.height
  val resizedScale = raster.scale.toRawBits()
  for (position in 0..250) {
    val incoming = RectF(-800f + position, -200f + position * 6f, -300f + position, 600f + position * 6f)
    verify(raster.update(incoming, null, window, position.toFloat()), "Moved foreground was discarded")
    verify(raster.width == resizedWidth && raster.height == resizedHeight && raster.scale.toRawBits() == resizedScale,
      "Changing physical origin changed filter allocation or sampling scale")
  }
  verify(!raster.update(RectF(5000f, 5000f, 6000f, 6000f), null, window, 0f), "Offscreen foreground was retained")
  verify(!raster.update(RectF(Float.NaN, 0f, 100f, 100f), null, window, 0f), "Invalid foreground geometry reached GPU")
  println("Portal raster harness: $checks checks passed; maximum transient layer $maximum pixels (window 4492800).")
}
