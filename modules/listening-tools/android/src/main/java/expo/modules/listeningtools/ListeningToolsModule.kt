package expo.modules.listeningtools

import android.content.Context
import android.content.res.AssetFileDescriptor
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.os.Process
import android.system.Os
import android.system.OsConstants
import androidx.media3.decoder.ffmpeg.AlacPcmInspector
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.silencetrim.LocalAudioData
import expo.modules.silencetrim.Mp4AlacSource
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlin.math.min

/** Local-only, explicit analysis. One worker; never shares a live decoder,
 * opens a network source, writes PCM, or returns a partial measurement. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class ListeningToolsModule : Module() {
  private class Ticket(val id: String) { @Volatile var cancelled = false }
  private val active = AtomicReference<Ticket?>()
  private val executor = Executors.newSingleThreadExecutor { task ->
    Thread({ Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND); task.run() }, "ResonusLoudness")
  }
  private val dispatcher = executor.asCoroutineDispatcher()
  override fun definition() = ModuleDefinition {
    Name("ResonusListeningTools")
    Function("cancelLoudness") { id: String -> active.get()?.takeIf { it.id == id }?.cancelled = true }
    Function("releaseAlignmentAudio") { text: String ->
      val context = appContext.reactContext?.applicationContext
      if (context != null) releaseAlignment(context, text)
    }
    AsyncFunction("prepareAlignmentAudio") Coroutine { id: String, text: String, startSec: Double?, endSec: Double? ->
      require(id.isNotEmpty() && id.length <= 200) { "Invalid preparation request" }
      val context = appContext.reactContext?.applicationContext ?: error("Preparation context unavailable")
      val ticket = Ticket(id)
      active.getAndSet(ticket)?.cancelled = true
      try {
        withContext(dispatcher) {
          val deadline = System.nanoTime() + 120_000_000_000L
          val current = { active.get() === ticket && !ticket.cancelled && !Thread.currentThread().isInterrupted && System.nanoTime() <= deadline }
          ensureCurrent(current)
          val start = startSec ?: 0.0
          require(start.isFinite() && start >= 0 && (endSec == null || endSec.isFinite() && endSec > start)) { "Invalid preparation range" }
          val directory = File(context.cacheDir, "alignment-audio").apply { mkdirs() }
          directory.listFiles()?.filter { it.isFile && it.name.matches(Regex("alignment-[0-9a-f-]+\\.wav")) && it.lastModified() < System.currentTimeMillis() - 3600000L }?.forEach { it.delete() }
          val temporary = File(directory, "alignment-${UUID.randomUUID()}.wav")
          var published = false
          try {
            openLocal(context, text).use { source ->
              val before = Os.fstat(source.fileDescriptor)
              val metadata = runCatching { metadata(source) }.getOrNull()
              val indexed = if (metadata == null || metadata.second.getString(MediaFormat.KEY_MIME) in listOf("audio/unknown", "audio/alac")) indexedAlac(source, current) else null
              indexed.use { alac ->
                val durationUs = alac?.reader?.durationUs ?: metadata?.second?.getLong(MediaFormat.KEY_DURATION) ?: error("Unsupported local audio")
                val beginUs = (start * 1000000).toLong()
                val requestedEnd = endSec?.let { (it * 1000000).toLong() } ?: durationUs
                require(requestedEnd <= durationUs + 100000L) { "Preparation exceeds the local file" }
                val endUs = min(requestedEnd, durationUs)
                require(beginUs >= 0 && endUs - beginUs in 400000L..600000000L) { "Select at most600seconds for alignment" }
                AlignmentWavSink(temporary, beginUs, endUs, current).use { sink ->
                  if (alac != null) decodeAlac(alac.reader, beginUs, endUs, sink, current)
                  else decode(source, metadata!!, beginUs, endUs, sink, current)
                  ensureCurrent(current)
                  val after = Os.fstat(source.fileDescriptor)
                  require(before.st_size == after.st_size && before.st_mtime == after.st_mtime) { "Audio changed during preparation" }
                  val seconds = sink.finish()
                  ensureCurrent(current); published = true
                  mapOf("uri" to Uri.fromFile(temporary).toString(), "mime" to "audio/wav", "bytes" to temporary.length().toDouble(),
                    "durationSec" to seconds, "physicalStartSec" to beginUs / 1000000.0, "sampleRate" to 16000, "channels" to 1, "temporary" to true)
                }
              }
            }
          } finally { if (!published) temporary.delete() }
        }
      } finally { active.compareAndSet(ticket, null) }
    }
    OnDestroy { active.getAndSet(null)?.cancelled = true; dispatcher.close(); executor.shutdownNow() }
    AsyncFunction("analyzeLoudness") Coroutine { id: String, text: String, startSec: Double?, endSec: Double? ->
      require(id.isNotEmpty() && id.length <= 200) { "Invalid analysis request" }
      val context = appContext.reactContext?.applicationContext ?: error("Analysis context unavailable")
      val ticket = Ticket(id)
      active.getAndSet(ticket)?.cancelled = true
      try {
        withContext(dispatcher) {
          val deadline = System.nanoTime() + 120_000_000_000L
          val current = { active.get() === ticket && !ticket.cancelled && !Thread.currentThread().isInterrupted && System.nanoTime() <= deadline }
          ensureCurrent(current)
          val start = startSec ?: 0.0
          require(start.isFinite() && start >= 0 && (endSec == null || endSec.isFinite() && endSec > start)) { "Invalid analysis range" }
          openLocal(context, text).use { source ->
            ensureCurrent(current)
            val before = Os.fstat(source.fileDescriptor)
            val metadata = runCatching { metadata(source) }.getOrNull()
            val indexed = if (metadata == null || metadata.second.getString(MediaFormat.KEY_MIME) in listOf("audio/unknown", "audio/alac")) indexedAlac(source, current) else null
            indexed.use { alac ->
              val durationUs = alac?.reader?.durationUs ?: metadata?.second?.getLong(MediaFormat.KEY_DURATION) ?: error("Unsupported local audio")
              val beginUs = (start * 1_000_000).toLong()
              val endUs = endSec?.let { (it * 1_000_000).toLong() } ?: durationUs
              require(durationUs > 0 && endUs <= durationUs + 100_000L && endUs - beginUs in 400_000L..14_400_000_000L) { "Unsupported audio duration" }
              val boundedEnd = min(endUs, durationUs)
              val sink = LoudnessPcmSink(beginUs, boundedEnd)
              if (alac != null) decodeAlac(alac.reader, beginUs, boundedEnd, sink, current)
              else decode(source, metadata!!, beginUs, boundedEnd, sink, current)
              ensureCurrent(current)
              val after = Os.fstat(source.fileDescriptor)
              require(before.st_size == after.st_size && before.st_mtime == after.st_mtime && before.st_ino == after.st_ino) { "Audio changed during analysis" }
              sink.result().toMutableMap().also {
                it["fileSize"] = before.st_size.toDouble()
                it["modifiedMs"] = before.st_mtime * 1000.0
              }
            }
          }
        }
      } finally { active.compareAndSet(ticket, null) }
    }
  }
  private fun releaseAlignment(context: Context, text: String) {
    val uri = Uri.parse(text)
    if (uri.scheme != "file" || !uri.host.isNullOrEmpty()) return
    val directory = File(context.cacheDir, "alignment-audio").canonicalFile
    val file = File(uri.path ?: return).canonicalFile
    if (file.parentFile == directory && file.name.matches(Regex("alignment-[0-9a-f-]+\\.wav"))) file.delete()
  }
  private fun openLocal(context: Context, text: String): AssetFileDescriptor {
    val uri = Uri.parse(text)
    val descriptor = if (uri.scheme == "file" && uri.host.isNullOrEmpty()) {
      val file = File(uri.path ?: error("Invalid local file"))
      require(file.isFile && file.length() in 1..MAX_BYTES) { "Unsupported local file size" }
      AssetFileDescriptor(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY), 0, file.length())
    } else {
      require(uri.scheme == "content" && uri.authority in setOf("media", "com.android.providers.media.documents", "com.android.externalstorage.documents")) { "Only local audio can be analyzed" }
      context.contentResolver.openAssetFileDescriptor(uri, "r") ?: error("Local audio unavailable")
    }
    try {
      Os.lseek(descriptor.fileDescriptor, 0L, OsConstants.SEEK_CUR)
      val length = if (descriptor.declaredLength > 0) descriptor.declaredLength else Os.fstat(descriptor.fileDescriptor).st_size
      require(length in 1..MAX_BYTES) { "Unsupported local file size" }
      return descriptor
    } catch (error: Exception) { descriptor.close(); throw error }
  }
  private fun extractor(source: AssetFileDescriptor): MediaExtractor = MediaExtractor().also {
    try {
      if (source.declaredLength >= 0) it.setDataSource(source.fileDescriptor, source.startOffset, source.declaredLength)
      else it.setDataSource(source.fileDescriptor)
    } catch (error: Exception) { it.release(); throw error }
  }
  private fun metadata(source: AssetFileDescriptor): Pair<Int, MediaFormat>? {
    val reader = extractor(source)
    try {
      for (track in 0 until reader.trackCount) {
        val format = reader.getTrackFormat(track)
        if (format.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true && format.containsKey(MediaFormat.KEY_DURATION)) return track to format
      }
      return null
    } finally { reader.release() }
  }
  private class Indexed(val reader: Mp4AlacSource, val stream: ParcelFileDescriptor.AutoCloseInputStream) : AutoCloseable {
    override fun close() { try { reader.close() } finally { stream.close() } }
  }
  private fun indexedAlac(source: AssetFileDescriptor, current: () -> Boolean): Indexed? {
    val stream = ParcelFileDescriptor.AutoCloseInputStream(ParcelFileDescriptor.dup(source.fileDescriptor))
    try {
      val data = object : LocalAudioData {
        override val length = if (source.declaredLength > 0) source.declaredLength else Os.fstat(source.fileDescriptor).st_size
        override fun readAt(position: Long, bytes: ByteArray, offset: Int, length: Int): Int =
          stream.channel.read(ByteBuffer.wrap(bytes, offset, length), source.startOffset + position)
      }
      val reader = Mp4AlacSource.openBounded(data, MAX_BYTES, 120000L, current)
      if (reader == null) { stream.close(); return null }
      return Indexed(reader, stream)
    } catch (error: Exception) { stream.close(); throw error }
  }
  private fun decodeAlac(reader: Mp4AlacSource, startUs: Long, endUs: Long, sink: WindowedPcmSink, current: () -> Boolean) {
    val format = reader.format
    AlacPcmInspector(format.sampleRate, format.channelCount, format.initializationData[0]).use { decoder ->
      reader.readWindow(startUs, endUs) { packet, time ->
        ensureCurrent(current)
        val pcm = decoder.decode(ByteBuffer.wrap(packet), time) ?: error("ALAC decoding failed")
        sink.append(pcm, decoder.encoding(), decoder.sampleRate(), decoder.channelCount(), time)
        sink.lastUs >= endUs
      }
    }
  }
  private fun decode(source: AssetFileDescriptor, metadata: Pair<Int, MediaFormat>, startUs: Long, endUs: Long,
                     sink: WindowedPcmSink, current: () -> Boolean) {
    val reader = extractor(source)
    var codec: MediaCodec? = null
    var started = false
    try {
      reader.selectTrack(metadata.first); reader.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val format = metadata.second
      codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME) ?: error("Unknown codec"))
      codec.configure(format, null, null, 0); codec.start(); started = true
      var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var encoding = AudioFormat.ENCODING_PCM_16BIT
      var inputDone = false; var outputDone = false; var inputBytes = 0L
      val info = MediaCodec.BufferInfo()
      while (!outputDone) {
        ensureCurrent(current)
        require(inputBytes <= MAX_BYTES) { "Audio input budget exceeded" }
        if (!inputDone) {
          val index = codec.dequeueInputBuffer(10000)
          if (index >= 0) {
            val input = codec.getInputBuffer(index) ?: error("Decoder input unavailable")
            input.clear()
            val size = if (reader.sampleTime > endUs + 250000L) -1 else reader.readSampleData(input, 0)
            if (size < 0) { codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
            else { inputBytes += size; codec.queueInputBuffer(index, 0, size, reader.sampleTime, 0); reader.advance() }
          }
        }
        when (val index = codec.dequeueOutputBuffer(info, 10000)) {
          MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val output = codec.outputFormat
            rate = output.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = output.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            encoding = if (output.containsKey(MediaFormat.KEY_PCM_ENCODING)) output.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
          }
          MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
          else -> if (index >= 0) {
            try {
              if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                val output = codec.getOutputBuffer(index) ?: error("Decoder output unavailable")
                output.position(info.offset); output.limit(info.offset + info.size)
                sink.append(output.slice(), encoding, rate, channels, info.presentationTimeUs)
                outputDone = sink.lastUs >= endUs - 1000
              }
              if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
            } finally { codec.releaseOutputBuffer(index, false) }
          }
        }
      }
    } finally {
      if (started) runCatching { codec?.stop() }
      runCatching { codec?.release() }; reader.release()
    }
  }
  private fun ensureCurrent(current: () -> Boolean) { if (!current()) throw CancellationException("Analysis cancelled or budget exhausted") }
  companion object { private const val MAX_BYTES = 1024L * 1024 * 1024 }
}
