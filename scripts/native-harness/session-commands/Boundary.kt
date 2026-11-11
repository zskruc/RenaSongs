// Test-only framework boundary; the service method is extracted from production.
interface Player {
  fun getAvailableCommands(): Commands
  fun isCommandAvailable(command: Int): Boolean
  class Commands(private val commands: Set<Int>) {
    fun contains(command: Int) = commands.contains(command)
    fun buildUpon() = Builder(commands.toMutableSet())
    class Builder(private val commands: MutableSet<Int> = mutableSetOf()) {
      fun add(command: Int): Builder { commands.add(command); return this }
      fun remove(command: Int): Builder { commands.remove(command); return this }
      fun build() = Commands(commands.toSet())
    }
  }
  companion object {
    const val COMMAND_SEEK_TO_NEXT = 1
    const val COMMAND_SEEK_TO_NEXT_MEDIA_ITEM = 2
    const val COMMAND_SEEK_TO_PREVIOUS = 3
    const val COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM = 4
    const val COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM = 5
  }
}
open class ForwardingPlayer(private val delegate: Player): Player {
  override fun getAvailableCommands() = delegate.getAvailableCommands()
  override fun isCommandAvailable(command: Int) = delegate.isCommandAvailable(command)
}
class AudioPlayer(val ref: Player, val isLive: Boolean) {
  val sessionPositionOffsetMs = 7000L
  fun emitRemoteSeek(positionMs: Long) {}
}
class AudioLockScreenOptions(val isLiveStream: Boolean?)
fun playerForMediaSession(ref: Player, offset: () -> Long, seek: (Long) -> Unit): Player {
  check(offset() == 7000L); return ref
}
