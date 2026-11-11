package expo.modules.metadatascript

import org.json.JSONObject
import org.mozilla.javascript.Context
import org.mozilla.javascript.BaseFunction
import org.mozilla.javascript.Scriptable
import org.mozilla.javascript.ContextAction
import org.mozilla.javascript.ContextFactory
import org.mozilla.javascript.ScriptableObject

/** Pure response parser. The Android host runs it under a separate isolated UID. */
object ScriptEngine {
  private class BudgetExceeded : Error("Source parser exceeded its execution budget")
  fun run(script: String, response: String, variables: String): String {
    require(script.length <= 200_000 && response.toByteArray(Charsets.UTF_8).size <= 5 * 1024 * 1024 && variables.length <= 64_000) { "Source response or script is too large" }
    val vars = JSONObject(variables)
    val started = System.nanoTime()
    val factory = object : ContextFactory() {
      var instructions = 0L
      override fun makeContext(): Context = super.makeContext().apply {
        optimizationLevel = -1
        languageVersion = Context.VERSION_ES6
        instructionObserverThreshold = 10_000
        setClassShutter { false }
      }
      override fun observeInstructionCount(cx: Context, count: Int) {
        instructions += count
        if (instructions > 5_000_000L || System.nanoTime() - started > 4_000_000_000L || Thread.currentThread().isInterrupted) throw BudgetExceeded()
      }
    }
    return factory.call(ContextAction<String> { cx ->
      val scope = cx.initSafeStandardObjects(null, true)
      listOf("Packages", "java", "javax", "org", "com", "net", "edu", "JavaAdapter", "JavaImporter", "getClass", "load", "readFile", "readUrl", "quit").forEach { ScriptableObject.deleteProperty(scope, it) }
      val resolver = cx.newObject(scope)
      ScriptableObject.defineProperty(resolver, "xorMd5UrlHash", object : BaseFunction() {
        override fun call(context: Context, callScope: Scriptable, thisObj: Scriptable, args: Array<out Any?>): Any {
          require(args.size == 3) { "Expected input, seed and URL template" }
          return ScraperDataCodec.xorMd5UrlHash(Context.toString(args[0]), Context.toString(args[1]), Context.toString(args[2]))
        }
      }.apply { parentScope = scope; prototype = ScriptableObject.getFunctionPrototype(scope) }, ScriptableObject.READONLY or ScriptableObject.PERMANENT)
      (resolver as ScriptableObject).sealObject()
      ScriptableObject.defineProperty(scope, "nativeResolver", resolver, ScriptableObject.READONLY or ScriptableObject.PERMANENT)
      val prelude = "var responseText=" + JSONObject.quote(response) + ";var response;try{response=JSON.parse(responseText);}catch(e){response={};}" +
        "var __vars=JSON.parse(" + JSONObject.quote(vars.toString()) + ");var externalId=__vars.externalId||'';var secrets=Object.freeze(__vars.secrets||{});" +
        "var nativeCoverUrl=function(id){return secrets.coverSeedHex&&secrets.coverUrlTemplate?nativeResolver.xorMd5UrlHash(String(id),String(secrets.coverSeedHex),String(secrets.coverUrlTemplate)):null;};" +
        "if(response&&typeof response==='object'){response._externalId=externalId;}var console={log:function(){},warn:function(){},error:function(){}};var log=function(){};"
      val body = if (script.trimStart().startsWith("(")) "(" + script.trim().trimEnd(';') + ")" else "(function(){" + script + "\n})()"
      val result = cx.evaluateString(scope, prelude + "JSON.stringify(" + body + ");", "imported-source", 1, null)
      val json = if (result == null || result === Context.getUndefinedValue()) "null" else Context.toString(result)
      require(json.toByteArray(Charsets.UTF_8).size <= 2 * 1024 * 1024) { "Source parser result is too large" }
      json
    })
  }
}
