package expo.modules.listeningtools
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max

/** Shared local-decoder boundary handling; no PCM or timestamp can escape the
 * requested physical range. Complete output is checked before publishing. */
abstract class WindowedPcmSink(private val beginUs: Long, private val endUs: Long) {
  private var rate = 0
  private var channels = 0
  private var frame = DoubleArray(0)
  private var frames = 0L
  private var firstUs: Long? = null
  var lastUs = 0L; private set
  protected abstract fun format(sampleRate: Int, channelCount: Int)
  protected abstract fun frame(samples: DoubleArray)
  fun append(buffer: ByteBuffer, encoding: Int, sampleRate: Int, channelCount: Int, presentationUs: Long) {
    if (rate == 0) {
      require(sampleRate in 8000..384000 && channelCount in 1..2) { "Unsupported PCM format" }
      rate = sampleRate; channels = channelCount; frame = DoubleArray(channels); format(rate, channels)
    }
    require(rate == sampleRate && channels == channelCount) { "PCM format changed during analysis" }
    val bytes = when (encoding) { 2 -> 2; 3 -> 1; 4, 0x30000000 -> 4; 0x20000000 -> 3; else -> error("Unsupported PCM encoding") }
    val input = buffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    require(input.remaining() % (bytes * channels) == 0) { "Incomplete PCM frame" }
    val count = input.remaining() / (bytes * channels)
    for (index in 0 until count) {
      val time = presentationUs + index * 1_000_000L / rate
      if (time >= endUs) break
      for (channel in 0 until channels) frame[channel] = when (encoding) {
        2 -> input.short / 32768.0
        3 -> ((input.get().toInt() and 255) - 128) / 128.0
        4 -> input.float.toDouble()
        0x30000000 -> input.int / 2147483648.0
        else -> {
          val packed = (input.get().toInt() and 255) or ((input.get().toInt() and 255) shl 8) or (input.get().toInt() shl 16)
          packed / 8388608.0
        }
      }
      if (time >= beginUs) {
        require(frame.all { it.isFinite() && kotlin.math.abs(it) <= 16 }) { "Invalid decoded sample" }
        if (firstUs == null) firstUs = time
        lastUs = max(lastUs, time + 1_000_000L / rate); frames++
        frame(frame)
      }
    }
  }
  protected fun validateComplete() {
    require(firstUs?.let { it <= beginUs + 100_000L } == true && lastUs >= endUs - 150_000L) { "Incomplete audio analysis" }
    require(frames.toDouble() / rate >= (endUs - beginUs) / 1_000_000.0 - 0.15) { "Missing audio samples" }
  }
}
