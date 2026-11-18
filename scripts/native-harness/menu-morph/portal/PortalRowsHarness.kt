package expo.modules.liquidglass.menumotion

import android.graphics.Canvas
import android.graphics.RectF
import android.graphics.RenderNode
import android.view.View
import kotlin.math.abs

/** Executes production GlassForegroundPortal; the Canvas only counts calls. */
private var portalChecks = 0
private fun verify(value: Boolean, message: String) { portalChecks++; check(value) { message } }

fun main() {
  val portal = GlassForegroundPortal(1f)
  portal.diagnosticsEnabled = true
  val frame = GlassMorphFrame().apply {
    bounds.set(40f, 100f, 340f, 580f)
    sourceLobe.set(180f, 20f, 340f, 64f)
    sourceRadius = 22f; sourceOpacity = 1f; rowsOpacity = 0f
  }
  val limits = RectF(0f, 0f, 400f, 800f)
  val body = View()
  val canvas = Canvas()
  var bodies = 0
  var sources = 0
  fun update() { portal.update(frame, 0f, 0f, true, null) }
  fun draw() { portal.draw(canvas, limits, true, { bodies++ }, { sources++ }) }
  fun rows() = RenderNode.instances.last { it.name == "ResonusMenu.rows" }
  fun composite() = RenderNode.instances.last { it.name == "RenaMenu.sourceAndRows" }
  portal.reserve(frame.bounds, 0f, 0f, limits, true)
  update()
  portal.setContentBlur(body, 24f, .7f, .4f)
  draw()
  verify(bodies == 0 && rows().recordings == 0, "Initial source-only frame recorded invisible RN rows")
  verify(rows().effectUpdates == 0, "Initial source-only frame built a rows Gaussian")
  verify(sources == 1 && composite().recordings == 1, "Skipping rows removed the independently visible source")
  repeat(120) { tick ->
    frame.sourceLobe.offset(.01f, 0f)
    frame.portalBlur = tick % 7f
    update()
    portal.setContentBlur(body, tick.toFloat(), .4f, .7f)
    draw()
  }
  verify(bodies == 0 && rows().recordings == 0 && rows().effectUpdates == 0,
    "Changing hidden geometry/blur still visited RN rows or recreated their effects")
  verify(body.dirtyReads == 0 && sources == 121, "Invisible rows scanned native dirty flags or stopped the source track")

  // A reversal/reveal is a new real update. Current—not last hidden—blur and
  // geometry must be applied before the composite can include the rows node.
  frame.rowsOpacity = .4f
  frame.portalBlur = 0f
  update()
  portal.setContentBlur(body, 8f, .5f, .5f)
  draw()
  verify(bodies == 1 && rows().recordings == 1 && rows().effectUpdates == 1,
    "Reverse/reveal did not re-record current rows and reconcile their current Gaussian")
  verify(rows().alphaValue == .4f && composite().currentCanvas.replayed.contains("ResonusMenu.rows"),
    "Revealed rows retained hidden opacity or were omitted from the source composite")
  val effect = checkNotNull(rows().effect)
  val rasterScale = kotlin.math.min(1f, kotlin.math.sqrt(720_000f / (400f * 800f)))
  val expectedRadius = GlassPortalBlur.combinedRadius(GlassPortalBlur.sigma(16f) * .5f, 0f, rasterScale)
  verify(abs(effect.x - expectedRadius) < .0001f && abs(effect.y - expectedRadius) < .0001f,
    "Reveal reused a Gaussian from an invisible intermediate frame")
  draw()
  verify(bodies == 1 && rows().effectUpdates == 1, "Identical clean frame lost the existing rows cache")
  body.dirty = true
  draw()
  verify(bodies == 2, "Visible native dirty rows no longer invalidate the retained recording")
  body.dirty = false

  val lastRecordings = rows().recordings
  val lastEffects = rows().effectUpdates
  frame.rowsOpacity = .001f
  update()
  portal.setContentBlur(body, 0f, 1f, 1f)
  draw()
  verify(rows().recordings == lastRecordings && rows().effectUpdates == lastEffects,
    "The original visibility threshold must also gate row preparation")
  verify(!composite().currentCanvas.replayed.contains("ResonusMenu.rows"), "Hidden rows still entered the common source composite")

  // Capacity changes while hidden must not cause a body recording. A later
  // visible update has to record into the new dimensions and clear old blur.
  val resizedLimits = RectF(0f, 0f, 500f, 900f)
  portal.reserve(frame.bounds, 0f, 0f, resizedLimits, true)
  portal.draw(canvas, resizedLimits, true, { bodies++ }, { sources++ })
  verify(rows().recordings == lastRecordings && rows().effectUpdates == lastEffects,
    "A hidden raster resize recorded/filter-built rows that cannot be drawn")
  frame.rowsOpacity = .8f
  update()
  portal.draw(canvas, resizedLimits, true, { bodies++ }, { sources++ })
  verify(rows().recordings == lastRecordings + 1 && rows().recordingWidth == 500 && rows().recordingHeight == 900,
    "Revealed rows reused stale pre-resize content/capacity")
  verify(rows().effect == null && rows().effectUpdates == lastEffects + 1,
    "A hidden blur change was not reconciled to zero before reveal")
  portal.release()
  verify(!rows().hasDisplayList(), "Presentation release did not retire its rows recording")

  // Existing non-warp/software behavior and ordinary nongroup invisibility
  // remain unchanged; this optimization is only the unused rows raster work.
  val ordinary = GlassForegroundPortal(1f)
  ordinary.reserve(frame.bounds, 0f, 0f, limits, false)
  frame.rowsOpacity = 0f
  ordinary.update(frame, 0f, 0f, false, null)
  var ordinaryBodies = 0
  ordinary.draw(canvas, limits, true, { ordinaryBodies++ })
  verify(ordinaryBodies == 0, "An invisible nongroup frame should preserve its early return")
  ordinary.draw(canvas, limits, false, { ordinaryBodies++ })
  verify(ordinaryBodies == 1, "Settled direct content behavior was changed")
  ordinary.draw(Canvas(false), limits, true, { ordinaryBodies++ })
  verify(ordinaryBodies == 2, "Software fallback behavior was changed")
  println("Portal rows harness passed: $portalChecks checks; real production update/draw, hidden rows no recording/effects/dirty scan, reverse/reveal, resize, current blur, disposal and direct/software compatibility (not GPU pixels).")
}
