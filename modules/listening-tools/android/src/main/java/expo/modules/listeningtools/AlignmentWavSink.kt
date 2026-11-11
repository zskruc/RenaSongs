package expo.modules.listeningtools

import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SonicAudioProcessor
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

/** Media3's existing Sonic resampler preserves speed/pitch while changing
 * sample rate. PCM WAV avoids codec priming and is <19.21MB at600seconds. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class AlignmentWavSink(private val file: File, beginUs: Long, endUs: Long, private val current: () -> Boolean) :
  WindowedPcmSink(beginUs, endUs), AutoCloseable {
  private val output = RandomAccessFile(file, "rw").apply { setLength(0); write(ByteArray(44)) }
  private class LowPass(rate: Int, q: Double) {
    private val w = 2 * PI * 6500 / rate
    private val alpha = sin(w) / (2 * q)
    private val b0 = (1 - cos(w)) / (2 * (1 + alpha))
    private val b1 = 2 * b0
    private val a1 = -2 * cos(w) / (1 + alpha)
    private val a2 = (1 - alpha) / (1 + alpha)
    private var z1 = 0.0; private var z2 = 0.0
    fun apply(value: Double): Double {
      val result = b0 * value + z1
      z1 = b1 * value - a1 * result + z2; z2 = b0 * value - a2 * result
      return result
    }
  }
  private var filters = emptyArray<LowPass>()
  private var processor: SonicAudioProcessor? = null
  private val input = ByteBuffer.allocateDirect(4096).order(ByteOrder.nativeOrder())
  private val scratch = ByteArray(8192)
  private var bytes = 0L
  private var finished = false
  override fun format(sampleRate: Int, channelCount: Int) {
    // Sonic preserves playback duration but its rate conversion alone does
    // not remove all aliases. An8th-order6.5kHz Butterworth low-pass precedes
    // downsampling; no cut is needed when retaining/upsampling8/16k input.
    if (sampleRate > OUTPUT_RATE) filters = doubleArrayOf(0.5097955791041592, 0.6013448869350453,
      0.8999762231364156, 2.5629154477415064).map { LowPass(sampleRate, it) }.toTypedArray()
    if (sampleRate != OUTPUT_RATE) {
      processor = SonicAudioProcessor().also {
        it.setOutputSampleRateHz(OUTPUT_RATE)
        it.configure(AudioProcessor.AudioFormat(sampleRate, 1, 2))
        it.flush(AudioProcessor.StreamMetadata.DEFAULT)
      }
    }
  }
  override fun frame(samples: DoubleArray) {
    check(!finished && current()) { "Audio preparation cancelled" }
    var mono = samples.sum() / samples.size
    for (filter in filters) mono = filter.apply(mono)
    input.putShort((mono.coerceIn(-1.0, 32767.0 / 32768) * 32768).roundToInt().toShort())
    if (!input.hasRemaining()) flushInput()
  }
  private fun flushInput() {
    check(current()) { "Audio preparation cancelled" }
    input.flip()
    val sonic = processor
    if (sonic == null) write(input) else { sonic.queueInput(input); write(sonic.output) }
    input.clear()
  }
  private fun write(buffer: ByteBuffer) {
    require(bytes + buffer.remaining() <= MAX_PCM_BYTES) { "Prepared audio exceeds600seconds" }
    while (buffer.hasRemaining()) {
      val size = minOf(buffer.remaining(), scratch.size)
      buffer.get(scratch, 0, size); output.write(scratch, 0, size); bytes += size
    }
  }
  fun finish(): Double {
    validateComplete(); check(!finished && current()) { "Audio preparation cancelled" }
    flushInput()
    processor?.let { sonic ->
      sonic.queueEndOfStream()
      var drains = 0
      while (!sonic.isEnded) { check(++drains <= 16 && current()); write(sonic.output) }
    }
    require(bytes >= 2 * OUTPUT_RATE * 0.4 && bytes % 2L == 0L) { "No complete prepared audio" }
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray()).putInt((36 + bytes).toInt()).put("WAVEfmt ".toByteArray())
      .putInt(16).putShort(1).putShort(1).putInt(OUTPUT_RATE).putInt(OUTPUT_RATE * 2)
      .putShort(2).putShort(16).put("data".toByteArray()).putInt(bytes.toInt())
    output.seek(0); output.write(header.array()); output.fd.sync(); finished = true
    return bytes / (OUTPUT_RATE * 2.0)
  }
  override fun close() { try { processor?.reset() } finally { output.close() } }
  companion object {
    const val OUTPUT_RATE = 16000
    const val MAX_PCM_BYTES = 600L * OUTPUT_RATE * 2
  }
}
