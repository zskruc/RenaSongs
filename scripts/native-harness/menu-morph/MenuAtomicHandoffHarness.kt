package expo.modules.liquidglass.menumotion

/** Adversarial inputs to the real production transaction-order and ticket
 * policies. These checks do not execute SurfaceSyncGroup, render a buffer or
 * establish atomic compositor presentation on Android. */
private var atomicChecks = 0
private fun verifyAtomic(value: Boolean, message: String) {
  atomicChecks++
  check(value) { message }
}

private data class AtomicCase(val result: MenuAtomicHandoffResult, val calls: List<String>,
  val sourceMutated: Boolean)

private fun exerciseAtomic(failurePhase: String? = null, mode: String = "none",
  readyMode: String = "none", mutateBeforeStageThrow: Boolean = false): AtomicCase {
  val calls = mutableListOf<String>()
  var mutated = false
  fun visit(phase: String): Boolean {
    calls += phase
    if (phase == "stage" && mutateBeforeStageThrow) mutated = true
    if (phase != failurePhase) return true
    return when (mode) {
      "false" -> false
      "runtime" -> throw IllegalStateException(phase)
      "linkage" -> throw NoSuchMethodError(phase)
      else -> true
    }
  }
  val result = runMenuAtomicHandoff(
    addSource = { visit("add-source") }, addTarget = { visit("add-target") },
    installCommit = { visit("install-commit"); Unit },
    stage = { visit("stage").also { if (it) mutated = true } },
    markReady = {
      calls += "mark-ready"
      if (readyMode == "runtime") throw IllegalStateException("mark-ready")
      if (readyMode == "linkage") throw NoSuchMethodError("mark-ready")
    })
  return AtomicCase(result, calls, mutated)
}

fun main() {
  val success = exerciseAtomic()
  verifyAtomic(success.calls == listOf("add-source", "add-target", "install-commit", "stage", "mark-ready"),
    "Both roots and the committed-listener must join before any source change")
  verifyAtomic(success.result.sourceJoined && success.result.targetJoined && success.result.staged &&
    !success.result.stageUncertain && success.result.markedReady && success.result.failure == "none",
    "A fully staged transaction must report its actual lifecycle")
  for ((phase, expectedCalls) in listOf(
    "add-source" to listOf("add-source", "mark-ready"),
    "add-target" to listOf("add-source", "add-target", "mark-ready"),
    "stage" to listOf("add-source", "add-target", "install-commit", "stage", "mark-ready"))) {
    val rejected = exerciseAtomic(phase, "false")
    verifyAtomic(rejected.calls == expectedCalls, "Rejected $phase executed an unauthorized later action")
    verifyAtomic(!rejected.result.staged && !rejected.result.stageUncertain && !rejected.sourceMutated,
      "A rejected membership/stage must not claim source mutation or an uncertain commit")
    verifyAtomic(rejected.result.markedReady && rejected.calls.count { it == "mark-ready" } == 1,
      "Even a half-joined/rejected group needs exactly one ready attempt")
  }
  for (mode in listOf("runtime", "linkage")) {
    for (phase in listOf("add-source", "add-target", "install-commit", "stage")) {
      val failed = exerciseAtomic(phase, mode)
      verifyAtomic(failed.calls.last() == "mark-ready" && failed.calls.count { it == "mark-ready" } == 1,
        "$phase/$mode did not release its created group in finally")
      verifyAtomic(!failed.result.staged && failed.result.markedReady &&
        failed.result.failure == "$phase-${if (mode == "runtime") "exception" else "unavailable"}",
        "$phase/$mode lost its precise failure phase")
      verifyAtomic(failed.result.stageUncertain == (phase == "stage"),
        "Only an attempted stage can have partially returned the source")
      if (phase != "stage") verifyAtomic(!failed.sourceMutated && !failed.calls.contains("stage"),
        "Membership/listener failure changed the source before both roots were ready")
    }
    // A View operation after source-alpha return may fail. Its transaction
    // cannot safely be treated as untouched and sent through parallel fallback.
    for (mutated in listOf(false, true)) {
      val uncertain = exerciseAtomic("stage", mode, mutateBeforeStageThrow = mutated)
      verifyAtomic(uncertain.result.stageUncertain && !uncertain.result.staged,
        "Thrown stage must remain conservative whether it failed before or after mutation")
      verifyAtomic(uncertain.sourceMutated == mutated && uncertain.result.markedReady,
        "The fixture failed to exercise the actual post-return exception boundary")
      verifyAtomic(!(!uncertain.result.staged && !uncertain.result.stageUncertain),
        "An uncertain staged transaction must not qualify for untouched-source fallback")
    }
    val readyFailure = exerciseAtomic(readyMode = mode)
    verifyAtomic(readyFailure.result.staged && !readyFailure.result.markedReady &&
      readyFailure.calls.count { it == "stage" } == 1,
      "Ready failure must not erase a source already staged or retry its mutation")
    val combined = exerciseAtomic("add-target", "false", readyMode = mode)
    verifyAtomic(!combined.result.staged && !combined.result.stageUncertain &&
      combined.result.failure.startsWith("target-rejected/mark-ready-"),
      "Ready failure must preserve the prior half-join rejection")
  }

  // Delayed platform callbacks exercise the real shared ticket policy. No
  // simulated callback is treated as an Android GPU/transaction success.
  val tickets = MenuSourceHandoff()
  var session = 71
  var open = false
  var completions = 0
  fun prepareCallback(): () -> Unit {
    val ticket = checkNotNull(tickets.begin(session))
    var callback: (() -> Unit)? = null
    val result = runMenuAtomicHandoff({ true }, { true },
      { callback = { if (tickets.finish(ticket, session, open)) completions++ } },
      { true }, {})
    verifyAtomic(result.staged && tickets.pending && completions == 0,
      "Staging must wait for its own later platform callback or finite watchdog")
    return checkNotNull(callback)
  }
  val first = prepareCallback()
  first(); first()
  verifyAtomic(completions == 1 && !tickets.pending, "Repeated compositor callback completed one close twice")
  completions = 0
  val cancelled = prepareCallback()
  tickets.cancel() // detach/reopen revokes the previous native transaction.
  open = true
  cancelled()
  verifyAtomic(completions == 0 && !tickets.pending, "Late callback closed a reopened presentation")
  open = false
  val replacement = prepareCallback()
  cancelled()
  verifyAtomic(tickets.pending && completions == 0, "Old same-session callback consumed the replacement wait")
  replacement()
  verifyAtomic(completions == 1 && !tickets.pending, "New source transaction lost its own completion")
  completions = 0
  val disposed = prepareCallback()
  tickets.cancel()
  session++
  disposed()
  verifyAtomic(completions == 0 && !tickets.pending, "Late result survived timeout/disposal and session replacement")
  val timeoutTicket = checkNotNull(tickets.begin(session))
  val latePlatformResult = { if (tickets.finish(timeoutTicket, session, open)) completions++ }
  val timeoutAttempt = runMenuAtomicHandoff({ true }, { true }, {}, { true }, {})
  verifyAtomic(timeoutAttempt.staged && tickets.pending, "Watchdog fixture has no staged native transaction")
  verifyAtomic(tickets.finish(timeoutTicket, session, open), "Finite watchdog could not complete its exact pending ticket")
  latePlatformResult()
  verifyAtomic(completions == 0 && !tickets.pending, "A platform result completed a transaction again after its watchdog")
  println("Menu atomic handoff policy passed: $atomicChecks checks; dual membership/order, partial failure, finally-ready, uncertain staging and stale callbacks (not Android SurfaceSyncGroup or GPU execution).")
}
