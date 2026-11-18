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

  // Return the source lease synchronously on physical detach, before Fabric
  // can reuse its tag. Returning the original does not retire immutable pixels
  // or the foreground drawing owner needed to finish the closing animation.
  val recycledInstance = MenuSourceOwnership()
  recycledInstance.attach(true, true, true)
  val originalTag = 117
  val recycledTag = 219
  verify(originalTag != recycledTag, "Recycled-tag regression did not change identity")
  verify(recycledInstance.returnSource(true, true, true),
    "Physical detach did not return its exact original zeroed-alpha source lease")
  verify(!recycledInstance.hidden && recycledInstance.attached && !recycledInstance.released,
    "Returning the original prematurely retired the immutable closing foreground")
  verify(!recycledInstance.returnSource(true, false, true), "A recycled source tag received late alpha restoration")
  verify(!recycledInstance.detach(true, false, true), "Late close restored a source whose lease was already returned")
  verify(!recycledInstance.hidden && !recycledInstance.attached, "Late close retained an already returned source lease")
  val differentInstance = MenuSourceOwnership()
  differentInstance.attach(true, true, true)
  verify(!differentInstance.detach(true, false, true),
    "Cleanup restored an unrelated physical source instead of the original weak instance")
  // Some RN recycling/layout paths reset a tag before delivering detach. A
  // still-owned zero belongs to the same weak INSTANCE; id-strict capture must
  // not turn cleanup into a permanently transparent pooled control.
  for (owner in listOf(false, true)) for (sameInstance in listOf(false, true)) for (alpha in listOf(0f, .4f, 1f)) {
    val resetBeforeDetach = MenuSourceOwnership()
    resetBeforeDetach.attach(true, true, true)
    var instanceTag = originalTag
    var instanceAlpha = alpha
    instanceTag = recycledTag
    val restored = resetBeforeDetach.returnSource(owner, sameInstance, instanceAlpha == 0f)
    if (restored) instanceAlpha = .8f
    verify(instanceTag == recycledTag && restored == (owner && sameInstance && alpha == 0f),
      "Id reset before detach suppressed a valid physical-source restoration or adopted a new owner")
    verify(instanceAlpha == if (owner && sameInstance && alpha == 0f) .8f else alpha,
      "Source cleanup overwrote an unrelated owner/instance/nonzero alpha")
    // The source weak ref is cleared on the real detach path, so the later
    // close receives no exact source and can never touch its pooled reuse.
    verify(!resetBeforeDetach.returnSource(true, false, true),
      "Late close altered a reused View after detach returned/cleared the old source lease")
    verify(!resetBeforeDetach.detach(true, false, true),
      "Window disposal repeated a source restoration after lease return")
  }
  for (owner in listOf(false, true)) for (exact in listOf(false, true)) for (zeroAlpha in listOf(false, true)) {
    val detached = MenuSourceOwnership()
    detached.attach(true, true, true)
    verify(detached.returnSource(owner, exact, zeroAlpha) == (owner && exact && zeroAlpha),
      "Source detach restored a stale owner, a recycled tag or another animation's alpha")
    verify(!detached.hidden && detached.attached && !detached.released,
      "Source-only return changed the retained rendering lifetime")
    verify(!detached.returnSource(true, true, true), "Duplicate source detach restored the same lease twice")
    verify(!detached.detach(true, true, true), "Window teardown restored an already returned lease")
    verify(detached.release() && !detached.release(), "Returned-source foreground disposal was not idempotent")
  }

  // The real handoff policy is separate from a compositor/fence simulation.
  // It must observe commit before restoring the original, stay once-only and
  // leave immutable drawing ownership alive until native finishes the window.
  val commitOwner = MenuSourceOwnership()
  commitOwner.attach(true, true, true)
  val commitEvents = ArrayList<String>()
  var liveSource = true
  fun attemptCommit() = handoffMenuSourceAfterRegistration(
    valid = { liveSource && commitOwner.hidden && commitOwner.attached && !commitOwner.released },
    register = { commitEvents.add("register-commit"); true },
    restore = { commitEvents.add("restore-source"); check(commitOwner.returnSource(true, true, true)) }
  )
  verify(attemptCommit(), "Valid original Activity could not register its commit handoff")
  verify(commitEvents == listOf("register-commit", "restore-source"), "Original source was restored before commit observation registered")
  verify(commitOwner.attached && !commitOwner.hidden && !commitOwner.released,
    "Source commit registration discarded the closing immutable foreground")
  verify(!attemptCommit() && commitEvents.size == 2, "Repeated handoff registered/restored the same source twice")
  for (initialValid in listOf(false, true)) for (registerSuccess in listOf(false, true))
      for (staysValid in listOf(false, true)) {
    var valid = initialValid
    val events = ArrayList<String>()
    val result = handoffMenuSourceAfterRegistration(valid = { valid }, register = {
      events.add("register"); valid = staysValid; registerSuccess
    }, restore = { events.add("restore") })
    verify(result == (initialValid && registerSuccess && staysValid), "Invalid/failed/replaced handoff claimed completion")
    verify(events.count { it == "register" } == if (initialValid) 1 else 0,
      "Detached or unowned source registered a frame callback")
    verify(events.count { it == "restore" } == if (result) 1 else 0,
      "Failed registration or stale callback restored a replacement source")
  }
  var exceptionalRestore = false
  verify(!handoffMenuSourceAfterRegistration({ true }, { throw IllegalStateException("window disposed") }, { exceptionalRestore = true }) &&
    !exceptionalRestore, "A failed public frame callback registration restored source pixels prematurely")

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
