fun main() {
  val seek = Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM
  val base = object: Player {
    override fun getAvailableCommands() = Player.Commands.Builder().add(seek).add(99).build()
    override fun isCommandAvailable(command: Int) = getAvailableCommands().contains(command)
  }
  val service = ActualService()
  for (live in listOf(false, true)) {
    val result = service.resolveSessionPlayer(AudioPlayer(base, live), null)
    for (command in listOf(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM, Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)) {
      check(result.getAvailableCommands().contains(command))
      check(result.isCommandAvailable(command))
    }
    check(result.isCommandAvailable(seek) == !live)
    check(result.isCommandAvailable(99))
    check(!result.isCommandAvailable(999))
  }
  // Explicit lockscreen metadata overrides a native stream's live inference.
  check(service.resolveSessionPlayer(AudioPlayer(base, true), AudioLockScreenOptions(false)).isCommandAvailable(seek))
  check(!service.resolveSessionPlayer(AudioPlayer(base, false), AudioLockScreenOptions(true)).isCommandAvailable(seek))
  println("Actual resolveSessionPlayer: 4 scenarios passed; Next/Previous, seek and command consistency preserved")
}
