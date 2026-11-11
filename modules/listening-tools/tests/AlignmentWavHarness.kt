package expo.modules.listeningtools
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

fun main(args: Array<String>) {
  val folder = File(args[0]).apply { mkdirs() }
  var checks = 0
  fun verified(name: String, block: () -> Unit) { block(); checks++; println("PASS $name") }
  fun input(rate: Int, channels: Int, seconds: Int, frequency: Double=1000.0): ByteArray {
    val b=ByteBuffer.allocate(rate*channels*2*seconds).order(ByteOrder.LITTLE_ENDIAN)
    repeat(rate*seconds) { frame -> repeat(channels) { b.putShort((sin(2*PI*frequency*frame/rate)*3276).toInt().toShort()) } }
    return b.array()
  }
  fun prepare(rate: Int, channels: Int, chunk: Int, file: File, tone: Double=1000.0): Pair<ByteArray,Double> {
    val source=input(rate,channels,2,tone)
    var seconds=0.0
    AlignmentWavSink(file,0,2000000) { true }.use { sink ->
      var frame=0
      while(frame<rate*2) {
        val count=min(chunk,rate*2-frame)
        sink.append(ByteBuffer.wrap(source,frame*channels*2,count*channels*2),2,rate,channels,frame*1000000L/rate)
        frame+=count
      }
      seconds=sink.finish()
    }
    return file.readBytes() to seconds
  }
  verified("actual Media3 resampler produces16k mono PCM16 WAV at8/16/44.1/48/96k") {
    for(rate in listOf(8000,16000,44100,48000,96000)) for(channels in listOf(1,2)) {
      val (bytes,duration)=prepare(rate,channels,1024,File(folder,"$rate-$channels.wav"))
      val header=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      check(String(bytes,0,4)=="RIFF" && String(bytes,8,4)=="WAVE")
      check(header.getInt(24)==16000 && header.getShort(22)==1.toShort() && header.getShort(34)==16.toShort())
      check(header.getInt(40)==bytes.size-44)
      check(abs(duration-2.0)<0.0002) { "$rate/$channels: $duration" }
      check(bytes.size<64060)
    }
  }
  verified("chunk boundaries do not change resampled PCM bytes or time origin") {
    val a=prepare(44100,2,357,File(folder,"small.wav")).first
    val b=prepare(44100,2,44100,File(folder,"large.wav")).first
    check(a.contentEquals(b))
  }
  verified("requested physical clip has no leading pre-clip audio and exact relative duration") {
    val source=input(48000,2,2)
    val f=File(folder,"clip.wav")
    AlignmentWavSink(f,500000,1500000) { true }.use { sink ->
      sink.append(ByteBuffer.wrap(source),2,48000,2,0)
      check(abs(sink.finish()-1)<0.0001)
    }
    check(f.length()==32044L)
  }
  verified("missing tail cannot publish WAV and cancellation aborts before more bytes") {
    val f=File(folder,"bad.wav")
    var current=true;var rejected=false
    AlignmentWavSink(f,0,2000000) { current }.use { sink ->
      sink.append(ByteBuffer.wrap(input(48000,1,1)),2,48000,1,0)
      try { sink.finish() } catch(_:IllegalArgumentException) { rejected=true };check(rejected)
      current=false
      rejected=false;try { sink.append(ByteBuffer.wrap(input(48000,1,1)),2,48000,1,1000000) } catch(_:IllegalStateException) {rejected=true};check(rejected)
    }
  }
  verified("out-of-band input is attenuated by the real resampler, not naively decimated") {
    val bytes=prepare(48000,1,1024,File(folder,"high.wav"),12000.0).first
    val b=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);b.position(44)
    var sum=0.0;var n=0
    while(b.hasRemaining()) {val s=b.short.toDouble();sum+=s*s;n++}
    check(sqrt(sum/n)<500.0) { "Unexpected alias RMS ${sqrt(sum/n)}" }
  }
  println("$checks actual Media3/WAV checks passed")
}
