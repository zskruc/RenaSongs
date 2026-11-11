package expo.modules.offlinetranslation

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

/** Text remains local. Models download only through explicit prepare. MLKit's
 * model download Task itself has no cancellation token: cancellation stops our
 * waiting/translation client, with a model-mutation fence until Task completes. */
class OfflineTranslationModule : Module() {
  private class Work(val client: Translator, val promise: Promise) { val done = AtomicBoolean(false) }
  private val work = TranslationWorkGate<Work>()
  private fun language(tag: String): String = TranslateLanguage.fromLanguageTag(tag)
    ?: throw IllegalArgumentException("Unsupported translation language")
  private fun begin(id: String, from: String, to: String, promise: Promise): Work = work.begin(id) {
    Work(Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(language(from)).setTargetLanguage(language(to)).build()), promise)
  }
  private fun finish(id: String, entry: Work, result: Any? = null, error: Exception? = null) {
    if (!entry.done.compareAndSet(false, true)) return
    work.remove(id, entry)
    try { entry.client.close() } catch (_: Exception) { /* Always settle even if SDK disposal fails. */ }
    if (error == null) entry.promise.resolve(result)
    else entry.promise.reject("ERR_OFFLINE_TRANSLATION", error.message ?: "Translation failed", error)
  }
  override fun definition() = ModuleDefinition {
    Name("OfflineTranslation")
    Function("languages") { TranslateLanguage.getAllLanguages() }
    AsyncFunction("models") { promise: Promise ->
      if (work.isClosed()) promise.reject("ERR_TRANSLATION_MODELS", "Translation session ended", null)
      else RemoteModelManager.getInstance().getDownloadedModels(TranslateRemoteModel::class.java)
        .addOnSuccessListener { if (work.isClosed()) promise.reject("ERR_TRANSLATION_MODELS", "Translation session ended", null) else promise.resolve(it.map { model -> model.language }.sorted()) }
        .addOnFailureListener { promise.reject("ERR_TRANSLATION_MODELS", it.message, it) }
    }
    AsyncFunction("prepare") { id: String, from: String, to: String, wifiOnly: Boolean, promise: Promise ->
      var entry: Work? = null
      try {
        val active = begin(id, from, to, promise); entry = active
        val conditions = DownloadConditions.Builder().apply { if (wifiOnly) requireWifi() }.build()
        work.startDownload(id, active) {
          active.client.downloadModelIfNeeded(conditions)
            .addOnSuccessListener { work.downloadFinished(active); finish(id, active) }
            .addOnFailureListener { work.downloadFinished(active); finish(id, active, error = it) }
        }
      } catch (error: Exception) {
        val active = entry
        if (active == null) promise.reject("ERR_TRANSLATION_MODEL", error.message, error) else finish(id, active, error = error)
      }
    }
    AsyncFunction("removeModel") { code: String, promise: Promise ->
      try {
        val model = TranslateRemoteModel.Builder(language(code)).build()
        work.startDeletion {
          RemoteModelManager.getInstance().deleteDownloadedModel(model)
            .addOnSuccessListener { work.deletionFinished(); promise.resolve(null) }
            .addOnFailureListener { work.deletionFinished(); promise.reject("ERR_TRANSLATION_MODEL", it.message, it) }
        }
      } catch (error: Exception) { promise.reject("ERR_TRANSLATION_MODEL", error.message, error) }
    }
    AsyncFunction("translate") { id: String, from: String, to: String, lines: List<String>, promise: Promise ->
      var entry: Work? = null
      try {
        require(lines.size <= 1000 && lines.all { it.length <= 4000 } && lines.sumOf { it.length.toLong() } <= 100_000) { "Lyrics are too large" }
        if (language(from) == language(to)) { check(!work.isClosed()); promise.resolve(lines); return@AsyncFunction }
        val active = begin(id, from, to, promise); entry = active
        RemoteModelManager.getInstance().getDownloadedModels(TranslateRemoteModel::class.java)
          .addOnSuccessListener { models ->
            if (active.done.get()) return@addOnSuccessListener
            try {
              val downloaded = models.map { it.language }.toSet()
              val required = setOf(language(from), language(to)) - TranslateLanguage.ENGLISH
              if (!downloaded.containsAll(required)) {
                finish(id, active, error = IllegalStateException("Download the selected language models first"))
              } else {
                val result = ArrayList<String>(lines.size)
                fun next(start: Int) {
                  if (active.done.get()) return
                  try {
                    var index = start
                    while (index < lines.size && lines[index].isBlank()) { result.add(lines[index]); index++ }
                    if (index >= lines.size) { finish(id, active, result); return }
                    val nextIndex = index + 1
                    active.client.translate(lines[index]).addOnSuccessListener { translated ->
                      if (!active.done.get()) { result.add(translated); next(nextIndex) }
                    }.addOnFailureListener { finish(id, active, error = it) }
                  } catch (error: Exception) { finish(id, active, error = error) }
                }
                next(0)
              }
            } catch (error: Exception) { finish(id, active, error = error) }
          }.addOnFailureListener { finish(id, active, error = it) }
      } catch (error: Exception) {
        val active = entry
        if (active == null) promise.reject("ERR_OFFLINE_TRANSLATION", error.message, error) else finish(id, active, error = error)
      }
    }
    Function("cancel") { id: String -> work.entry(id)?.let { finish(id, it, error = IllegalStateException("Translation canceled")) } }
    OnDestroy { work.close().forEach { (id, entry) -> finish(id, entry, error = IllegalStateException("Translation session ended")) } }
  }
}
