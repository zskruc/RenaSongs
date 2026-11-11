package expo.modules.offlinetranslation

/** Small shared lifecycle fence: admissions, model mutations and destruction
 * are atomic even when Expo calls and MLKit callbacks use different threads. */
class TranslationWorkGate<T>(private val maximum: Int = 2) {
  private val entries = LinkedHashMap<String, T>()
  private val downloads = HashSet<T>()
  private var closed = false
  private var deleting = false
  @Synchronized fun begin(id: String, create: () -> T): T {
    require(id.length in 1..200 && !closed && !deleting && entries.size < maximum && !entries.containsKey(id)) { "A translation task is unavailable or already running" }
    return create().also { entries[id] = it }
  }
  @Synchronized fun entry(id: String): T? = entries[id]
  @Synchronized fun remove(id: String, entry: T) { if (entries[id] === entry) entries.remove(id) }
  @Synchronized fun startDownload(id: String, entry: T, start: () -> Unit) {
    if (closed || entries[id] !== entry) return
    require(downloads.size < maximum) { "Language models are still downloading" }
    downloads.add(entry)
    try { start() } catch (error: Exception) { downloads.remove(entry); throw error }
  }
  @Synchronized fun downloadFinished(entry: T) { downloads.remove(entry) }
  @Synchronized fun startDeletion(start: () -> Unit) {
    require(!closed && entries.isEmpty() && downloads.isEmpty() && !deleting) { "Wait for the active language task" }
    deleting = true
    try { start() } catch (error: Exception) { deleting = false; throw error }
  }
  @Synchronized fun deletionFinished() { deleting = false }
  @Synchronized fun isClosed() = closed
  @Synchronized fun close(): List<Pair<String, T>> { closed = true; return entries.entries.map { it.key to it.value } }
}
