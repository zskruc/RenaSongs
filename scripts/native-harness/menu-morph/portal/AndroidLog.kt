package android.util
object Log {
  const val DEBUG = 3
  var legacy = false
  var reads = 0
  fun isLoggable(tag: String, level: Int): Boolean { check(tag == "ResonusGlassLegacyForeground" && level == DEBUG); reads++; return legacy }
}
