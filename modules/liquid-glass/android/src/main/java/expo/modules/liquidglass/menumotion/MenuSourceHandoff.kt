package expo.modules.liquidglass.menumotion

/** A finite, one-source-buffer handoff. Late callbacks cannot close a reopen. */
internal class MenuSourceHandoff {
  data class Ticket(val session: Int, val generation: Long)
  private var generation = 0L
  private var ticket: Ticket? = null
  val pending get() = ticket != null
  fun begin(session: Int): Ticket? {
    if (ticket != null) return null
    return Ticket(session, ++generation).also { ticket = it }
  }
  fun finish(candidate: Ticket, currentSession: Int, open: Boolean): Boolean {
    if (ticket != candidate || candidate.session != currentSession || open) return false
    ticket = null
    return true
  }
  fun cancel() { generation++; ticket = null }
}
