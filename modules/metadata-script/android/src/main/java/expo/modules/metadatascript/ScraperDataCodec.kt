package expo.modules.metadatascript

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.zip.Inflater

/** Bounded pure data transforms; never resolves a URL, class or filesystem. */
object ScraperDataCodec {
  private const val MAX_TEXT = 2 * 1024 * 1024
  fun xorMd5UrlHash(input: String, seedHex: String, template: String): String {
    require(input.length <= 4096 && input.toByteArray(Charsets.UTF_8).size <= 16384 && template.length <= 8192) { "Cover resolver input is too large" }
    val seed = hex(seedHex, 256)
    val bytes = input.toByteArray(Charsets.UTF_8)
    for (i in bytes.indices) bytes[i] = (bytes[i].toInt() xor seed[i % seed.size].toInt()).toByte()
    val digest = encode64(MessageDigest.getInstance("MD5").digest(bytes)).replace('/', '_').replace('+', '-')
    val result = template.replace("{{hash}}", digest).replace("{{id}}", input)
    require(result.length <= 16384) { "Resolved cover URL is too large" }
    return result
  }
  fun decodeLyrics(base64: String, magicHex: String, keyHex: String): String {
    require(base64.length <= 4 * 1024 * 1024) { "Encoded lyrics are too large" }
    val magic = hex(magicHex, 128); val key = hex(keyHex, 256)
    val bytes = decode64(base64)
    require(bytes.size > magic.size && magic.indices.all { bytes[it] == magic[it] }) { "Lyrics header did not match" }
    val compressed = ByteArray(bytes.size - magic.size) { i -> (bytes[i + magic.size].toInt() xor key[i % key.size].toInt()).toByte() }
    val inflater = Inflater()
    try {
      inflater.setInput(compressed)
      val output = ByteArrayOutputStream(); val buffer = ByteArray(8192)
      while (!inflater.finished()) {
        val size = inflater.inflate(buffer)
        require(!inflater.needsDictionary()) { "Unsupported lyrics dictionary" }
        if (size > 0) { require(output.size() + size <= MAX_TEXT) { "Decoded lyrics are too large" }; output.write(buffer, 0, size) }
        else require(inflater.finished()) { "Truncated or invalid compressed lyrics" }
      }
      require(inflater.remaining == 0) { "Unexpected trailing lyrics data" }
      return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(output.toByteArray())).toString()
    } finally { inflater.end() }
  }
  private fun hex(text: String, max: Int): ByteArray {
    require(text.isNotEmpty() && text.length <= max * 2 && text.length % 2 == 0 && text.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) { "Invalid data key" }
    return ByteArray(text.length / 2) { i -> text.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
  }
  private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  private fun encode64(bytes: ByteArray): String {
    val result = StringBuilder((bytes.size + 2) / 3 * 4)
    var i = 0
    while (i < bytes.size) {
      val a = bytes[i++].toInt() and 255; val b = if (i < bytes.size) bytes[i++].toInt() and 255 else -1; val c = if (i < bytes.size) bytes[i++].toInt() and 255 else -1
      result.append(ALPHABET[a ushr 2]).append(ALPHABET[(a and 3) shl 4 or (if (b >= 0) b ushr 4 else 0)])
      result.append(if (b >= 0) ALPHABET[(b and 15) shl 2 or (if (c >= 0) c ushr 6 else 0)] else '=')
      result.append(if (c >= 0) ALPHABET[c and 63] else '=')
    }
    return result.toString()
  }
  private fun decode64(text: String): ByteArray {
    val clean = text.filterNot { it == ' ' || it == '\t' || it == '\r' || it == '\n' }
    require(clean.isNotEmpty() && clean.length % 4 == 0) { "Invalid encoded lyrics" }
    val out = ByteArrayOutputStream(clean.length / 4 * 3)
    for (i in clean.indices step 4) {
      val a = ALPHABET.indexOf(clean[i]); val b = ALPHABET.indexOf(clean[i + 1])
      val c = if (clean[i + 2] == '=') -1 else ALPHABET.indexOf(clean[i + 2])
      val d = if (clean[i + 3] == '=') -1 else ALPHABET.indexOf(clean[i + 3])
      require(a >= 0 && b >= 0 && (c >= 0 || clean[i + 2] == '=') && (d >= 0 || clean[i + 3] == '=')) { "Invalid encoded lyrics" }
      require(c >= 0 || d < 0) { "Invalid encoded lyrics padding" }
      require(c >= 0 && d >= 0 || i + 4 == clean.length) { "Invalid encoded lyrics padding" }
      require(c >= 0 || b and 15 == 0) { "Invalid encoded lyrics padding" }
      require(d >= 0 || c < 0 || c and 3 == 0) { "Invalid encoded lyrics padding" }
      out.write(a shl 2 or (b ushr 4))
      if (c >= 0) out.write((b and 15) shl 4 or (c ushr 2))
      if (d >= 0) out.write((c and 3) shl 6 or d)
    }
    return out.toByteArray()
  }
}
