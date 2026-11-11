/** Imported source scripts execute in an isolated Android process, never the RN runtime. */
import { requireOptionalNativeModule } from 'expo';
const parser = requireOptionalNativeModule<{ run(script: string, response: string, variables: string): Promise<string>; decodeText(base64: string, encoding: string): Promise<string>;
  decodeScraperLyrics(base64: string, magicHex: string, xorKeyHex: string): Promise<string> }>('MetadataScript');
export async function runMetadataScript(script: string, responseText: string, variables: { externalId?: string; secrets?: Record<string, string> } = {}): Promise<unknown> {
  if (!parser) throw new Error('Isolated source parsing is available on Android');
  const result = await parser.run(script, responseText, JSON.stringify(variables));
  return JSON.parse(result);
}

export async function decodeImportedText(base64: string, encoding = 'auto'): Promise<string> {
  if (!parser) throw new Error('Text encoding conversion is available on Android');
  return parser.decodeText(base64, encoding);
}
export async function decodeScraperLyrics(base64: string, magicHex: string, xorKeyHex: string): Promise<string> {
  if (!parser || typeof parser.decodeScraperLyrics !== 'function') throw new Error('Scraper lyric decoding is available on Android');
  return parser.decodeScraperLyrics(base64, magicHex, xorKeyHex);
}
