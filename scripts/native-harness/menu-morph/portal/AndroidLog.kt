package android.util
object Log {
  const val DEBUG = 3
  var legacy = false
  var reads = 0
  var motionRows = false
  var motionClip = false
  var motionBudget = false
  var earlyReads = 0
  fun isLoggable(tag: String, level: Int): Boolean {
    check(level == DEBUG)
    return when (tag) {
      "ResonusGlassLegacyForeground" -> { reads++; legacy }
      "ResonusGlassMotionRows" -> { earlyReads++; motionRows }
      "ResonusGlassMotionClip" -> { earlyReads++; motionClip }
      "ResonusGlassMotionBudget" -> { earlyReads++; motionBudget }
      else -> error("Unexpected tag: $tag")
    }
  }
}
