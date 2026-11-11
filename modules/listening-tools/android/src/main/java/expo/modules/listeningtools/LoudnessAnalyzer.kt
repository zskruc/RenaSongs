package expo.modules.listeningtools

import kotlin.math.*

/** Independent streaming BS.1770 K-weighting / R128 gated integrated loudness.
 * Only mono/stereo are accepted: guessing an unknown surround/LFE layout is
 * less safe than leaving its existing ReplayGain unchanged. Peak is SAMPLE
 * peak, explicitly not oversampled true peak. No PCM is retained. */
class LoudnessAnalyzer(val sampleRate: Int, val channels: Int) {
  private class Filter(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double) {
    private var z1 = 0.0; private var z2 = 0.0
    fun apply(x: Double): Double {
      val y = b0 * x + z1
      z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y
      return y
    }
  }
  private val hop = (sampleRate / 10.0).roundToInt()
  private val shelves: Array<Filter>
  private val passes: Array<Filter>
  private val recent = DoubleArray(4)
  private var recentCount = 0
  private var head = 0
  private var hopFrames = 0
  private var hopEnergy = 0.0
  private val energies = ArrayList<Double>()
  var frames = 0L; private set
  var samplePeak = 0.0; private set
  init {
    require(sampleRate in 8000..384000 && channels in 1..2) { "Unsupported PCM format" }
    // Bilinear-transformed BS.1770 pre-filter coefficients for this sample
    // rate; using the published 48k coefficients at44.1/96k is incorrect.
    val k = tan(PI * 1681.974450955533 / sampleRate)
    val q = 0.7071752369554196
    val vh = 10.0.pow(3.999843853973347 / 20)
    val vb = vh.pow(0.4996667741545416)
    val d = 1 + k / q + k * k
    shelves = Array(channels) { Filter((vh + vb * k / q + k * k) / d,
      2 * (k * k - vh) / d, (vh - vb * k / q + k * k) / d,
      2 * (k * k - 1) / d, (1 - k / q + k * k) / d) }
    val h = tan(PI * 38.13547087602444 / sampleRate)
    val hd = 1 + h / 0.5003270373238773 + h * h
    passes = Array(channels) { Filter(1.0, -2.0, 1.0,
      2 * (h * h - 1) / hd, (1 - h / 0.5003270373238773 + h * h) / hd) }
  }
  fun appendFrame(samples: DoubleArray) {
    require(samples.size == channels) { "Invalid PCM channel count" }
    require(frames < sampleRate.toLong() * 4 * 3600) { "Analysis frame budget exceeded" }
    var energy = 0.0
    for (channel in 0 until channels) {
      val sample = samples[channel]
      require(sample.isFinite() && abs(sample) <= 16) { "Invalid decoded sample" }
      samplePeak = max(samplePeak, abs(sample))
      val weighted = passes[channel].apply(shelves[channel].apply(sample))
      energy += weighted * weighted
    }
    hopEnergy += energy; hopFrames++; frames++
    if (hopFrames == hop) {
      recent[head] = hopEnergy; head = (head + 1) % 4; recentCount = min(4, recentCount + 1)
      if (recentCount == 4) {
        val block = recent.sum() / (hop * 4.0)
        if (block >= ABSOLUTE_GATE) energies.add(block)
      }
      hopFrames = 0; hopEnergy = 0.0
    }
  }
  fun result(): Map<String, Any?> {
    require(frames >= hop * 4L) { "Audio is too short to measure" }
    val relative = if (energies.isEmpty()) Double.POSITIVE_INFINITY else energies.sum() / energies.size / 10
    var total = 0.0; var count = 0
    for (energy in energies) if (energy >= relative) { total += energy; count++ }
    val lufs = if (count == 0) null else -0.691 + 10 * log10(total / count)
    return mapOf("integratedLufs" to lufs, "samplePeak" to samplePeak, "blockEnergies" to energies.toList(),
      "durationSec" to frames.toDouble() / sampleRate, "sampleRate" to sampleRate,
      "channels" to channels, "frames" to frames.toDouble(), "complete" to true, "algorithm" to "bs1770-r128-v1")
  }
  companion object { private val ABSOLUTE_GATE = 10.0.pow((-70 + 0.691) / 10) }
}
