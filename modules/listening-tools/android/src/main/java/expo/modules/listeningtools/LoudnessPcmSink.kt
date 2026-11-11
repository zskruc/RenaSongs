package expo.modules.listeningtools

class LoudnessPcmSink(beginUs: Long, endUs: Long) : WindowedPcmSink(beginUs, endUs) {
  private var analyzer: LoudnessAnalyzer? = null
  override fun format(sampleRate: Int, channelCount: Int) { analyzer = LoudnessAnalyzer(sampleRate, channelCount) }
  override fun frame(samples: DoubleArray) { analyzer!!.appendFrame(samples) }
  fun result(): Map<String, Any?> { validateComplete(); return analyzer?.result() ?: error("No decoded samples") }
}
