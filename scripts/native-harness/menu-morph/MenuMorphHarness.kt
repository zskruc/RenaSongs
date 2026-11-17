package expo.modules.liquidglass.menumotion

import android.graphics.RectF
import kotlin.math.abs
import kotlin.random.Random
import expo.modules.liquidglass.MenuMaterialGeometry

private var checks = 0
private fun verify(value: Boolean, message: String) { checks++; check(value) { message } }
private fun near(a: Float, b: Float, epsilon: Float = 0.5f) = abs(a - b) <= epsilon
private fun initialized(source: RectF = RectF(900f, 120f, 1020f, 240f),
  target: RectF = RectF(330f, 280f, 1050f, 1580f), density: Float = 3f): GlassMotion = GlassMotion().also {
  it.initialize(source, target, 28f * density, density, source, false, GlassMorphTuning(null, null))
}
private fun settle(motion: GlassMotion, fps: Float): Int {
  for (frame in 1..(fps * 5f).toInt()) if (motion.advanceBy(1f / fps)) return frame
  error("Spring failed to settle at $fps Hz")
}
private fun finite(frame: GlassMorphFrame) {
  for (value in listOf(frame.bounds.left, frame.bounds.top, frame.bounds.right, frame.bounds.bottom,
    frame.sourceLobe.left, frame.sourceLobe.top, frame.sourceLobe.right, frame.sourceLobe.bottom,
    frame.radiusX, frame.radiusY, frame.smoothing, frame.contentProgress, frame.rowsOpacity))
    verify(value.isFinite(), "Nonfinite spring/outline coordinate")
  verify(frame.bounds.width() > 0f && frame.bounds.height() > 0f, "Collapsed into invalid shell")
}

fun main() {
  val target = RectF(330f, 280f, 1050f, 1580f)
  val source = RectF(900f, 120f, 1020f, 240f)
  val clock = GlassFrameClock()
  clock.restart(1f)
  verify(near(clock.advance(1L, 120f), 1f / 240f, 0.000001f), "First visible frame must advance immediately, as upstream")
  clock.restart(0.5f)
  verify(near(clock.advance(1L, 120f), 1f / 120f, 0.000001f), "System half-duration animation setting was ignored")
  verify(clock.advance(1_000_000_001L, 120f) <= 1f / 60f + 0.000001f, "Startup hitch caused an unbounded geometry jump")
  clock.restart(0f)
  verify(clock.advance(1L, 120f) == 10f, "Disabled animations did not finish immediately")
  val elapsed = ArrayList<Float>()
  for (fps in listOf(24f, 60f, 90f, 120f, 144f)) {
    val motion = initialized()
    verify(near(motion.frame.bounds.centerX(), source.centerX(), 2f), "Morph must start at the trigger")
    verify(motion.frame.bounds.width() < target.width() * 0.25f, "Opening must be a real source morph")
    motion.retarget(true)
    val frames = settle(motion, fps)
    elapsed.add(frames / fps)
    verify(near(motion.frame.bounds.left, target.left) && near(motion.frame.bounds.top, target.top), "Open target drift at $fps")
    verify(near(motion.frame.bounds.width(), target.width()) && near(motion.frame.bounds.height(), target.height()), "Layout dimensions changed")
    verify(motion.frame.rowsOpacity == 1f && motion.frame.contentProgress == 1f, "Content did not fully reveal")
    val before = motion.frame.bounds.left
    motion.retarget(false)
    verify(near(before, motion.frame.bounds.left, 0.001f), "Close retarget must not jump")
    settle(motion, fps)
    verify(near(motion.frame.sourceLobe.left, source.left) && near(motion.frame.sourceLobe.bottom, source.bottom), "Source did not restore")
    verify(motion.frame.contentProgress == 0f && motion.frame.rowsOpacity == 0f, "Closed content can remain a ghost target")
  }
  verify(elapsed.max() - elapsed.min() < 0.16f, "Animation duration depends on refresh rate")

  // Reverse at several points; preserve instantaneous position/velocity state.
  for (reverseAt in listOf(1, 8, 16, 30, 60)) {
    val motion = initialized()
    motion.retarget(true)
    repeat(reverseAt) { motion.advanceBy(1f / 120f) }
    val before = motion.frame.bounds.left
    motion.retarget(false)
    verify(near(before, motion.frame.bounds.left, 0.001f), "Interrupted opening jumped")
    repeat(5) { motion.advanceBy(1f / 120f) }
    val back = motion.frame.bounds.top
    motion.retarget(true)
    verify(near(back, motion.frame.bounds.top, 0.001f), "Interrupted closing jumped")
    settle(motion, 120f)
    verify(near(motion.frame.bounds.top, target.top), "Reversal retained a stale destination")
  }

  val motion = initialized()
  motion.retarget(true)
  val contour = GlassMorphOutline(3f)
  var fieldFrames = 0
  repeat(100) {
    val settled = motion.advanceBy(1f / 120f)
    finite(motion.frame)
    contour.update(motion.frame, target.left, target.top, settled, false, 30f)
    contour.smoothedField?.let { field ->
      fieldFrames++
      verify(field.step == 30f, "Gaussian grid changed while shell moved")
      verify(field.width <= 72 && field.height <= 72, "Field exceeded its bounded upstream grid")
    }
    verify(!contour.path.isEmpty, "The liquid mask disappeared")
    verify(contour.path.points.all { (x, y) -> x.isFinite() && y.isFinite() }, "The field contour is invalid")
  }
  settle(motion, 120f)
  contour.update(motion.frame, target.left, target.top, true)
  verify(contour.path.rectangles == 1 && contour.path.points.isEmpty(), "Settled menu must use one cheap native rounded clip")
  verify(near(contour.path.lastRoundRect!!.left, 0f), "Screen-to-Modal origin is not removed")
  verify(fieldFrames > 0, "Shared Gaussian portal field was not generated")
  val closedPlain = initialized()
  contour.update(closedPlain.frame, 0f, 0f, false)
  verify(contour.path.rectangles == 1, "A plain button fabricated an opaque secondary glass circle")
  contour.update(closedPlain.frame, 0f, 0f, false, true)
  verify(contour.path.rectangles == 2, "An actual glass trigger lost its secondary lobe")

  // A moving glass shell must reveal stationary page pixels. Model the actual
  // native viewport/child placement and sampling origin, with a separate Modal
  // origin and a capture envelope extending beyond its final RN card layout.
  val geometry = MenuMaterialGeometry()
  verify(geometry.reserve(-300f, -250f, 900f, 1700f), "Menu capture envelope did not reserve")
  val capacity = listOf(geometry.captureLeft, geometry.captureTop, geometry.captureRight, geometry.captureBottom)
  val moving = initialized()
  val hostX = 330f
  val hostY = 280f
  val marks = listOf(420f to 400f, 600f to 800f, 900f to 1200f)
  moving.retarget(true)
  repeat(2) { phase ->
    if (phase == 1) moving.retarget(false)
    repeat(120) {
      moving.advanceBy(1f / 120f)
      val f = moving.frame
      val l = minOf(f.bounds.left, f.sourceLobe.left) - hostX - f.smoothing
      val t = minOf(f.bounds.top, f.sourceLobe.top) - hostY - f.smoothing
      val r = maxOf(f.bounds.right, f.sourceLobe.right) - hostX + f.smoothing
      val b = maxOf(f.bounds.bottom, f.sourceLobe.bottom) - hostY + f.smoothing
      geometry.update(l, t, r, b)
      verify(listOf(geometry.captureLeft, geometry.captureTop, geometry.captureRight, geometry.captureBottom) == capacity,
        "Animation changed capture ROI and could reuse a cropped image")
      for ((screenX, screenY) in marks) {
        val sampleOriginX = hostX + geometry.captureLeft + geometry.placementX
        val sampleOriginY = hostY + geometry.captureTop + geometry.placementY
        val sampledX = screenX - sampleOriginX
        val sampledY = screenY - sampleOriginY
        val paintedX = hostX + geometry.captureLeft + geometry.placementX + sampledX
        val paintedY = hostY + geometry.captureTop + geometry.placementY + sampledY
        verify(near(paintedX, screenX, 0.001f) && near(paintedY, screenY, 0.001f),
          "Backdrop marker moved with its shell")
        val neighbourX = hostX + geometry.captureLeft + geometry.placementX + sampledX + 10f
        verify(near(neighbourX - paintedX, 10f, 0.001f), "Background image was scaled instead of sampled at 1:1")
      }
    }
  }
  val previous = geometry.left
  verify(!geometry.update(Float.NaN, 0f, 1f, 1f) && geometry.left == previous, "Invalid geometry entered material layout")
  verify(geometry.clear() && !geometry.active, "Native menu capacity leaked after closing")
  geometry.reserve(0f, 0f, 1000f, 1000f)
  geometry.update(0f, 0f, 100f, 200f)
  geometry.update(20f, 30f, 120f, 230f)
  verify(geometry.placementChanged && !geometry.sizeChanged, "Pure motion forced full blur/lens measurement")

  // Tiny buttons, wide list rows, phone/tablet cards, different display density.
  val random = Random(927)
  repeat(100) {
    val density = random.nextFloat() * 3f + 1f
    val x = random.nextFloat() * 400f
    val y = random.nextFloat() * 800f
    val sourceRect = RectF(x, y, x + random.nextFloat() * 250f + 12f, y + random.nextFloat() * 120f + 12f)
    val dest = RectF(20f, 80f, random.nextFloat() * 600f + 320f, random.nextFloat() * 800f + 500f)
    val value = initialized(sourceRect, dest, density)
    value.retarget(true)
    repeat(20) { value.advanceBy(1f / 120f); finite(value.frame) }
    value.retarget(false)
    settle(value, 120f)
    finite(value.frame)
  }
  println("Menu morph harness: $checks checks passed (upstream springs, 24–144 Hz, reversal, liquid contour, screen coordinates).")
}
