package expo.modules.liquidglass

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** Production coordinate mapping, not an AGSL/Compose/HWUI renderer mock. */
private var checks = 0
private fun checkField(value: Boolean, message: String) {
  checks++
  check(value) { message }
}
private fun nearField(actual: Float, expected: Float, message: String) =
  checkField(abs(actual - expected) < .0025f, "$message: $actual != $expected")

private fun displacement(distance: Float, height: Float, amount: Float): Float {
  if (-distance >= height) return 0f
  val d = min(distance, 0f)
  val x = 1f + d / height
  return (1f - sqrt(max(1f - x * x, 0f))) * -amount
}

fun main() {
  // Real Backdrop startup order: onAttach -> observeEffects -> apply runs
  // before effectScope.update(DrawScope), so Size.Unspecified is NaN/NaN.
  // The bounded edgeLens min() expression then supplies NaN lens values too.
  // Reject that evaluation before padding mutation/shader construction; the
  // subsequent finite DrawScope must become usable without changing values.
  checkField(!menuFieldLensInputsReady(Float.NaN, Float.NaN, Float.NaN, Float.NaN, 0f),
    "Unspecified startup effect must not reach coordinate construction")
  for ((width, height) in listOf(0f to 0f, 0f to 120f, 240f to 0f,
    Float.NaN to 120f, 240f to Float.NaN, Float.POSITIVE_INFINITY to 120f)) {
    checkField(!menuFieldLensInputsReady(width, height, 12f, 20f, 0f),
      "Unmeasured/nonfinite effect dimensions cannot build a lens")
  }
  for (invalid in listOf(Float.NaN, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY, -1f, 0f)) {
    checkField(!menuFieldLensInputsReady(240f, 120f, invalid, 20f, 0f),
      "Nonfinite/disabled lens height must not modify effect padding")
    checkField(!menuFieldLensInputsReady(240f, 120f, 12f, invalid, 0f),
      "Nonfinite/disabled lens amount must not build a shader")
  }
  for (padding in listOf(-18f, -0f, 0f, 17.25f)) {
    checkField(menuFieldLensInputsReady(240f, 120f, 12f, 20f, padding),
      "A valid subsequent draw must accept unchanged finite signed padding")
    val coordinates = MenuMorphFieldCoordinates(.432624f, 210f, 400f, 30f, 0f, padding)
    nearField(coordinates.fieldX(padding), 180f, "Signed padding preserves physical origin")
  }
  for (invalid in listOf(Float.NaN, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY)) {
    checkField(!menuFieldLensInputsReady(240f, 120f, 12f, 20f, invalid),
      "Nonfinite effect padding cannot reach coordinate construction")
  }
  for (scale in listOf(1f, .432624f, .25f, .65f)) {
    for (padding in listOf(0f, 1.5f, 17.25f)) {
      for ((mx, my) in listOf(210f to 400f, -30f to 0f, 465f to 965f)) {
        val c = MenuMorphFieldCoordinates(scale, mx, my, 210f, 400f, padding)
        for (x in listOf(-40f, 0f, .5f, 17.25f, 300f)) {
          for (y in listOf(-20f, 0f, 12.75f, 720f)) {
            val rasterX = x * scale + padding
            val rasterY = y * scale + padding
            nearField(c.fieldX(rasterX), x + mx - 210f, "physical source X survives raster/padding")
            nearField(c.fieldY(rasterY), y + my - 400f, "physical source Y survives raster/padding")
            val translated = c.copy(materialOriginX = mx + 123f, materialOriginY = my - 78f,
              fieldOriginX = 333f, fieldOriginY = 322f)
            nearField(translated.fieldX(rasterX), c.fieldX(rasterX), "same-screen translation X")
            nearField(translated.fieldY(rasterY), c.fieldY(rasterY), "same-screen translation Y")
          }
        }
        nearField(c.fieldX(padding), mx - 210f, "effect padding maps exactly to child origin")
        nearField(c.fieldY(padding), my - 400f, "effect padding maps exactly to child origin")
        for (distance in listOf(-40f, -12f, -5f, -.25f, 0f, 2f)) {
          nearField(c.rasterDistance(distance) / scale, distance, "field distance remains physical")
          nearField(displacement(c.rasterDistance(distance), 12f * scale, 20f * scale) / scale,
            displacement(distance, 12f, 20f), "same Kyant lens displacement at each raster density")
        }
      }
    }
  }

  // Pending replacement: old display lists continue sampling with their old
  // epoch, including negative capture origins and nonzero blur padding.
  val old = MenuMorphFieldCoordinates(.432624f, 210f, 400f, 30f, 0f, 18f)
  val oldPointX = old.fieldX(93f)
  val oldPointY = old.fieldY(142f)
  var requestedScale = .432624f
  for (next in listOf(1f, .25f, .432624f, 1f)) {
    requestedScale = next
    repeat(5) {
      nearField(old.fieldX(93f), oldPointX, "delayed old epoch X cannot read new owner scale")
      nearField(old.fieldY(142f), oldPointY, "delayed old epoch Y cannot read new owner scale")
    }
    if (requestedScale != old.rasterScale) {
      val mixed = old.copy(rasterScale = requestedScale)
      checkField(abs(mixed.fieldX(93f) - oldPointX) > 10f,
        "negative control detects the186 mixed-scale source jump")
    }
  }
  val fresh = old.copy(rasterScale = 1f)
  nearField(fresh.fieldX(75f + fresh.padding), old.fieldX(75f * old.rasterScale + old.padding),
    "atomic replacement preserves the same physical checkerboard X")
  nearField(fresh.fieldY(124f + fresh.padding), old.fieldY(124f * old.rasterScale + old.padding),
    "atomic replacement preserves the same physical checkerboard Y")
  checkField(abs((93f + old.padding) / old.rasterScale + old.localOriginX - oldPointX) > 30f,
    "negative control detects inverted blur-padding sign")
  for (bad in listOf(0f, -1f, Float.NaN, Float.POSITIVE_INFINITY)) {
    checkField(runCatching { old.copy(rasterScale = bad) }.isFailure, "reject invalid scale")
  }
  checkField(runCatching { old.copy(materialOriginX = Float.NaN) }.isFailure, "reject nonfinite origin")
  // The group's original source fill is independent from glyph opacity and
  // the menu recipe. Its real production helper must match both endpoints,
  // preserve RGB at the caller, and never overflow the source alpha midway.
  for (alpha in 0..255) {
    val argb = (alpha shl 24) or 0x0056a9df
    checkField(menuGroupSourceFillAlpha(argb, 0f) == alpha, "source RGBA endpoint")
    checkField(menuGroupSourceFillAlpha(argb, 1f) == 0, "menu endpoint has no old source fill")
    checkField(menuGroupSourceFillAlpha(argb, -1f) == alpha, "clamp negative progress to source")
    checkField(menuGroupSourceFillAlpha(argb, 2f) == 0, "clamp overrun progress to menu")
    checkField(menuGroupSourceFillAlpha(argb, Float.NaN) == alpha, "nonfinite source-safe endpoint")
    var prior = alpha
    for (step in 0..8) {
      val p = step / 8f
      val current = menuGroupSourceFillAlpha(argb, p)
      checkField(current in 0..alpha && current <= prior, "source fill must fade monotonically within its original alpha")
      prior = current
    }
  }
  println("Menu field optics coordinates passed: $checks checks; physical/raster/padding, lens displacement, delayed epoch and mixed-scale negative controls (not GPU shader execution).")
}
