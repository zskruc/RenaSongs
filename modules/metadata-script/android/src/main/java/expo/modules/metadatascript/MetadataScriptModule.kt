package expo.modules.metadatascript

import android.content.*
import android.os.*
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MetadataScriptModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private val lifecycle = ParserHostLifecycle()
  private var cancelActive: (() -> Unit)? = null
  override fun definition() = ModuleDefinition {
    Name("MetadataScript")
    AsyncFunction("decodeScraperLyrics") { base64: String, magicHex: String, xorKeyHex: String ->
      ScraperDataCodec.decodeLyrics(base64, magicHex, xorKeyHex)
    }
    AsyncFunction("decodeText") { base64: String, encoding: String ->
      require(base64.length <= 1_500_000) { "Text file is too large" }
      val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
      require(bytes.size <= 1024 * 1024) { "Text file is too large" }
      fun decode(charset: String): String = java.nio.charset.Charset.forName(charset).newDecoder()
        .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
        .decode(java.nio.ByteBuffer.wrap(bytes)).toString().removePrefix("\uFEFF")
      if (encoding != "auto") { require(encoding in setOf("UTF-8", "UTF-16LE", "UTF-16BE", "GB18030")); decode(encoding) }
      else if (bytes.size >= 2 && bytes[0] == 0xff.toByte() && bytes[1] == 0xfe.toByte()) decode("UTF-16LE")
      else if (bytes.size >= 2 && bytes[0] == 0xfe.toByte() && bytes[1] == 0xff.toByte()) decode("UTF-16BE")
      else try { decode("UTF-8") } catch (_: java.nio.charset.CharacterCodingException) { decode("GB18030") }
    }
    AsyncFunction("run") { script: String, response: String, variables: String, promise: Promise ->
      val accepted = lifecycle.submit {
      io.execute {
        var inFile: File? = null; var outFile: File? = null
        try {
          check(!lifecycle.closed) { "Source parser session ended" }
          require(script.length <= 200_000 && response.toByteArray().size <= 5 * 1024 * 1024 && variables.length <= 64_000) { "Source response or script is too large" }
          val context = appContext.reactContext?.applicationContext ?: throw IllegalStateException("Application unavailable")
          val input = File.createTempFile("source-parser-in-", ".json", context.cacheDir); inFile = input
          val output = File.createTempFile("source-parser-out-", ".json", context.cacheDir); outFile = output
          input.writeText(JSONObject().put("script", script).put("response", response).put("variables", variables).toString())
          main.post {
            if (lifecycle.closed) {
              io.execute { input.delete(); output.delete(); try { promise.reject("ERR_PARSER_CLOSED", "Source parser session ended", null) } finally { if (lifecycle.complete()) io.shutdown() } }
              return@post
            }
            val finished = AtomicBoolean(false)
            val intent = Intent(context, ScriptService::class.java)
            var bound = false
            lateinit var connection: ServiceConnection
            lateinit var timeout: Runnable
            fun finish(error: String?, result: String? = null) {
              if (!finished.compareAndSet(false, true)) return
              main.removeCallbacks(timeout); cancelActive = null
              if (bound) try { context.unbindService(connection) } catch (_: Exception) { }
              try { context.stopService(intent) } catch (_: Exception) { }
              io.execute {
                input.delete(); output.delete()
                try { if (error == null) promise.resolve(result ?: "null") else promise.reject("ERR_SOURCE_PARSER", error, null) }
                finally { if (lifecycle.complete()) io.shutdown() }
              }
            }
            val reply = Messenger(Handler(Looper.getMainLooper()) { message ->
              if (message.what != 2 || finished.get()) return@Handler false
              if (!message.data.getBoolean("ok")) finish(message.data.getString("error") ?: "Source parser failed")
              else io.execute {
                try { require(output.length() in 1..2L * 1024 * 1024); val result = output.readText(); main.post { finish(null, result) } }
                catch (_: Exception) { main.post { finish("Source parser returned invalid output") } }
              }
              true
            })
            connection = object : ServiceConnection {
              override fun onServiceConnected(name: ComponentName, binder: IBinder) {
                if (finished.get()) return
                try {
                  withParserDescriptors(
                    { ParcelFileDescriptor.open(input, ParcelFileDescriptor.MODE_READ_ONLY) },
                    { ParcelFileDescriptor.open(output, ParcelFileDescriptor.MODE_WRITE_ONLY or ParcelFileDescriptor.MODE_TRUNCATE) }
                  ) { inputFd, outputFd ->
                    Messenger(binder).send(Message.obtain(null, 1).apply { replyTo = reply; data = Bundle().apply { putParcelable("input", inputFd); putParcelable("output", outputFd) } })
                  }
                } catch (_: Exception) { finish("Cannot connect to source parser") }
              }
              override fun onServiceDisconnected(name: ComponentName) { finish("Source parser stopped unexpectedly") }
              override fun onBindingDied(name: ComponentName) { finish("Source parser stopped unexpectedly") }
              override fun onNullBinding(name: ComponentName) { finish("Source parser is unavailable") }
            }
            timeout = Runnable { finish("Source parser exceeded its execution budget") }
            cancelActive = { finish("Source parser canceled") }; main.postDelayed(timeout, 7_000)
            try { bound = context.bindService(intent, connection, Context.BIND_AUTO_CREATE); if (!bound) finish("Cannot start isolated source parser") }
            catch (_: Exception) { finish("Cannot start isolated source parser") }
          }
        } catch (error: Exception) {
          inFile?.delete(); outFile?.delete()
          try { promise.reject("ERR_SOURCE_PARSER", error.message, error) } finally { if (lifecycle.complete()) io.shutdown() }
        }
      }
      }
      if (!accepted) promise.reject("ERR_PARSER_BUSY", "Source parser session is closed or already running", null)
    }
    OnDestroy {
      val idle = lifecycle.destroy()
      main.post { cancelActive?.invoke(); if (idle) io.shutdown() }
    }
  }
}
