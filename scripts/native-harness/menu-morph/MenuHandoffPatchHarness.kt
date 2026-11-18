package expo.modules.liquidglass

import kotlin.math.abs
import kotlin.math.ceil

/** Production bounded-ROI geometry only. This does not execute Picture,
 * HardwareRenderer, Bitmap readback, alpha scanning or screen composition. */
private var patchChecks = 0
private fun verifyPatch(value: Boolean, message: String) {
  patchChecks++
  check(value) { message }
}
private fun nearPatch(actual: Float, expected: Float, message: String) =
  verifyPatch(abs(actual - expected) < .003f, "$message: $actual != $expected")

fun main() {
  // Real captured menu scales and a nonzero physical capture origin. The
  // producer pixel grid must retain its original phase, never fit a screenshot
  // to the requested source rectangle after rounding the source pixel crop.
  for (scale in listOf(1f, .675313f, .48014182f, .43262407f)) {
    val region = checkNotNull(menuHandoffPatchRegion(863f, 136f, 1380f, 301f,
      30, 0, scale, ceil(1410f * scale).toInt(), ceil(2725f * scale).toInt()))
    verifyPatch(region.left == 861 && region.top == 134 && region.right == 1382 && region.bottom == 303,
      "Two physical pixels of guard must surround the original source")
    verifyPatch(region.width == 521 && region.height == 169 && region.width * region.height <= 360_000,
      "Only the bounded toolbar ROI may be materialized")
    verifyPatch(region.destinationLeft <= 0f && region.destinationTop <= 0f &&
      region.destinationRight >= region.width && region.destinationBottom >= region.height,
      "Rounded producer crop must cover every destination pixel")
    verifyPatch(region.destinationLeft > -1f / scale - .001f &&
      region.destinationTop > -1f / scale - .001f,
      "Rounding may add less than one producer pixel, not rescale to fit")
    for ((screenX, screenY) in listOf(863f to 136f, 957.25f to 216.75f, 1379.5f to 300.5f)) {
      val localX = screenX - region.left
      val localY = screenY - region.top
      val sampledPixelX = region.pixelLeft + (localX - region.destinationLeft) *
        (region.pixelRight - region.pixelLeft) / (region.destinationRight - region.destinationLeft)
      val sampledPixelY = region.pixelTop + (localY - region.destinationTop) *
        (region.pixelBottom - region.pixelTop) / (region.destinationBottom - region.destinationTop)
      nearPatch(sampledPixelX, (screenX - 30f) * scale, "Producer checkerboard X phase")
      nearPatch(sampledPixelY, screenY * scale, "Producer checkerboard Y phase")
    }
  }
  val negative = checkNotNull(menuHandoffPatchRegion(-196.25f, -95.5f, 300.5f, 70.25f,
    -220, -120, .5f, 600, 400))
  nearPatch(negative.destinationLeft, -1f, "Negative screen origin keeps the same crop grid")
  nearPatch(negative.destinationTop, 0f, "Negative screen Y origin keeps the same crop grid")
  verifyPatch(menuHandoffPatchRegion(10f, 10f, 606f, 606f, 0, 0, 1f, 640, 640) != null,
    "An exact360000-pixel ROI is permitted")
  verifyPatch(menuHandoffPatchRegion(10f, 10f, 606.1f, 606f, 0, 0, 1f, 640, 640) == null,
    "Rounding beyond the pixel budget must reject before any image allocation")
  for (invalid in listOf(Float.NaN, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY)) {
    verifyPatch(menuHandoffPatchRegion(invalid, 20f, 200f, 120f, 0, 0, 1f, 400, 400) == null,
      "Nonfinite source bounds are rejected")
  }
  for (scale in listOf(0f, -1f, Float.NaN, Float.POSITIVE_INFINITY, 1.01f)) {
    verifyPatch(menuHandoffPatchRegion(20f, 20f, 200f, 120f, 0, 0, scale, 400, 400) == null,
      "Invalid producer sample scale is rejected")
  }
  for ((right, bottom) in listOf(20f to 120f, 200f to 20f, 10f to 120f)) {
    verifyPatch(menuHandoffPatchRegion(20f, 20f, right, bottom, 0, 0, 1f, 400, 400) == null,
      "Empty or reversed physical source region is rejected")
  }
  verifyPatch(menuHandoffPatchRegion(0f, 10f, 200f, 120f, 0, 0, 1f, 400, 400) == null,
    "A source whose guard crosses the producer edge cannot borrow missing pixels")
  verifyPatch(menuHandoffPatchRegion(20f, 20f, 399f, 120f, 0, 0, 1f, 400, 400) == null,
    "A rounded crop beyond the producer right edge is rejected")
  verifyPatch(menuHandoffPatchRegion(20f, 20f, 200f, 399f, 0, 0, 1f, 400, 400) == null,
    "A rounded crop beyond the producer bottom edge is rejected")
  verifyPatch(menuHandoffPatchRegion(-2e9f, -2e9f, 2e9f, 2e9f,
    -2_000_001_000, -2_000_001_000, .1f, 1_000_000_000, 1_000_000_000) == null,
    "Finite huge bounds must not overflow the budget product or Int dimensions")

  val base = MenuUnderlayKey(pageEpoch = 41, generation = 17,
    rootIdentity = 101, sourceIdentity = 102, ownerIdentity = 103, scrimIdentity = 104,
    rootWidth = 1440, rootHeight = 3120, rootX = 0, rootY = 0,
    sourceWidth = 1440, sourceHeight = 3120, sourceX = 0, sourceY = 0,
    geometry = RecordedBackdropGeometry(.48014182f, 30, 0, 677, 1063),
    sceneVersion = 71, materialVersion = 81, scrollVersion = 91)
  verifyPatch(menuHandoffPatchKeyMatches(base, base, 5, 5, false, 0),
    "A current prepared background is valid before source return")
  verifyPatch(!menuHandoffPatchKeyMatches(base, base.copy(sceneVersion = 72), 5, 5, false, 0),
    "A scene change while menu remains open must reject its old raw pixels")
  for (elapsed in listOf(0L, 9L, 200L)) {
    verifyPatch(menuHandoffPatchKeyMatches(base, base.copy(sceneVersion = 72), 5, 5, true, elapsed),
      "Only a locked bounded terminal transaction may freeze across source-return OnDraw")
  }
  for (elapsed in listOf(-1L, 201L, Long.MAX_VALUE)) {
    verifyPatch(!menuHandoffPatchKeyMatches(base, base, 5, 5, true, elapsed),
      "An expired or invalid handoff must stop using its background patch")
  }
  verifyPatch(!menuHandoffPatchKeyMatches(base, base.copy(sceneVersion = 70), 5, 5, true, 9),
    "A reversed/reset scene counter cannot be mistaken for source return")
  verifyPatch(!menuHandoffPatchKeyMatches(base, null, 5, 5, true, 9),
    "No current raw frame identity means no patch")
  verifyPatch(!menuHandoffPatchKeyMatches(base, base, 5, 6, true, 9),
    "New text/artwork/theme metadata invalidates even the terminal snapshot")
  val changes: List<Pair<String, MenuUnderlayKey>> = listOf(
    "page" to base.copy(pageEpoch = 42), "generation" to base.copy(generation = 18),
    "root" to base.copy(rootIdentity = 111), "source" to base.copy(sourceIdentity = 112),
    "owner" to base.copy(ownerIdentity = 113), "scrim" to base.copy(scrimIdentity = 114),
    "root width" to base.copy(rootWidth = 1441), "root height" to base.copy(rootHeight = 3121),
    "root X" to base.copy(rootX = 1), "root Y" to base.copy(rootY = 1),
    "source width" to base.copy(sourceWidth = 1441), "source height" to base.copy(sourceHeight = 3121),
    "source X" to base.copy(sourceX = 1), "source Y" to base.copy(sourceY = 1),
    "sample scale" to base.copy(geometry = base.geometry.copy(scale = .5f)),
    "sample X" to base.copy(geometry = base.geometry.copy(screenX = 31)),
    "sample Y" to base.copy(geometry = base.geometry.copy(screenY = 1)),
    "sample width" to base.copy(geometry = base.geometry.copy(pixelWidth = 678)),
    "sample height" to base.copy(geometry = base.geometry.copy(pixelHeight = 1064)),
    "material" to base.copy(materialVersion = 82), "scroll" to base.copy(scrollVersion = 92))
  for ((name, changed) in changes) for (handoff in listOf(false, true)) {
    verifyPatch(!menuHandoffPatchKeyMatches(base, changed, 5, 5, handoff, 9),
      "$name cannot be exempted by the source-return scene exception")
  }
  println("Menu handoff patch geometry passed: $patchChecks checks; bounded ROI, physical sample grid, negative origins, current identity and finite terminal exception (not Android raster/copy/opacity execution).")
}
