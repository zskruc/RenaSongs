package expo.modules.liquidglass.menumotion

import expo.modules.liquidglass.MenuMaterialRaster
import expo.modules.liquidglass.MenuMaterialRasterEpoch
import expo.modules.liquidglass.MenuMaterialGeometry
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * Delayed layout/draw callbacks exercise the production immutable epoch across
 * requested -> committed handoffs. This is an offline transaction regression,
 * not an Android Compose instrumentation or device-frame benchmark.
 */
fun main() {
  var checks = 0
  var delayedDraws = 0
  var checkerSamples = 0
  fun verify(value: Boolean, message: String) { checks++; check(value) { message } }
  fun near(actual: Float, expected: Float, message: String) =
    verify(abs(actual - expected) < .003f, "$message: $actual != $expected")
  fun checker(x: Float, y: Float): Int = (floor(x / 4f).toInt() xor floor(y / 4f).toInt()) and 1

  // Each callback captures exactly the value that the composition committed;
  // changing the owner must not change an already-recorded cohort's operations.
  class RecordedEpoch(val epoch: MenuMaterialRasterEpoch, val width: Int, val height: Int) {
    val measure = { epoch.pixels(width) to epoch.pixels(height) }
    val capacity = { epoch.pixels(width + 37) to epoch.pixels(height + 41) }
    val density = { physicalDensity: Float -> physicalDensity * epoch.scale }
    val source = { rasterPixel: Float, origin: Float -> rasterPixel / epoch.scale + origin }
    val inverse = { rasterPixel: Float -> rasterPixel * epoch.inverseScale }
    val blur = { radius: Float -> epoch.blurRadius(radius) }
    val place = { physical: Int ->
      val raster = physical * epoch.scale
      val integer = raster.roundToInt()
      integer to (raster - integer)
    }
  }

  fun checkRecorded(recorded: RecordedEpoch) {
    delayedDraws++
    val epoch = recorded.epoch
    val measured = recorded.measure()
    verify(measured == (epoch.pixels(recorded.width) to epoch.pixels(recorded.height)),
      "A delayed measurement used a newly requested density")
    verify(recorded.capacity() == (epoch.pixels(recorded.width + 37) to epoch.pixels(recorded.height + 41)),
      "A retained filtered layer used a new epoch's capacity")
    for (density in listOf(1f, 2f, 3.75f)) {
      for (dp in listOf(.6f, 12f, 28f, 80f)) {
        near(recorded.inverse(recorded.density(density) * dp), density * dp,
          "A pending density request changed physical optics")
      }
    }
    for (physicalPlacement in listOf(0, 1, 47, 173, 769)) {
      val (integer, residual) = recorded.place(physicalPlacement)
      near(recorded.inverse(integer + residual), physicalPlacement.toFloat(),
        "Committed placement and inverse scale belong to different epochs")
      for (origin in listOf(-83f, 53f, 1849f)) {
        for (local in listOf(.3125f, 3.3125f, 17.3125f, 63.3125f, 251.3125f)) {
          val localRaster = local * epoch.scale
          near(recorded.inverse(integer + residual + localRaster), physicalPlacement + local,
            "A delayed raster transform moved the physical menu")
          val expected = origin + physicalPlacement + local
          val sample = recorded.source(localRaster, origin + physicalPlacement)
          near(sample, expected, "A retained source callback read the owner's new scale")
          verify(checker(sample, sample + 1.3125f) == checker(expected, expected + 1.3125f),
            "A checkerboard sample changed during an uncommitted request")
          checkerSamples++
        }
      }
    }
    for (radius in listOf(6f, 22.5f, 45f, 120f)) {
      near(GlassPortalBlur.sigma(recorded.blur(radius)) * epoch.inverseScale,
        GlassPortalBlur.sigma(radius), "Blur and inverse scale came from different epochs")
    }
  }

  var legacyZoomDetected = false
  for ((width, height) in listOf(320 to 640, 1170 to 2400, 1440 to 2700, 1440 to 3120, 2048 to 4096)) {
    val owner = MenuMaterialRaster()
    owner.reserve(width, height)
    owner.setAnimating(true)
    val moving = RecordedEpoch(MenuMaterialRasterEpoch(owner.scale), width, height)
    val movingBits = moving.epoch.scale.toRawBits()
    val movingMeasured = moving.measure()
    checkRecorded(moving)

    // Opening has reached rest on the animation owner. The old composition has
    // not run yet and must keep source/density/size/inverse/blur ALL at old r.
    owner.setAnimating(false)
    verify(owner.scale == 1f, "The owner did not request the resting epoch")
    repeat(4) { checkRecorded(moving) }
    verify(moving.epoch.scale.toRawBits() == movingBits && moving.measure() == movingMeasured,
      "The pending request mutated the old display list")
    if (moving.epoch.scale < .5f) {
      // Negative control: 186's late-read source scale=1 combined with old
      // inverse≈2.327 makes the texture look enlarged although text is stable.
      val screenPixel = 251.3125f
      val oldRasterPixel = screenPixel * moving.epoch.scale
      val legacySample = oldRasterPixel / owner.scale
      val legacyMagnification = owner.scale * moving.epoch.inverseScale
      if (abs(legacySample - screenPixel) > 100f && legacyMagnification > 2f)
        legacyZoomDetected = true
    }

    // Only a composition commit replaces all operations with a new cohort.
    val resting = RecordedEpoch(MenuMaterialRasterEpoch(owner.scale), width, height)
    verify(resting.epoch.scale == 1f && resting.measure() == (width to height),
      "The resting composition did not restore full physical resolution")
    checkRecorded(resting)
    checkRecorded(moving) // Retired callbacks must remain internally consistent.

    // Start closing while a full-res resting frame may still be in flight.
    owner.setAnimating(true)
    verify(owner.scale == moving.epoch.scale, "Closing changed the reserved animation scale")
    repeat(4) { checkRecorded(resting) }
    val closing = RecordedEpoch(MenuMaterialRasterEpoch(owner.scale), width, height)
    checkRecorded(closing)

    // Rapid reopen / ABA request changes cannot mutate either retained cohort.
    repeat(5) { request ->
      owner.setAnimating(request % 2 == 0)
      checkRecorded(resting)
      checkRecorded(closing)
    }
    owner.reserve(width + 113, height + 79)
    owner.setAnimating(true)
    verify(owner.width.toLong() * owner.height <= 720_000L, "New viewport exceeded raster budget")
    checkRecorded(closing)
    checkRecorded(resting)
    val resized = RecordedEpoch(MenuMaterialRasterEpoch(owner.scale), width + 113, height + 79)
    checkRecorded(resized)
  }
  verify(legacyZoomDetected, "The regression harness cannot distinguish 186's mixed-epoch zoom")

  // A second 186 failure can persist indefinitely: Expo's same-spec Yoga
  // measure/layout call may be cached, leaving the native viewport at old r
  // even after Compose commits density=1. No future spring tick need relayout
  // that platform host. These inferred incident coordinates reproduce the
  // displaced silhouette (~465,965); they are not a device instrumentation.
  val cachedOwner = MenuMaterialRaster()
  cachedOwner.reserve(1410, 2970)
  cachedOwner.setAnimating(true)
  val cachedNativeInverse = cachedOwner.inverseScale
  val cachedNativeWidth = cachedOwner.width
  val cachedNativeHeight = cachedOwner.height
  cachedOwner.setAnimating(false)
  val newlyCommitted = MenuMaterialRasterEpoch(cachedOwner.scale)
  val targetLeft = 210f
  val targetTop = 400f
  val viewportLeft = 30f
  val legacyLeft = viewportLeft + (targetLeft - viewportLeft) * newlyCommitted.scale * cachedNativeInverse
  val legacyTop = targetTop * newlyCommitted.scale * cachedNativeInverse
  verify(abs(legacyLeft - 465f) < 5f && abs(legacyTop - 965f) < 5f,
    "Cached-native negative control did not reproduce the persistent displaced silhouette")
  verify(cachedNativeWidth < 600 && cachedNativeHeight < 1250,
    "Cached-native negative control failed to retain the old compact viewport")
  repeat(60) {
    // No native layout callback: the 187 platform viewport is always physical
    // and identity, so whichever immutable Compose epoch is still displayed
    // contains BOTH its scaled placement and its matching inverse transform.
    for (retainedEpoch in listOf(MenuMaterialRasterEpoch(cachedOwner.animationScale), newlyCommitted)) {
      near(viewportLeft + (targetLeft - viewportLeft) * retainedEpoch.scale * retainedEpoch.inverseScale,
        targetLeft, "Skipped native layout displaced the committed Compose cohort")
      near(targetTop * retainedEpoch.scale * retainedEpoch.inverseScale,
        targetTop, "Skipped native layout displaced the committed Compose cohort vertically")
      verify(retainedEpoch.pixels(1410).toLong() * retainedEpoch.pixels(2970) > 0,
        "The retained epoch lost its own viewport dimensions")
    }
  }

  // Initial reservation is a separate platform-layout boundary: even a fixed
  // identity native view must first be placed at captureLeft/Top, which can be
  // negative relative to its unchanged Yoga card. A cached parent measure must
  // not leave that view at its previous ordinary-card origin (0,0).
  val initialGeometry = MenuMaterialGeometry()
  verify(initialGeometry.reserve(-180f, -400f, 1230f, 2570f), "Initial capture must change geometry")
  initialGeometry.update(0f, 0f, 1170f, 2400f)
  val hostScreenX = 210
  val hostScreenY = 400
  val skippedInitialX = hostScreenX + initialGeometry.placementX
  val skippedInitialY = hostScreenY + initialGeometry.placementY
  verify(skippedInitialX - hostScreenX == 180 && skippedInitialY - hostScreenY == 400,
    "Initial viewport negative control failed to expose the cached ordinary origin")
  // The native reservation explicitly applies the capture viewport exactly
  // once, independently of whether the parent receives an onLayout callback.
  val fixedNativeLeft = initialGeometry.captureLeft
  val fixedNativeTop = initialGeometry.captureTop
  val fixedNativeWidth = initialGeometry.captureWidth
  val fixedNativeHeight = initialGeometry.captureHeight
  verify(fixedNativeWidth == 1410 && fixedNativeHeight == 2970,
    "Initial platform viewport is not the full physical capture rectangle")
  repeat(60) {
    for (retainedEpoch in listOf(MenuMaterialRasterEpoch(cachedOwner.animationScale), newlyCommitted)) {
      near(hostScreenX + fixedNativeLeft + initialGeometry.placementX * retainedEpoch.scale * retainedEpoch.inverseScale,
        hostScreenX.toFloat(), "Initial direct viewport failed to preserve the card's screen X")
      near(hostScreenY + fixedNativeTop + initialGeometry.placementY * retainedEpoch.scale * retainedEpoch.inverseScale,
        hostScreenY.toFloat(), "Initial direct viewport failed to preserve the card's screen Y")
    }
  }
  verify(!initialGeometry.reserve(-180f, -400f, 1230f, 2570f),
    "An unchanged physical capture should not trigger repeated platform layout")
  verify(initialGeometry.reserve(-220f, -420f, 1230f, 2570f),
    "A genuinely changed physical capture must apply a new platform viewport")
  initialGeometry.update(0f, 0f, 1170f, 2400f)
  near(hostScreenX + initialGeometry.captureLeft + initialGeometry.placementX.toFloat(), hostScreenX.toFloat(),
    "Growing the capture ROI moved the card's physical X")
  near(hostScreenY + initialGeometry.captureTop + initialGeometry.placementY.toFloat(), hostScreenY.toFloat(),
    "Growing the capture ROI moved the card's physical Y")
  verify(initialGeometry.clear() && !initialGeometry.active,
    "The native viewport lifecycle did not return to the ordinary card")
  println("Material epoch handoff passed: $checks checks, $delayedDraws delayed draws, $checkerSamples checkerboard samples; pending/rest/reverse/ABA commits, mixed-scale, cached-native-handoff and initial-viewport negative controls.")
}
