package expo.modules.listeningtools
import expo.modules.audio.NativeABRepeat
import expo.modules.audio.PlaybackBoundary
import expo.modules.audio.PlaybackWindow
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.io.File
import kotlin.math.*

fun main(args: Array<String>) {
  var checks = 0
  fun verify(name: String, body: () -> Unit) { body(); checks++; println("PASS $name") }
  fun fails(body: () -> Unit) { var failed = false; try { body() } catch (_: IllegalArgumentException) { failed = true }; check(failed) }
  data class Scheduled(val at: Long, val call: () -> Unit, var cancelled: Boolean = false)
  val scheduled = mutableListOf<Scheduled>(); val seeks = mutableListOf<Long>()
  lateinit var ab: NativeABRepeat
  ab = NativeABRepeat({ at, call -> val job = Scheduled(at, call); scheduled += job; PlaybackBoundary { job.cancelled = true } },
    { at -> seeks += at; ab.onSeek(at) }, {})
  verify("off has no work and validates finite bounded physical windows") {
    check(scheduled.isEmpty()); check(PlaybackWindow.create(null, null) == null)
    check(PlaybackWindow.create(120.0, 180.0) == PlaybackWindow(120000,180000))
    fails { PlaybackWindow.create(Double.NaN, 2.0) }; fails { PlaybackWindow.create(-1.0, 5.0) }
    fails { PlaybackWindow.create(4.0, 3.0) }; fails { PlaybackWindow.create(0.0, 86401.0) }
  }
  verify("A-B rejects missing endpoints, short range and past track end") {
    fails { ab.set(null, 3.0,10000) }; fails { ab.set(2.0, 2.5,10000) }; fails { ab.set(2.0, 15.0,10000) }
    check(scheduled.isEmpty())
  }
  verify("native media boundary loops and schedules exactly one replacement") {
    ab.set(2.0,5.0,10000); check(scheduled.last().at == 5000L)
    scheduled.last().call(); check(seeks == listOf(2000L))
    check(scheduled.count { !it.cancelled } == 2) // delivered message + exactly one new message
  }
  verify("old callbacks after range change cannot seek the new source") {
    val old = scheduled.last(); ab.set(3.0,7.0,10000); val count = seeks.size
    old.call(); check(seeks.size == count); check(old.cancelled)
  }
  verify("outside manual seek clears loop; late delivery is inert") {
    val old = scheduled.last(); ab.onSeek(9000); check(ab.window == null)
    val count = seeks.size; old.call(); check(seeks.size == count)
  }
  verify("clear and account/source ABA cannot revive former loop") {
    ab.set(2.0,5.0,10000); val old = scheduled.last(); ab.clear(); ab.set(2.0,5.0,10000)
    val count=seeks.size; old.call(); check(seeks.size==count); check(ab.window!=null)
    ab.clear(); check(scheduled.last().cancelled)
  }
  fun tone(rate: Int, channels: Int, amplitude: Double, seconds: Double, frequency: Double=1000.0): Map<String,Any?> {
    val analyzer = LoudnessAnalyzer(rate, channels); val frame=DoubleArray(channels)
    repeat((rate*seconds).toInt()) { i -> frame.fill(amplitude*sin(2*PI*frequency*i/rate)); analyzer.appendFrame(frame) }
    return analyzer.result()
  }
  verify("1kHz stereo -20dBFS sine measures standard -20LUFS and sample peak") {
    val r=tone(48000,2,0.1,3.0)
    check(abs((r["integratedLufs"] as Double)+20)<0.08) { r.toString() }
    check(abs((r["samplePeak"] as Double)-0.1)<0.00001)
  }
  verify("sample rate transformed coefficients agree44.1/48/96k within0.1LU") {
    val results=listOf(44100,48000,96000).map { tone(it,2,0.1,1.0)["integratedLufs"] as Double }
    check(results.max()-results.min()<0.1) { results.toString() }
  }
  verify("mono/stereo weighting differs3LU; amplitude scaling remains6LU") {
    val mono=tone(48000,1,0.1,1.0)["integratedLufs"] as Double
    val stereo=tone(48000,2,0.1,1.0)["integratedLufs"] as Double
    check(abs(stereo-mono-10*log10(2.0))<0.001)
    val twice=tone(48000,2,0.2,1.0)["integratedLufs"] as Double
    check(abs(twice-stereo-20*log10(2.0))<0.001)
  }
  verify("absolute-gated blocks can be regrouped into correct album loudness") {
    val a=tone(48000,2,0.1,1.0); val b=tone(48000,2,0.2,1.0)
    val blocks=(a["blockEnergies"] as List<*>)+(b["blockEnergies"] as List<*>)
    check(blocks.size==14)
    val energy=blocks.map { it as Double }.average()
    val album = -0.691+10*log10(energy)
    check(abs(album+16.021)<0.1)
    check((tone(48000,2,0.0,1.0)["blockEnergies"] as List<*>).isEmpty())
  }
  verify("silence is nullLUFS, unknown surround and invalid samples reject") {
    check(tone(48000,2,0.0,1.0)["integratedLufs"]==null)
    fails { LoudnessAnalyzer(48000,6) }; fails { LoudnessAnalyzer(10,2) }
    fails { LoudnessAnalyzer(48000,1).appendFrame(doubleArrayOf(Double.NaN)) }
  }
  verify("relative gate excludes very quiet programme tail") {
    val a=LoudnessAnalyzer(48000,2); val frame=DoubleArray(2)
    repeat(48000*8) { i -> frame.fill((if(i<48000*3)0.1 else 0.00001)*sin(2*PI*1000*i/48000));a.appendFrame(frame) }
    check(abs((a.result()["integratedLufs"] as Double)+20)<0.3)
  }
  verify("actual PCM sink clips physical region, keeps its relative measured duration") {
    val buffer=ByteBuffer.allocate(48000*2*2*2).order(ByteOrder.LITTLE_ENDIAN)
    repeat(48000*2) { i -> repeat(2) { buffer.putShort((3276*sin(2*PI*1000*i/48000)).toInt().toShort()) } };buffer.flip()
    val sink=LoudnessPcmSink(500000,1500000);sink.append(buffer,2,48000,2,0)
    check(abs(sink.result()["durationSec"] as Double-1.0)<0.001)
  }
  verify("truncated/gapped PCM never returns a partial successful measurement") {
    val sink=LoudnessPcmSink(0,1000000)
    sink.append(ByteBuffer.allocate(48000),2,48000,1,0)
    fails { sink.result() }
    val gap=LoudnessPcmSink(0,2000000)
    gap.append(ByteBuffer.allocate(48000),2,48000,1,0)
    gap.append(ByteBuffer.allocate(48000),2,48000,1,1500000)
    fails { gap.result() }
  }
  verify("all supported PCM formats agree on negative full-scale samples") {
    for (encoding in listOf(2,3,4,0x20000000,0x30000000)) {
      val bytes=when(encoding){2->2;3->1;0x20000000->3;else->4}
      val buffer=ByteBuffer.allocate(48000*bytes).order(ByteOrder.LITTLE_ENDIAN)
      repeat(48000) { when(encoding) {
        2->buffer.putShort(Short.MIN_VALUE);3->buffer.put(0);4->buffer.putFloat(-1f)
        0x20000000->{buffer.put(0);buffer.put(0);buffer.put(0x80.toByte())};else->buffer.putInt(Int.MIN_VALUE)
      } };buffer.flip();val sink=LoudnessPcmSink(0,1000000);sink.append(buffer,encoding,48000,1,0)
      check(sink.result()["samplePeak"]==1.0)
    }
  }
  if(args.isNotEmpty()) verify("reference ffmpeg R128 fixture agrees integrated loudness") {
    val bytes=File(args[0]).readBytes();val sink=LoudnessPcmSink(0,3000000)
    sink.append(ByteBuffer.wrap(bytes),2,48000,2,0)
    val expected=File(args[1]).readText().trim().toDouble()
    check(abs((sink.result()["integratedLufs"] as Double)-expected)<0.12) { sink.result().toString()+" vs "+expected }
  }
  println("$checks production checks passed")
}
