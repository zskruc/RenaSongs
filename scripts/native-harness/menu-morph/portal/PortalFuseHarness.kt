package expo.modules.liquidglass.menumotion

import android.graphics.Canvas
import android.graphics.RectF
import android.graphics.RenderNode
import android.util.Log
import android.view.View
import kotlin.math.abs
import kotlin.math.max

private var fuseChecks = 0
private fun expect(value: Boolean, message: String) { fuseChecks++; check(value) { message } }
private fun node(name: String) = RenderNode.instances.last { it.name == name }
private fun near(a: Float, b: Float) = abs(a - b) < .0001f

/** Actual private candidate, call-counting graphics boundary: NOT pixel/GPU proof. */
fun main() {
  val canvas = Canvas()
  val viewport = RectF(0f, 0f, 1600f, 2600f)
  val frame = GlassMorphFrame().apply {
    bounds.set(450f, 650f, 950f, 1550f)
    radiusX = 30f; radiusY = 30f; rowsOpacity = .4f
    portalBlur = 12f; lensAmount = -20f; lensHeight = 20f
  }
  val body = View()
  val reads = Log.reads
  Log.legacy = false
  val portal = GlassForegroundPortal(1f).apply { diagnosticsEnabled = true }
  expect(Log.reads == reads + 1, "DEBUG choice not read at construction")
  // Later changes only affect a new renderer, never switch a live node graph.
  Log.legacy = true
  portal.reserve(RectF(400f, 600f, 1000f, 1600f), 0f, 0f, viewport)
  portal.update(frame, 40f, 70f, false, null)
  portal.setContentBlur(body, 24f, .7f, .4f)
  var bodyCalls = 0
  portal.draw(canvas, viewport, true, { bodyCalls++ })
  val rows = node("ResonusMenu.rows")
  val foreground = node("ResonusMenu.foreground")
  expect(canvas.replayed.last() == "ResonusMenu.rows", "Qualified nongroup did not draw fused node")
  expect(Log.reads == reads + 1, "DEBUG read repeated in per-frame update/draw")
  val chain = checkNotNull(rows.effect)
  expect(chain.kind == "chain" && chain.outer?.kind == "shader" && chain.inner?.kind == "blur",
    "Original Gaussian must be inner and portal outer")
  expect(near(rows.alphaValue, .4f), "Uniform opacity changed")
  expect(near(rows.actualPivotX, 0f) && near(rows.actualPivotY, 0f), "Fused pivot differs")
  expect(near(rows.actualScaleX, foreground.actualScaleX) && near(rows.actualScaleY, foreground.actualScaleY),
    "Fused inverse raster scale differs from old foreground")
  expect(near(rows.actualTranslationX, foreground.actualTranslationX) && near(rows.actualTranslationY, foreground.actualTranslationY),
    "Fused physical origin differs from old foreground")
  expect(rows.clipped && foreground.clipped, "Existing explicit clip removed")
  expect(foreground.recordings == 0, "Fused path still records second layer")
  val records = rows.recordings; val effects = rows.effectUpdates
  portal.draw(canvas, viewport, true, { bodyCalls++ })
  expect(rows.recordings == records && rows.effectUpdates == effects, "Same-frame caches rebuilt")

  frame.lensHeight = Float.NaN
  portal.update(frame, 40f, 70f, false, null)
  portal.draw(canvas, viewport, true, { bodyCalls++ })
  expect(canvas.replayed.last() == "ResonusMenu.foreground", "Nonfinite lens height cannot qualify profile bounds")
  frame.lensHeight = 20f
  portal.update(frame, 40f, 70f, false, null)
  portal.draw(canvas, viewport, true, { bodyCalls++ })
  expect(canvas.replayed.last() == "ResonusMenu.rows", "Valid height did not recover fuse eligibility")

  // Existing source composite must never get fused or keep transforms from a
  // previous nongroup frame, including when a renderer instance is reused.
  frame.sourceLobe.set(550f, 500f, 710f, 544f)
  frame.sourceOpacity = 1f
  portal.update(frame, 40f, 70f, true, null)
  portal.setContentBlur(body, 24f, .7f, .4f)
  portal.draw(canvas, viewport, true, { bodyCalls++ }, {})
  expect(canvas.replayed.last() == "ResonusMenu.foreground", "Group path was fused")
  expect(near(rows.actualScaleX, 1f) && near(rows.actualScaleY, 1f) &&
    near(rows.actualTranslationX, 0f) && near(rows.actualTranslationY, 0f), "Group reused fused transform")
  expect(rows.effect?.kind == "blur", "Group reused nongroup portal effect on its rows")
  expect(node("RenaMenu.sourceAndRows").currentCanvas.replayed.contains("ResonusMenu.rows"),
    "Group lost independent rows composition")
  portal.update(frame, 40f, 70f, false, null)
  portal.setContentBlur(body, 24f, .7f, .4f)
  portal.draw(canvas, viewport, true, { bodyCalls++ })
  expect(rows.effect?.kind == "chain" && rows.actualScaleX != 1f, "Group→nongroup failed to restore fused graph")

  // At a physically cropped window edge, conservatively preserve old nodes.
  frame.bounds.set(0f, 0f, 500f, 900f)
  portal.update(frame, 0f, 0f, false, null)
  portal.draw(canvas, viewport, true, { bodyCalls++ })
  expect(canvas.replayed.last() == "ResonusMenu.foreground" && rows.effect?.kind == "blur",
    "Unsafe sampling domain bypassed old intermediate clipping")
  expect(rows.actualScaleX == 1f && rows.actualTranslationX == 0f,
    "Boundary fallback kept fused row transform")
  expect(foreground.currentCanvas.replayed == listOf("ResonusMenu.rows"),
    "Boundary fallback reused stale group recording")

  // A texture can be wider than its coverage; the ENTIRE valid texture domain
  // must fit, without assuming any measured distance value is an exact SDF.
  val field = GlassGaussianField(4f)
  frame.bounds.set(450f, 650f, 950f, 1550f)
  field.update(RectF(-10f, -10f, 950f, 1550f), 30f, 30f, null, 0f, 20f)
  portal.update(frame, 40f, 70f, false, field)
  portal.draw(canvas, viewport, true, { bodyCalls++ })
  expect(canvas.replayed.last() == "ResonusMenu.foreground", "Out-of-domain smoothed field incorrectly qualified")

  // Hidden→revealed/reversed updates retain generation, fresh body/effects and
  // the selected path; direct/software fallback does not inherit transforms.
  portal.update(frame, 40f, 70f, false, null)
  portal.draw(canvas, viewport, true, { bodyCalls++ })
  val beforeHidden = rows.recordings
  frame.rowsOpacity = 0f
  portal.update(frame, 40f, 70f, false, null)
  portal.draw(canvas, viewport, true, { bodyCalls++ })
  expect(rows.recordings == beforeHidden, "Hidden fused rows re-recorded")
  frame.rowsOpacity = .8f; frame.portalBlur = 0f
  portal.update(frame, 40f, 70f, false, null)
  portal.setContentBlur(body, 0f, 1f, 1f)
  portal.draw(canvas, viewport, true, { bodyCalls++ })
  expect(rows.recordings == beforeHidden + 1 && rows.effect?.kind == "shader" && rows.alphaValue == .8f,
    "Reveal reused hidden generation, Gaussian or opacity")
  val fallbackBefore = bodyCalls
  portal.draw(canvas, viewport, false, { bodyCalls++ })
  portal.draw(Canvas(false), viewport, true, { bodyCalls++ })
  expect(bodyCalls == fallbackBefore + 2, "Direct/software semantics changed")
  portal.draw(canvas, viewport, true, { bodyCalls++ })
  expect(canvas.replayed.last() == "ResonusMenu.rows", "Reenter warp lost retained fuse graph")
  val diagnostics = portal.diagnostics()
  expect(diagnostics["portalFusedDraws"]!!.toLong() > 0L && diagnostics["portalGroupedDraws"]!!.toLong() == 1L &&
    diagnostics["portalBoundaryFallbackDraws"]!!.toLong() > 0L && diagnostics["portalLegacyConfigured"] == 0,
    "Diagnostics fail to identify actual path counts")
  portal.release()
  expect(rows.effect == null && rows.actualScaleX == 1f && rows.actualTranslationX == 0f && !rows.hasDisplayList(),
    "Release retained graph effects/transform/display list")

  // Fresh DEBUG renderer really executes the previous two-layer graph.
  val legacy = GlassForegroundPortal(1f).apply { diagnosticsEnabled = true }
  Log.legacy = false
  legacy.reserve(RectF(400f, 600f, 1000f, 1600f), 0f, 0f, viewport)
  frame.rowsOpacity = .4f; frame.portalBlur = 12f; frame.lensAmount = -20f; frame.lensHeight = 20f
  legacy.update(frame, 40f, 70f, false, null)
  legacy.setContentBlur(body, 24f, .7f, .4f)
  legacy.draw(canvas, viewport, true, {})
  expect(canvas.replayed.last() == "ResonusMenu.foreground" && node("ResonusMenu.rows").effect?.kind == "blur",
    "DEBUG opt-out did not preserve legacy graph")
  val oldGaussian = checkNotNull(node("ResonusMenu.rows").effect)
  expect(near(oldGaussian.x, checkNotNull(chain.inner).x) && near(oldGaussian.y, checkNotNull(chain.inner).y),
    "Fuse changed existing physical anisotropic Gaussian radii")
  expect(near(node("ResonusMenu.rows").alphaValue, .4f), "Legacy/fused use different opacity")
  expect(legacy.diagnostics()["portalLegacyConfigured"] == 1 && legacy.diagnostics()["portalLegacyDraws"] == 1L,
    "Legacy diagnostics do not describe actual graph")

  // Opacity commutes with both linear image operators in ideal arithmetic.
  // This does not assert HWUI intermediate quantization or Android pixels.
  for (opacity in listOf(0f, .001f, .4f, .8f, 1f)) for (coverage in listOf(0f, .004f, .3f, 1f)) {
    val rgba = listOf(.2f, .4f, .1f, .7f)
    val weights = listOf(.1f, .2f, .4f, .2f, .1f)
    for (channel in rgba) {
      val old = weights.sumOf { (channel * it * opacity).toDouble() } * coverage
      val fused = weights.sumOf { (channel * it).toDouble() } * coverage * opacity
      expect(abs(old - fused) < 1e-7, "Uniform opacity no longer commutes with Gaussian+portal sample")
    }
  }

  // Bernstein convex-hull proof for P(t) for t∈[0,1], independent of samples.
  val coefficients = doubleArrayOf(0.0, 0.0, .268531, 1.26803, -3.64122, 3.15601, -.926054)
  fun choose(n: Int, k: Int): Double { var v = 1.0; for (i in 1..k) v = v * (n - i + 1) / i; return v }
  for (k in 0..6) {
    val bernstein = (0..k).sumOf { coefficients[it] * choose(k, it) / choose(6, it) }
    expect(bernstein >= 0.0 && bernstein < .13, "Actual corner polynomial exceeds support proof bound")
  }
  expect(.13 / .87 < .15, "Support expansion does not dominate raw corner correction")
  // Independent real CPU approximation spot checks supplement, never replace,
  // that analytic polynomial bound. Extreme anisotropy is included.
  val rounded = RoundedField()
  for (rx in listOf(.001f, 1f, 30f, 300f)) for (ratio in listOf(.01f, 1f, 100f)) {
    val ry = rx * ratio
    val r = kotlin.math.min(kotlin.math.max(rx, .001f), kotlin.math.max(ry, .001f))
    val gx = (.15f * r * 1.5286649465560913f + 6f) * kotlin.math.max(rx, .001f) / r
    val gy = (.15f * r * 1.5286649465560913f + 6f) * kotlin.math.max(ry, .001f) / r
    rounded.set(RectF(0f, 0f, 600f, 1000f), rx, ry)
    for (axis in 0..1) for (index in 0..100) {
      val d = if (axis == 0) rounded.distance(600f + gx + 1f, -100f + index * 12f)
        else rounded.distance(-100f + index * 8f, 1000f + gy + 1f)
      // CPU helper clamps radii to .01 rather than shader .001; skip its
      // deliberately distinct degenerate-radius approximation here.
      if (rx >= .01f && ry >= .01f) expect(d > 5f, "Conservative support missed real rounded-field point")
    }
  }
  println("Private Portal fuse harness passed: $fuseChecks checks (production candidate branches/state/effect graph and ideal linear math; NOT GPU pixels/120 Hz).")
}
