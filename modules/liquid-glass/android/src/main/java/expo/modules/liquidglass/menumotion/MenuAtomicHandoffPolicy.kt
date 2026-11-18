package expo.modules.liquidglass.menumotion

/** Ordering for one public SurfaceSyncGroup, separate from its async ticket.
 * No source lease may be returned before both roots and the commit listener
 * have joined. Even a rejected or half-joined group must be marked ready.
 */
internal data class MenuAtomicHandoffResult(
  val sourceJoined: Boolean,
  val targetJoined: Boolean,
  val staged: Boolean,
  val stageUncertain: Boolean,
  val markedReady: Boolean,
  val failure: String
)

internal fun runMenuAtomicHandoff(
  addSource: () -> Boolean,
  addTarget: () -> Boolean,
  installCommit: () -> Unit,
  stage: () -> Boolean,
  markReady: () -> Unit
): MenuAtomicHandoffResult {
  var sourceJoined = false
  var targetJoined = false
  var staged = false
  var stageUncertain = false
  var markedReady = false
  var phase = "add-source"
  var failure = "none"
  try {
    sourceJoined = addSource()
    if (!sourceJoined) failure = "source-rejected"
    else {
      phase = "add-target"
      targetJoined = addTarget()
      if (!targetJoined) failure = "target-rejected"
      else {
        phase = "install-commit"
        installCommit()
        phase = "stage"
        staged = stage()
        if (!staged) failure = "stage-rejected"
      }
    }
  } catch (_: RuntimeException) {
    stageUncertain = phase == "stage"
    failure = "$phase-exception"
  } catch (_: LinkageError) {
    stageUncertain = phase == "stage"
    failure = "$phase-unavailable"
  } finally {
    try {
      markReady()
      markedReady = true
    } catch (_: RuntimeException) {
      failure = if (failure == "none") "mark-ready-exception" else "$failure/mark-ready-exception"
    } catch (_: LinkageError) {
      failure = if (failure == "none") "mark-ready-unavailable" else "$failure/mark-ready-unavailable"
    }
  }
  return MenuAtomicHandoffResult(sourceJoined, targetJoined, staged, stageUncertain, markedReady, failure)
}
