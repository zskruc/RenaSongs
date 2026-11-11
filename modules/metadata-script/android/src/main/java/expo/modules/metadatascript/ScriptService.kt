package expo.modules.metadatascript

import android.app.Service
import android.content.Intent
import android.os.*
import org.json.JSONObject
import java.io.InputStreamReader
import java.util.concurrent.Executors

/** No network/storage permission: receives only pre-opened per-request descriptors. */
class ScriptService : Service() {
  private val worker = Executors.newSingleThreadExecutor()
  private val receiver = Messenger(Handler(Looper.getMainLooper()) { message ->
    if (message.what != 1) return@Handler false
    val data = message.data
    @Suppress("DEPRECATION") val input = data.getParcelable<ParcelFileDescriptor>("input")
    @Suppress("DEPRECATION") val output = data.getParcelable<ParcelFileDescriptor>("output")
    val reply = message.replyTo
    worker.execute {
      val answer = Bundle()
      try {
        require(input != null && output != null)
        val bytes = ParcelFileDescriptor.AutoCloseInputStream(input).use { stream ->
          val buffer = java.io.ByteArrayOutputStream(); val chunk = ByteArray(8192)
          while (true) { val count = stream.read(chunk); if (count < 0) break; require(buffer.size() + count <= 17 * 1024 * 1024); buffer.write(chunk, 0, count) }
          buffer.toByteArray()
        }
        val request = JSONObject(String(bytes, Charsets.UTF_8))
        val result = ScriptEngine.run(request.getString("script"), request.getString("response"), request.getString("variables"))
        ParcelFileDescriptor.AutoCloseOutputStream(output).use { it.write(result.toByteArray(Charsets.UTF_8)); it.flush() }
        answer.putBoolean("ok", true)
      } catch (error: Throwable) {
        runCatching { input?.close() }; runCatching { output?.close() }
        answer.putBoolean("ok", false); answer.putString("error", if (error is OutOfMemoryError) "Source parser exceeded its memory budget" else (error.message ?: "Source parser failed").take(500))
      }
      try { reply?.send(Message.obtain(null, 2).apply { this.data = answer }) } catch (_: Exception) { }
    }
    true
  })
  override fun onBind(intent: Intent): IBinder = receiver.binder
  override fun onDestroy() {
    worker.shutdownNow()
    // A runaway builtin/allocation cannot keep a detached parser VM alive.
    if (applicationInfo.uid != Process.myUid()) Process.killProcess(Process.myPid())
    super.onDestroy()
  }
}
