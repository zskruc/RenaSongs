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
  Log.legacy = false; Log.motionRows = true; Log.motionClip = true; Log.motionBudget = false
  val reads = Log.earlyReads
  val candidate = GlassForegroundPortal(1f).apply {
    diagnosticsEnabled = true
    reserve(target, 0f, 0f, limits)
  }
  expect(Log.earlyReads == reads + 3, "Early-frame choice not read exactly at construction")
  // A live renderer may not switch its graph in response to a property change.
  Log.motionRows = false; Log.motionClip = false; Log.motionBudget = false
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
  expect(Log.earlyReads == reads + 3, "Debug property read on animation hot path")

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
    diagnostics["portalMotionRowsConfigured"] == 1 && diagnostics["portalMotionClipConfigured"] == 1,
    "Diagnostics do not identify actual candidate shader/clip use")

  // A new default renderer exactly selects201's previous alpha/effect path.
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
    "Default graph changed the previous nongroup alpha/shader graph")
  expect(legacyCanvas.clips.isEmpty() && legacy.diagnostics()["portalMotionRowsConfigured"] == 0 && legacy.diagnostics()["portalMotionClipConfigured"] == 0,
    "Default graph still applied the candidate support clip")

  // Each opt-in must stand alone, with the other201 behaviours left intact.
  fun isolated(rowsFlag: Boolean, clipFlag: Boolean, budgetFlag: Boolean, grouped: Boolean = false):
    Triple<GlassForegroundPortal, RenderNode, Canvas> {
    Log.motionRows = rowsFlag; Log.motionClip = clipFlag; Log.motionBudget = budgetFlag
    val instance = GlassForegroundPortal(1f).apply {
      diagnosticsEnabled = true
      reserve(target, 0f, 0f, limits, grouped)
    }
    instance.update(frame, 0f, 0f, grouped, null)
    instance.setContentBlur(body, 0f, 1f, 1f)
    val output = Canvas()
    if (grouped) instance.draw(output, limits, true, {}, {})
    else instance.draw(output, limits, true, {})
    return Triple(instance, node("ResonusMenu.rows"), output)
  }
  val rowsOnly = isolated(true, false, false)
  expect(rowsOnly.second.alphaValue == 1f &&
    shader(rowsOnly.second.effect)?.source == GlassForegroundPortalOpacityShader &&
    rowsOnly.third.clips.isEmpty() && rowsOnly.first.diagnostics()["portalMotionBudgetConfigured"] == 0,
    "Rows-only flag also enabled clip or budget")
  val clipOnly = isolated(false, true, false)
  expect(clipOnly.second.alphaValue == .4f &&
    shader(clipOnly.second.effect)?.source == GlassForegroundPortalShader &&
    clipOnly.third.clips.isNotEmpty() && clipOnly.first.diagnostics()["portalMotionBudgetConfigured"] == 0,
    "Clip-only flag changed rows opacity/shader or budget")
  val budgetOnly = isolated(false, false, true)
  val baselinePixels = oldRows.recordingWidth.toLong() * oldRows.recordingHeight
  val budgetPixels = budgetOnly.second.recordingWidth.toLong() * budgetOnly.second.recordingHeight
  expect(budgetOnly.second.alphaValue == .4f &&
    shader(budgetOnly.second.effect)?.source == GlassForegroundPortalShader && budgetOnly.third.clips.isEmpty(),
    "Budget-only flag enabled alpha/clip candidates")
  expect(budgetPixels < baselinePixels && budgetPixels in 480_000L..482_000L,
    "Nongroup motion budget was not capped to480k plus original ceil-edge pixels")
  val defaultGroup = isolated(false, false, false, true)
  val candidateGroup = isolated(true, true, true, true)
  expect(candidateGroup.second.recordingWidth == defaultGroup.second.recordingWidth &&
    candidateGroup.second.recordingHeight == defaultGroup.second.recordingHeight &&
    candidateGroup.second.alphaValue == .4f && candidateGroup.third.clips.isEmpty() &&
    shader(node("ResonusMenu.foreground").effect)?.source == GlassForegroundPortalShader,
    "Isolated flags changed the grouped source raster, shader, alpha or output clip")
  val physical = RectF(0f, 0f, 1600f, 2600f)
  val defaultRaster = GlassPortalRaster(1f).apply { reserve(700f, 1400f, physical.width(), physical.height()) }
  for (invalid in listOf(Float.NaN, Float.POSITIVE_INFINITY, 0f, -1f)) {
    val invalidRaster = GlassPortalRaster(1f, invalid).apply {
      reserve(700f, 1400f, physical.width(), physical.height())
    }
    expect(invalidRaster.scale == defaultRaster.scale && invalidRaster.width == defaultRaster.width &&
      invalidRaster.height == defaultRaster.height, "Invalid budget changed the default raster")
  }

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
  println("Portal early-frame fixture passed: $checks checks; isolated opt-in rows/clip/budget, default201 graph, group bytes/alpha/budget, reversal and constructor flags. No Android pixel/quantization or FPS claim.")
}
