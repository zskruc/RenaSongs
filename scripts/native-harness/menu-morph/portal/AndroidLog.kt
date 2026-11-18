package android.util
object Log {
  const val DEBUG = 3
  var legacy = false
  var reads = 0
  var legacyEarly = false
  var earlyReads = 0
  fun isLoggable(tag: String, level: Int): Boolean {
    check(level == DEBUG)
    return when (tag) {
      "ResonusGlassLegacyForeground" -> { reads++; legacy }
      "ResonusGlassLegacyEarlyFrames" -> { earlyReads++; legacyEarly }
      else -> error("Unexpected tag: $tag")
    }
  }
}
