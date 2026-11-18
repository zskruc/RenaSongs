package expo.modules.liquidglass.menumotion

/** Exercises the real ticket policy. Android buffer presentation still needs
 * device evidence; this harness deliberately does not mock a compositor. */
private var handoffChecks = 0
private fun verifyHandoff(value: Boolean, message: String) {
  handoffChecks++
  check(value) { message }
}

fun main() {
  val handoff = MenuSourceHandoff()
  verifyHandoff(!handoff.pending, "A new handoff is idle")
  val first = checkNotNull(handoff.begin(31))
  verifyHandoff(handoff.pending && first.session == 31, "The source commit owns the closing session")
  verifyHandoff(handoff.begin(31) == null, "A repeated settled frame cannot register a second callback")
  verifyHandoff(!handoff.finish(first, 32, false) && handoff.pending,
    "A callback cannot complete a replacement session")
  verifyHandoff(!handoff.finish(first, 31, true) && handoff.pending,
    "A callback cannot close a requested reopen")
  verifyHandoff(handoff.finish(first, 31, false) && !handoff.pending,
    "The current closing source commit completes exactly once")
  verifyHandoff(!handoff.finish(first, 31, false), "A repeated callback cannot complete twice")

  val timeout = checkNotNull(handoff.begin(31))
  verifyHandoff(timeout.generation != first.generation, "A same-session retry gets a fresh ticket")
  verifyHandoff(handoff.finish(timeout, 31, false), "A bounded timeout may release the same pending close")
  verifyHandoff(!handoff.finish(timeout, 31, false), "The later real commit after timeout is stale")

  // Cancel/reopen before an asynchronous old callback, including reusing the
  // same React/native session id. Cancellation must revoke ticket identity.
  val cancelled = checkNotNull(handoff.begin(31))
  handoff.cancel()
  verifyHandoff(!handoff.pending, "Disposal/reopen revokes a pending source wait")
  val reopened = checkNotNull(handoff.begin(31))
  verifyHandoff(reopened.generation > cancelled.generation, "Cancelled epochs are never reused")
  verifyHandoff(!handoff.finish(cancelled, 31, false) && handoff.pending,
    "An old callback cannot remove the reopened window owner")
  verifyHandoff(handoff.finish(reopened, 31, false), "The new source owns its own completion")

  // The ordering of timeout vs callback must not change completion ownership.
  for (commitFirst in listOf(true, false)) {
    val current = checkNotNull(handoff.begin(47))
    val completions = mutableListOf<String>()
    fun complete(reason: String) { if (handoff.finish(current, 47, false)) completions += reason }
    if (commitFirst) { complete("commit"); complete("timeout") }
    else { complete("timeout"); complete("commit") }
    verifyHandoff(completions == listOf(if (commitFirst) "commit" else "timeout") && !handoff.pending,
      "Commit/timeout race must produce only one close completion")
  }
  handoff.cancel()
  handoff.cancel()
  verifyHandoff(!handoff.pending, "Repeated cleanup is idle and idempotent")
  val final = checkNotNull(handoff.begin(48))
  verifyHandoff(!handoff.finish(reopened, 48, false) && handoff.pending,
    "A callback from a previously completed source cannot clear a later wait")
  verifyHandoff(handoff.finish(final, 48, false), "Later sessions remain usable after all stale callbacks")
  println("Menu source handoff passed: $handoffChecks checks; real policy session/ticket, reopen, timeout/callback and idempotent disposal (not Android frame-commit presentation).")
}
