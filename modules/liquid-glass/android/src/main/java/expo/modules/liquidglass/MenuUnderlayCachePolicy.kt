package expo.modules.liquidglass

/** Only source content/geometry enters this key; literal scrim paint is live. */
internal data class MenuUnderlayKey(
  val pageEpoch: Long, val generation: Long,
  val rootIdentity: Int, val sourceIdentity: Int, val ownerIdentity: Int, val scrimIdentity: Int,
  val rootWidth: Int, val rootHeight: Int, val rootX: Int, val rootY: Int,
  val sourceWidth: Int, val sourceHeight: Int, val sourceX: Int, val sourceY: Int,
  val geometry: RecordedBackdropGeometry,
  val sceneVersion: Long, val materialVersion: Long, val scrollVersion: Long
)

/** MAIN-only single-flight policy. FIFO/Image ownership stays with WindowBackdrop. */
internal class MenuUnderlayCachePolicy {
  internal class Ticket internal constructor(val key: MenuUnderlayKey, val serial: Long)
  enum class Completion { ACCEPT, STALE, FAILED }
  private var serial = 0L
  private var latest: MenuUnderlayKey? = null
  private var pending: Ticket? = null
  private var cached: MenuUnderlayKey? = null
  private var failed: MenuUnderlayKey? = null
  val hasPending get() = pending != null
  val hasCached get() = cached != null
  val hasFailed get() = failed != null

  fun observe(key: MenuUnderlayKey) {
    if (latest == key) return
    latest = key
    cached = null
    failed = null
  }
  fun begin(key: MenuUnderlayKey): Ticket? {
    observe(key)
    if (pending != null || cached == key || failed == key) return null
    return Ticket(key, ++serial).also { pending = it }
  }
  fun complete(ticket: Ticket, current: MenuUnderlayKey?, success: Boolean): Completion {
    if (pending !== ticket) return Completion.STALE
    pending = null
    if (current == null || latest != current || ticket.key != current) return Completion.STALE
    if (!success) { failed = current; return Completion.FAILED }
    cached = current
    return Completion.ACCEPT
  }
  fun fail(key: MenuUnderlayKey) {
    if (latest != null && latest != key) return
    observe(key)
    if (pending?.key == key) pending = null
    failed = key
  }
  fun clear() { latest = null; pending = null; cached = null; failed = null }
}
