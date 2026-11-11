import type { SongLyrics } from '@/api/subsonic';
import { offlineTranslation } from '../../modules/offline-translation';
import { hashKey } from './localLibrary';
import { readListeningExtra, writeListeningExtra, pruneListeningCache } from './listeningExtras';
import { captureCustomizationOwner, customizationScope } from './localCustomizations';
export const TRANSLATION_LANGUAGES = [
  ['zh','Chinese'],['en','English'],['ja','Japanese'],['ko','Korean'],['fr','French'],['de','German'],['es','Spanish'],['it','Italian'],['ru','Russian'],['pt','Portuguese'],['ar','Arabic'],['pl','Polish'],['hi','Hindi'],['tr','Turkish'],['uk','Ukrainian'],['vi','Vietnamese'],['th','Thai'],
] as const;
const MAX_LINES = 1000, MAX_INPUT = 100_000, MAX_OUTPUT = 250_000;
function validInput(document: SongLyrics) {
  if (!Array.isArray(document.lines) || document.lines.length > MAX_LINES
    || document.lines.some((line) => !line || typeof line.value !== 'string' || line.value.length > 4000)
    || document.lines.reduce((sum,line) => sum + line.value.length,0) > MAX_INPUT) throw new Error('Lyrics are too large');
}
export function applyTranslatedLines(lyrics: SongLyrics, values: readonly string[]): SongLyrics {
  validInput(lyrics);
  if (!Array.isArray(values) || values.length !== lyrics.lines.length
    || values.some((value) => typeof value !== 'string' || value.length > 16000)
    || values.reduce((sum,value) => sum + value.length,0) > MAX_OUTPUT) throw new Error('Translation result does not match the lyrics');
  return { ...lyrics, translationProvider: 'google-mlkit', lines: lyrics.lines.map((line,index) => ({ ...line, translation: values[index] })) };
}
export async function translateLyricDocument(id: string, document: SongLyrics, from: string, to: string, current: () => boolean): Promise<SongLyrics> {
  if (!offlineTranslation) throw new Error('On-device translation is available on Android');
  validInput(document);
  const scope = customizationScope(), owner = captureCustomizationOwner(scope,current);
  const check = () => { if (!owner()) throw new Error('Translation owner changed'); };
  check();
  const key = 'translation:'+hashKey(JSON.stringify([from,to,document.lines.map((line) => line.value)]));
  const cached = await readListeningExtra<unknown>(key,scope,owner); check();
  if (cached) {
    try { return applyTranslatedLines(document,cached as string[]); }
    catch { /* An old/invalid cache entry is never displayed as a translation. */ }
  }
  const result = await offlineTranslation.translate(id,from,to,document.lines.map((line) => line.value)); check();
  const translated = applyTranslatedLines(document,result);
  await writeListeningExtra(key,result,scope,owner); check();
  await pruneListeningCache('translation:',20 * 1024 * 1024,scope,owner); check();
  return translated;
}
