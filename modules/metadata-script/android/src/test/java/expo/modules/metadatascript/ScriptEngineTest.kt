package expo.modules.metadatascript

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.zip.DeflaterOutputStream

class ScriptEngineTest {
  private fun run(code: String, body: String = "{}", vars: String = "{}") = ScriptEngine.run(code, body, vars)
  @Test fun responseBodyAndExplicitExpressionUseRealInterpreter() {
    assertEquals("{\"title\":\"测试\",\"year\":2026}", run("return {title:response.name,year:2026};", "{\"name\":\"测试\"}"))
    assertEquals("[2,4,6]",run("(response.map(x=>x*2))", "[1,2,3]"))
    assertEquals("null", run("var unused=1;"))
    assertEquals("\"not-json\"", run("return responseText;", "not-json"))
  }
  @Test fun externalIdentityAndSecretsStayPureData() {
    val result=JSONObject(run("secrets.token='changed';return {id:externalId,attached:response._externalId,token:secrets.token};", "{}", "{\"externalId\":\"artist42\",\"secrets\":{\"token\":\"only-configured\"}}"))
    assertEquals("artist42",result.getString("id"));assertEquals("artist42",result.getString("attached"));assertEquals("only-configured",result.getString("token"))
  }
  @Test fun javaPackagesReflectionAndClassLoadersAreNotAvailable() {
    val result=JSONArray(run("return [typeof Packages,typeof java,typeof JavaAdapter,typeof JavaImporter,typeof load,typeof readFile,typeof getClass,typeof nativeResolver.xorMd5UrlHash.getClass];"))
    repeat(result.length()) { assertEquals("undefined",result.getString(it)) }
    for(expression in listOf("java.lang.System.getProperty('user.home')", "Packages.java.io.File('/')", "this.constructor.constructor('return java.lang.Class')()")) {
      assertThrows(Throwable::class.java) { run("return $expression;") }
    }
  }
  @Test fun coverCompatibilityUsesUtf8XorMd5UrlSafePaddingWithoutJavaObjects() {
    assertEquals("z80ghJXVZe9m59_5-Ydk2g==",ScraperDataCodec.xorMd5UrlHash("1","01","{{hash}}"))
    assertEquals("https://cover.test/9F7kT25sS6LVXVBJ657ufw==/许嵩 123",ScraperDataCodec.xorMd5UrlHash("许嵩 123","01a5ff","https://cover.test/{{hash}}/{{id}}"))
    val vars="{\"secrets\":{\"coverSeedHex\":\"01a5ff\",\"coverUrlTemplate\":\"https://cover.test/{{hash}}/{{id}}\"}}"
    val resolved=run("return nativeCoverUrl('许嵩 123');",vars=vars)
    assertEquals(JSONObject.quote(ScraperDataCodec.xorMd5UrlHash("许嵩 123","01a5ff","https://cover.test/{{hash}}/{{id}}")),resolved)
    assertTrue(resolved.contains("="));assertTrue(resolved.contains("许嵩 123"))
    assertEquals("null",run("return nativeCoverUrl('id');"))
    assertThrows(Throwable::class.java) {run("return nativeResolver.xorMd5UrlHash('id','','{{hash}}');")}
    assertEquals("\"undefined\"",run("return typeof nativeResolver.xorMd5UrlHash('id','01','{{hash}}').getClass;"))
  }
  @Test(timeout=5000) fun infiniteInterpreterLoopStopsAndCannotSwallowItsBudget() {
    assertThrows(Error::class.java) { run("while(true){}") }
    assertThrows(Error::class.java) { run("try{while(true){}}catch(e){while(true){}}") }
  }
  @Test fun hardInputAndResultBoundsAreEnforced() {
    assertThrows(IllegalArgumentException::class.java) {run("x".repeat(200001))}
    assertThrows(IllegalArgumentException::class.java) {run("return {};", "x".repeat(5*1024*1024+1))}
    assertThrows(IllegalArgumentException::class.java) {run("return {};", vars=" ".repeat(64001))}
    assertThrows(IllegalArgumentException::class.java) {run("return 'x'.repeat(2*1024*1024);")}
    assertThrows(Throwable::class.java) {run("return {", "{}")}
  }
  private fun encoded(bytes: ByteArray): ByteArray { val out=ByteArrayOutputStream();DeflaterOutputStream(out).use{it.write(bytes)};return out.toByteArray() }
  private fun fixture(raw: ByteArray, tail: ByteArray = byteArrayOf()):String {
    val body=encoded(raw)+tail; val key=byteArrayOf(0x01,0xa5.toByte(),0xff.toByte())
    return Base64.getEncoder().encodeToString(byteArrayOf(0x4b,0x52,0x43,0x31)+body.mapIndexed { i,b->(b.toInt() xor key[i%3].toInt()).toByte() }.toByteArray())
  }
  @Test fun actualLyricsDecodeRoundTripsUtf8AndChecksMagicChecksumAndEof() {
    val text="[00:01.00]你好，世界\n[00:02.00]Test 🎵"
    val valid=fixture(text.toByteArray())
    assertEquals(text,ScraperDataCodec.decodeLyrics(valid,"4b524331","01a5ff"))
    assertEquals(text,ScraperDataCodec.decodeLyrics(valid.chunked(11).joinToString("\n"),"4b524331","01a5ff"))
    assertThrows(Exception::class.java) {ScraperDataCodec.decodeLyrics(valid,"00000000","01a5ff")}
    assertThrows(Exception::class.java) {ScraperDataCodec.decodeLyrics(valid,"4b524331","")}
    val corrupt=Base64.getDecoder().decode(valid).also { it[it.lastIndex]=(it.last().toInt() xor 1).toByte() }
    assertThrows(Exception::class.java) {ScraperDataCodec.decodeLyrics(Base64.getEncoder().encodeToString(corrupt),"4b524331","01a5ff")}
    val truncated=Base64.getDecoder().decode(valid).dropLast(2).toByteArray()
    assertThrows(Exception::class.java) {ScraperDataCodec.decodeLyrics(Base64.getEncoder().encodeToString(truncated),"4b524331","01a5ff")}
    assertThrows(Exception::class.java) {ScraperDataCodec.decodeLyrics(fixture(text.toByteArray(), byteArrayOf(0)),"4b524331","01a5ff")}
    assertThrows(Exception::class.java) {ScraperDataCodec.decodeLyrics(fixture(byteArrayOf(0xc0.toByte(),0xaf.toByte())),"4b524331","01a5ff")}
  }
  @Test fun decompressionBombAndMalformedBase64NeverReturnPartialLyrics() {
    assertThrows(Exception::class.java) {ScraperDataCodec.decodeLyrics(fixture(ByteArray(2*1024*1024+1){65}),"4b524331","01a5ff")}
    for(value in listOf("%%%?", "AAAA=AAA", "SGVsbG9=", "A===")) assertThrows(Exception::class.java) {ScraperDataCodec.decodeLyrics(value,"4b524331","01")}
    assertThrows(Exception::class.java) {ScraperDataCodec.decodeLyrics("A".repeat(4*1024*1024+4),"4b524331","01")}
  }
}
