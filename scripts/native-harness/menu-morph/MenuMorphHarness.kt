package expo.modules.liquidglass.menumotion

import android.graphics.RectF
import kotlin.math.abs
import kotlin.random.Random

private var checks = 0
private fun verify(value: Boolean, message: String) { checks++; check(value) { message } }
private fun near(a: Float, b: Float, epsilon: Float = 0.5f) = abs(a - b) <= epsilon
private fun initialized(source: RectF = RectF(900f, 120f, 1020f, 240f),
  target: RectF = RectF(330f, 280f, 1050f, 1580f), density: Float = 3f): GlassMotion = GlassMotion().also {
  it.initialize(source, target, 28f * density, density, source, true, GlassMorphTuning(null, null))
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
  repeat(100) {
    val settled = motion.advanceBy(1f / 120f)
    finite(motion.frame)
    contour.update(motion.frame, target.left, target.top, settled)
    verify(!contour.path.isEmpty, "The liquid mask disappeared")
    verify(contour.path.points.all { (x, y) -> x.isFinite() && y.isFinite() }, "The field contour is invalid")
  }
  settle(motion, 120f)
  contour.update(motion.frame, target.left, target.top, true)
  verify(contour.path.rectangles == 1 && contour.path.points.isEmpty(), "Settled menu must use one cheap native rounded clip")
  verify(near(contour.path.lastRoundRect!!.left, 0f), "Screen-to-Modal origin is not removed")

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
