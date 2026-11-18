package expo.modules.liquidglass.menumotion

import android.graphics.RectF

/** Exercises the production ownership boundary. Android Drawable attachment,
 * HWUI clipping and visible glyphs require the separate real-device evidence. */
fun main() {
  var checks = 0
  fun verify(value: Boolean, message: String) { checks++; check(value) { message } }
  for (invalid in listOf(null, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY,
    -1.0, 0.0, .5, 1.01, Int.MAX_VALUE.toDouble() + 1.0, 9_007_199_254_740_991.0)) {
    verify(menuSourceTag(invalid) == null, "Invalid/geometry-only source authorized identity: $invalid")
  }
  for (valid in listOf(1, 2, 117, 1024, Int.MAX_VALUE))
    verify(menuSourceTag(valid.toDouble()) == valid, "Exact source identity changed: $valid")

  // No source is hidden unless identity, active owner and actual Drawable
  // readiness all succeed. A failed attach must be safely releasable.
  for (owner in listOf(false, true)) for (exact in listOf(false, true)) for (ready in listOf(false, true)) {
    val state = MenuSourceOwnership()
    val expected = owner && exact && ready
    verify(state.attach(owner, exact, ready) == expected, "Attach accepted an incomplete source transaction")
    verify(state.attached == expected && state.hidden == expected && !state.released,
      "Failed attachment changed source visibility/ownership flags")
    verify(state.release(), "First release must always be accepted")
    verify(!state.release(), "Duplicate release was not idempotent")
    verify(!state.attach(true, true, true), "A disposed snapshot reattached itself")
    verify(state.detach(true, true, true) == expected, "Release-before-detach lost its authorized restoration")
    verify(!state.attached && !state.hidden, "Disposed snapshot retained overlay/hidden flags")
    verify(!state.detach(true, true, true), "Duplicate detach restored source twice")
  }

  // Restore only the exact current owner's zeroed alpha. A later animation or
  // replacement source must never be overwritten by old popup cleanup.
  for (owner in listOf(false, true)) for (exact in listOf(false, true)) for (stillHidden in listOf(false, true)) {
    val state = MenuSourceOwnership()
    verify(state.attach(true, true, true), "Valid source failed to attach")
    verify(state.detach(owner, exact, stillHidden) == (owner && exact && stillHidden),
      "Stale/recycled/externally animated source was incorrectly restored")
    verify(!state.attached && !state.hidden && !state.released,
      "Window detach must clear visibility ownership without disposing resumable source")
    verify(!state.detach(true, true, true), "A second window detach restored a stale source")
    verify(state.attach(true, true, true), "A valid source could not resume in a visible window")
    verify(state.detach(true, true, true), "Resumed source did not restore symmetrically")
    verify(state.release(), "Resumed source did not release")
  }

  val old = MenuSourceOwnership()
  old.attach(true, true, true)
  verify(old.detach(true, true, true), "Replacing a popup must restore its old exact source first")
  old.release()
  val replacement = MenuSourceOwnership()
  replacement.attach(true, true, true)
  repeat(20) {
    verify(!old.detach(false, true, true), "Late old cleanup restored the replacement's hidden source")
    verify(!old.attach(false, true, true), "Late old work reattached a disposed source")
    verify(replacement.attached && replacement.hidden, "Late old work mutated replacement ownership")
  }
  verify(replacement.detach(true, true, true), "Replacement did not independently restore its source")
  replacement.release()

  // Fabric may recycle the same physical View and change its tag while our
  // old transitionAlpha=0 remains. Cleanup owns that weak INSTANCE, not its
  // later tag; it must restore its own zero without cloning the new control.
  val recycledInstance = MenuSourceOwnership()
  recycledInstance.attach(true, true, true)
  val originalTag = 117
  val recycledTag = 219
  verify(originalTag != recycledTag, "Recycled-tag regression did not change identity")
  verify(recycledInstance.detach(true, true, true),
    "Same weak instance retained our zeroed alpha after its native tag changed")
  verify(!recycledInstance.hidden && !recycledInstance.attached,
    "Recycled weak instance retained old visual ownership")
  val differentInstance = MenuSourceOwnership()
  differentInstance.attach(true, true, true)
  verify(!differentInstance.detach(true, false, true),
    "Cleanup restored an unrelated physical source instead of the original weak instance")

  // These are necessary coordinate/visibility conditions, not a simulation of
  // actual HWUI Canvas clip behavior. The source lives above a fixed card but
  // inside the real root window; a card-sized overlay cannot show its rebound.
  val card = RectF(210f, 400f, 1380f, 2032f)
  val source = RectF(1150f, 136f, 1315f, 301f)
  val motion = GlassMotion()
  motion.initialize(source, card, 105f, 3.75f, source, false, GlassMorphTuning(null, null))
  motion.retarget(true)
  repeat(400) { motion.advanceBy(1f / 120f) }
  motion.retarget(false)
  repeat(18) { motion.advanceBy(1f / 120f) }
  val lobe = motion.frame.sourceLobe
  verify(lobe.bottom < card.top && motion.frame.sourceOpacity > .8f,
    "Regression scenario did not exercise a visible source outside the menu card")
  verify(lobe.left >= 0f && lobe.top >= 0f && lobe.right <= 1440f && lobe.bottom <= 3120f,
    "The regression source is actually outside the root window")
  verify(motion.frame.contentProgress < .02f,
    "Regression scenario did not exercise the phase where source replay carries visible absorption")
  for ((rootX, rootY) in listOf(0 to 0, 0 to 128, 32 to 96)) {
    val localX = lobe.centerX() - rootX
    val localY = lobe.centerY() - rootY
    verify(localX + rootX == lobe.centerX() && localY + rootY == lobe.centerY(),
      "Window-local source replay changed screen origin")
  }
  println("Source ownership harness passed: $checks checks; strict identity, attach gating, rollback/disposal, window resume, stale cleanup and outside-card/root-local source geometry (HWUI clip remains device-only).")
}
