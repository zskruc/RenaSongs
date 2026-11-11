package expo.modules.metadatascript
import java.io.Closeable

/** Shared by the Android binding and real-descriptor JVM regression tests. */
fun <I : Closeable, O : Closeable, R> withParserDescriptors(input: () -> I, output: () -> O, send: (I, O) -> R): R =
  input().use { first -> output().use { second -> send(first, second) } }

/** Admission covers enqueue as well as binding; destruction cannot race an
 * accepted but not yet enqueued job into a shutdown executor/orphan service. */
class ParserHostLifecycle {
  @Volatile var closed = false; private set
  private var active = false
  @Synchronized fun submit(enqueue: () -> Unit): Boolean {
    if (closed || active) return false
    active = true
    try { enqueue() } catch (error: Exception) { active = false; throw error }
    return true
  }
  @Synchronized fun complete(): Boolean { active = false; return closed }
  @Synchronized fun destroy(): Boolean { closed = true; return !active }
}
