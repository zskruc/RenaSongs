package expo.modules.liquidglass.menumotion

import android.graphics.Canvas
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.util.Log
import android.view.View
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private var checks = 0
private fun expect(value: Boolean, message: String) { checks++; check(value) { message } }
private fun node(name: String) = RenderNode.instances.last { it.name == name }
private fun shader(effect: RenderEffect?): android.graphics.RuntimeShader? =
  if (effect == null) null else if (effect.kind == "shader") effect.shader else shader(effect.outer)

/** Executes production selection/recording/effect code. It deliberately does
 * not claim Android filter quantization, image equality or actual frame rate.
 */
fun main() {
  val frame = GlassMorphFrame().apply {
    bounds.set(500f, 600f, 600f, 720f)
    sourceLobe.set(500f, 600f, 560f, 660f)
    radiusX = 20f; radiusY = 20f; rowsOpacity = .4f
    portalBlur = 0f; lensAmount = -20f; lensHeight = 20f
    sourceOpacity = 1f; sourceRadius = 30f
  }
  val limits = RectF(0f, 0f, 1600f, 2600f)
  val target = RectF(300f, 400f, 1000f, 1800f)
  val body = View()
  Log.legacy = false; Log.legacyEarly = false
  val reads = Log.earlyReads
  val candidate = GlassForegroundPortal(1f).apply {
    diagnosticsEnabled = true
    reserve(target, 0f, 0f, limits)
  }
  expect(Log.earlyReads == reads + 1, "Early-frame choice not read exactly at construction")
  // A live renderer may not switch its graph in response to a property change.
  Log.legacyEarly = true
  candidate.update(frame, 0f, 0f, false, null)
  candidate.setContentBlur(body, 0f, 1f, 1f)
  val canvas = Canvas()
  candidate.draw(canvas, limits, true, {})
  val rows = node("ResonusMenu.rows")
  val foreground = node("ResonusMenu.foreground")
  val activeShader = checkNotNull(shader(rows.effect))
  expect(rows.alphaValue == 1f, "Nongroup still promotes rows opacity to an HWUI alpha layer")
  expect(activeShader.source == GlassForegroundPortalOpacityShader, "Nongroup did not use its isolated opacity shader")
  expect(activeShader.floats["contentOpacity"]?.single() == .4f, "Final shader lost current rows opacity")
  expect(canvas.clips.size == 1 && canvas.saves == 1 && canvas.restores == 1,
    "Support clip must surround only the final node draw, with balanced Canvas state")
  val clip = canvas.clips.single()
  expect(clip.left < frame.bounds.left && clip.top < frame.bounds.top &&
    clip.right > frame.bounds.right && clip.bottom > frame.bounds.bottom,
    "Final output support cropped the actual incoming content")
  expect(clip.width() * clip.height() < rows.recordingWidth * rows.recordingHeight * 1f,
    "Small opening surface did not bound its otherwise transparent output")
  val width = rows.recordingWidth; val height = rows.recordingHeight
  val records = rows.recordings; val effects = rows.effectUpdates
  candidate.draw(canvas, limits, true, {})
  expect(rows.recordings == records && rows.effectUpdates == effects &&
    rows.recordingWidth == width && rows.recordingHeight == height,
    "Output clip changed a retained recording, filter, source dimensions or same-frame cache")
  expect(Log.earlyReads == reads + 1, "Debug property read on animation hot path")

  // Reveal and reverse keep exactly the current scalar; invisible rows remain
  // skipped, not recorded to make a fake zero-opacity hardware layer.
  for (opacity in listOf(.001f, .02f, .6f, 1f, .35f)) {
    frame.rowsOpacity = opacity
    val before = rows.recordings
    candidate.update(frame, 0f, 0f, false, null)
    candidate.draw(canvas, limits, true, {})
    expect(rows.alphaValue == 1f, "Nongroup reverse/reveal restored hardware alpha")
    if (opacity <= .001f) expect(rows.recordings == before, "Hidden foreground was recorded")
    else expect(checkNotNull(shader(rows.effect)).floats["contentOpacity"]?.single() == opacity,
      "Reveal/reverse reused another frame's scalar")
  }

  // Source/rows use separate fades and the exact original shader. In particular
  // transitioning from the optimized path must restore source-independent rows
  // alpha and the legacy transforms before drawing the source composite.
  frame.rowsOpacity = .4f
  val groupCanvas = Canvas()
  candidate.update(frame, 0f, 0f, true, null)
  candidate.setContentBlur(body, 8f, .8f, .5f)
  candidate.draw(groupCanvas, limits, true, {}, {})
  expect(rows.alphaValue == .4f, "Group lost its independently animated rows opacity")
  expect(shader(foreground.effect)?.source == GlassForegroundPortalShader,
    "Group shader bytes changed or inherited the nongroup scalar")
  expect(shader(foreground.effect)?.floats?.containsKey("contentOpacity") == false,
    "Group received the nongroup content-opacity uniform")
  expect(groupCanvas.clips.isEmpty() && groupCanvas.saves == 0 && groupCanvas.restores == 0,
    "Whole-toolbar path inherited the nongroup output clip")
  expect(rows.actualScaleX == 1f && rows.actualScaleY == 1f &&
    rows.actualTranslationX == 0f && rows.actualTranslationY == 0f,
    "Group reused an optimized node transform")
  candidate.update(frame, 0f, 0f, false, null)
  candidate.setContentBlur(body, 0f, 1f, 1f)
  candidate.draw(canvas, limits, true, {})
  expect(rows.alphaValue == 1f && shader(rows.effect)?.source == GlassForegroundPortalOpacityShader,
    "Returning to nongroup kept the group alpha or shader")

  // Invalid support disables only the optional final clip; no attempt is made
  // to repair or clamp existing physical animation parameters.
  val clipsBeforeInvalid = canvas.clips.size
  frame.lensHeight = Float.NaN
  candidate.update(frame, 0f, 0f, false, null)
  candidate.draw(canvas, limits, true, {})
  expect(canvas.clips.size == clipsBeforeInvalid, "Unproven/nonfinite support was clipped")
  frame.lensHeight = 20f
  candidate.update(frame, 0f, 0f, false, null)
  val diagnostics = candidate.diagnostics()
  expect(diagnostics["portalShaderOpacityDraws"]!!.toLong() > 0 &&
    diagnostics["portalOutputClipDraws"]!!.toLong() > 0 &&
    diagnostics["portalOutputClipSavedPixels"]!!.toLong() > 0 &&
    diagnostics["portalLegacyEarlyFrames"] == 0,
    "Diagnostics do not identify actual candidate shader/clip use")

  // A new DEBUG renderer exactly selects201's previous alpha/effect path.
  val legacy = GlassForegroundPortal(1f).apply {
    diagnosticsEnabled = true
    reserve(target, 0f, 0f, limits)
  }
  val legacyCanvas = Canvas()
  legacy.update(frame, 0f, 0f, false, null)
  legacy.setContentBlur(body, 0f, 1f, 1f)
  legacy.draw(legacyCanvas, limits, true, {})
  val oldRows = node("ResonusMenu.rows")
  expect(oldRows.alphaValue == .4f && shader(oldRows.effect)?.source == GlassForegroundPortalShader,
    "DEBUG opt-out changed the previous nongroup alpha/shader graph")
  expect(legacyCanvas.clips.isEmpty() && legacy.diagnostics()["portalLegacyEarlyFrames"] == 1,
    "DEBUG opt-out still applied the candidate support clip")

  // Validate that every tested discarded physical point is outside the actual
  // rounded field's nonzero coverage support. The existing Bernstein proof in
  // PortalFuseHarness establishes the bound; this independent production-field
  // sweep also covers narrow/tall outlines and non-uniform radius axes.
  for (rx in listOf(1f, 20f, 120f)) for (ratio in listOf(.1f, 1f, 10f)) {
    val ry = rx * ratio
    val rounded = RoundedField().apply { set(RectF(0f, 0f, 600f, 1000f), rx, ry) }
    val radius = min(max(rx, .001f), max(ry, .001f))
    val growX = (.15f * radius * 1.5286649465560913f + 6f) * max(rx, .001f) / radius
    val growY = (.15f * radius * 1.5286649465560913f + 6f) * max(ry, .001f) / radius
    for (step in 0..100) {
      val x = -1000f + step * 30f
      val y = -1000f + step * 30f
      expect(rounded.distance(-growX - 1f, y) > 5f && rounded.distance(600f + growX + 1f, y) > 5f &&
        rounded.distance(x, -growY - 1f) > 5f && rounded.distance(x, 1000f + growY + 1f) > 5f,
        "Conservative clipped output includes a nonzero rounded-field point")
    }
  }
  // Exact real-number identity for premultiplied linear samples. Android's
  // intermediate half/8-bit quantization still requires device pixel review.
  for (opacity in listOf(.02, .15, .4, .75, 1.0)) for (coverage in listOf(.004, .2, .9, 1.0)) {
    val samples = listOf(.01, .2, .7, 1.0)
    val weights = listOf(.2, .4, .3, .1)
    val before = samples.indices.sumOf { samples[it] * opacity * weights[it] } * coverage
    val after = samples.indices.sumOf { samples[it] * weights[it] } * coverage * opacity
    expect(abs(before - after) < 1e-14, "Premultiplied linear opacity changed in real arithmetic")
  }
  println("Portal early-frame fixture passed: $checks checks; production nongroup alpha elimination, output support, group bytes/alpha, reversal and opt-out. No Android pixel/quantization or FPS claim.")
}
