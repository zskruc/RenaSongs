import { fetch } from 'expo/fetch';
import * as FileSystem from 'expo-file-system/legacy';
import type { Song, SongLyrics } from '@/api/subsonic';
import { useAuthStore } from '@/store/auth';
import { prepareAlignmentAudio, releaseAlignmentAudio, cancelAlignmentAudio, type PreparedAlignmentAudio } from '../../modules/listening-tools';
import { ownedAudioIdentity } from './ownedAudio';
import { hashKey } from './localLibrary';
import { readListeningExtra, writeListeningExtra, pruneListeningCache } from './listeningExtras';
import { customizationScope, captureCustomizationOwner } from './localCustomizations';
import { getItem, setItemStrict } from './storage';
import { alignmentLines, applyLyricAlignment, alignmentPayload } from './lyricAlignment';
import { isManualOffline } from '@/api/netGate';
export interface AlignmentSettings { endpoint: string; language: string; }
const secretKey = (profile: string) => 'resonus.alignment.token.' + hashKey(profile);
function endpointUrl(value: string): string {
  const text = value.trim();
  if (text.length > 2048) throw new Error('Use an HTTP or HTTPS alignment endpoint without credentials in its URL');
  if (text) {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Use an HTTP or HTTPS alignment endpoint without credentials in its URL');
  }
  return text;
}
export async function alignmentSettings(): Promise<AlignmentSettings> {
  const value = await readListeningExtra<AlignmentSettings>('alignment-settings');
  return value && typeof value.endpoint === 'string' && typeof value.language === 'string'
    ? { endpoint: endpointUrl(value.endpoint), language: value.language.slice(0,100) }
    : { endpoint: '', language: 'Chinese' };
}
interface AlignmentCredential { version: 1; source: string; endpoint: string; token: string; }
const credentialWrites = new Map<string,Promise<void>>();
/** Legacy raw tokens have no proven destination and are never sent. */
function boundCredential(raw:string|null,source:string,endpoint:string):string|undefined {
  if (!raw || raw.length>20000) return;
  try {
    const value=JSON.parse(raw) as AlignmentCredential;
    if (value?.version===1 && value.source===source && value.endpoint===endpoint && typeof value.token==='string' && value.token.length<=16000) return value.token;
  } catch { /* A previously saved, unbound token requires explicit re-entry. */ }
}
export async function saveAlignmentSettings(settings: AlignmentSettings, token?: string) {
  const endpoint = endpointUrl(settings.endpoint);
  if (typeof settings.language !== 'string' || settings.language.length > 100 || token!==undefined && (typeof token!=='string' || token.length>16000)) throw new Error('Invalid alignment settings');
  const scope=customizationScope(),current=captureCustomizationOwner(scope),key=secretKey(scope.profile);
  // The one profile key is shared by source settings. Serialize its read/replace
  // with those settings so a stale source cannot restore an earlier credential.
  const work=(credentialWrites.get(scope.profile)??Promise.resolve()).catch(()=>{}).then(async()=>{
    if(!current())throw new Error('Alignment profile changed');
    const raw=token===undefined?await getItem(key):null;
    if(!current())throw new Error('Alignment profile changed');
    const saved:AlignmentCredential={version:1,source:scope.source,endpoint,token:token===undefined?boundCredential(raw,scope.source,endpoint)??'':token.trim()};
    await setItemStrict(key,JSON.stringify(saved));
    if(!current())throw new Error('Alignment profile changed');
    await writeListeningExtra('alignment-settings',{endpoint,language:settings.language},scope,current);
  });
  credentialWrites.set(scope.profile,work);
  try{await work;}finally{if(credentialWrites.get(scope.profile)===work)credentialWrites.delete(scope.profile);}
}
// The profile cleanup retires customization owners first, then drains before
// deleting this profile's SecureStore key. In-flight native writes cannot be canceled.
export async function drainAlignmentCredentialWrites(profile:string):Promise<void> {
  await credentialWrites.get(profile)?.catch(()=>{});
}
const cancellations = new Map<string, AbortController>();
const canceled = () => new Error('Lyric alignment canceled');
export function cancelLyricAlignment(id: string) { cancellations.get(id)?.abort(); cancelAlignmentAudio(id); }
function release(uri: string) { try { releaseAlignmentAudio(uri); } catch { /* Native ages out its private temporary files too. */ } }
function validPrepared(audio: PreparedAlignmentAudio, song: Song) {
  const root = FileSystem.cacheDirectory;
  if (!root || !audio || !audio.uri?.startsWith(root + 'alignment-audio/') || /(?:\.\.|%2e|[\u0000-\u001f])/i.test(audio.uri)
    || audio.mime !== 'audio/wav' || audio.temporary !== true || audio.channels !== 1 || audio.sampleRate !== 16000
    || !Number.isFinite(audio.bytes) || audio.bytes <= 44 || audio.bytes > 20 * 1024 * 1024
    || !Number.isFinite(audio.durationSec) || audio.durationSec <= 0 || audio.durationSec > 600
    || !Number.isFinite(audio.physicalStartSec) || Math.abs(audio.physicalStartSec - (song.cueStartSec ?? 0)) > .1) throw new Error('Prepared audio is invalid');
}
interface AlignmentCache { version: 1; durationSec: number; output: unknown; }
/** The caller supplies a live document/page predicate. Cancel settles promptly;
 * even a late native WAV result is released after this operation has returned. */
export async function alignLocalLyrics(id: string, song: Song, document: SongLyrics, settings: AlignmentSettings,
  current: () => boolean, onPhase: (phase: string) => void): Promise<SongLyrics> {
  if (isManualOffline()) throw new Error('The configured alignment service needs a network connection');
  const endpoint = endpointUrl(settings.endpoint);
  if (!endpoint) throw new Error('Set a compatible alignment service endpoint first');
  if (!id || id.length > 200 || cancellations.has(id)) throw new Error('A lyric alignment is already running');
  const scope = customizationScope(), owns = captureCustomizationOwner(scope,current), controller = new AbortController();
  cancellations.set(id,controller);
  let temporary: string | undefined, finished = false;
  let rejectStop!: (error: Error) => void;
  const stopped = new Promise<never>((_resolve,reject) => { rejectStop = reject; });
  // A background ownership change also rejects a currently held native/fetch await.
  const stop = () => { cancelAlignmentAudio(id); rejectStop(canceled()); };
  controller.signal.addEventListener('abort',stop,{ once: true });
  const unsubscribe = useAuthStore.subscribe(() => { if (!owns() || isManualOffline()) controller.abort(); });
  const timer = setTimeout(() => controller.abort(),240_000);
  const check = () => { if (!owns() || controller.signal.aborted || isManualOffline()) throw canceled(); };
  const wait = <T,>(work: Promise<T>) => Promise.race([work,stopped]);
  try {
    check();
    const before = await wait(ownedAudioIdentity(song,owns,true)); check();
    const identity = hashKey(JSON.stringify([before.stamp,document,endpoint,settings.language]));
    const cacheKey = 'alignment:' + identity;
    const cached = await wait(readListeningExtra<AlignmentCache>(cacheKey,scope,owns)); check();
    if (cached?.version === 1 && Number.isFinite(cached.durationSec) && cached.durationSec > 0 && cached.durationSec <= 600) {
      try { return applyLyricAlignment(document,alignmentLines(document,cached.durationSec),cached.output,cached.durationSec); }
      catch { /* Invalid/older cache data must be recomputed. */ }
    }
    onPhase('Preparing local audio');
    const preparing = prepareAlignmentAudio({ requestId: id, uri: before.uri, startSec: song.cueStartSec, endSec: song.cueEndSec }).then((audio) => {
      if (finished || controller.signal.aborted || !owns()) { if (audio?.uri) release(audio.uri); throw canceled(); }
      temporary = audio.uri;
      return audio;
    });
    const audio = await wait(preparing); check(); validPrepared(audio,song);
    const after = await wait(ownedAudioIdentity(song,owns,true)); check();
    if (before.stamp !== after.stamp) throw new Error('The local audio changed during preparation');
    const lines = alignmentLines(document,audio.durationSec);
    const audioBase64 = await wait(FileSystem.readAsStringAsync(audio.uri,{ encoding: FileSystem.EncodingType.Base64 })); check();
    await wait(credentialWrites.get(scope.profile)??Promise.resolve());check();
    const rawCredential = await wait(getItem(secretKey(scope.profile))); check();
    const token=boundCredential(rawCredential,scope.source,endpoint);
    const requestBody = JSON.stringify({ audio_base64: audioBase64, mime_type: audio.mime, language: settings.language, lines });
    if (requestBody.length > 32 * 1024 * 1024) throw new Error('Alignment upload is too large');
    onPhase('Sending audio to the selected alignment service');
    const response = await wait(fetch(endpoint,{ method: 'POST', signal: controller.signal, credentials: 'omit', redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json, application/x-ndjson, text/event-stream', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: requestBody })); check();
    if (!response.ok) throw new Error(`Alignment service returned HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > 2 * 1024 * 1024) throw new Error('Alignment response is too large');
    let body = '';
    if (response.body) {
      const reader = response.body.getReader(), decoder = new TextDecoder('utf-8',{ fatal: true }); let bytes = 0;
      const abortBody = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort',abortBody,{ once: true });
      try {
        while (true) { const chunk = await wait(reader.read()); check(); if (chunk.done) break;
          bytes += chunk.value.byteLength; if (bytes > 2 * 1024 * 1024) throw new Error('Alignment response is too large');
          body += decoder.decode(chunk.value,{ stream: true }); }
        body += decoder.decode();
      } finally { controller.signal.removeEventListener('abort',abortBody); void reader.cancel().catch(() => {}); reader.releaseLock(); }
    } else { body = await wait(response.text()); if (new TextEncoder().encode(body).length > 2 * 1024 * 1024) throw new Error('Alignment response is too large'); }
    check();
    const output = alignmentPayload(body), result = applyLyricAlignment(document,lines,output,audio.durationSec);
    const latest = await wait(ownedAudioIdentity(song,owns,true)); check();
    if (before.stamp !== latest.stamp) throw new Error('The local audio changed during preparation');
    await wait(writeListeningExtra(cacheKey,{ version: 1, durationSec: audio.durationSec, output },scope,owns)); check();
    await wait(pruneListeningCache('alignment:',20 * 1024 * 1024,scope,owns)); check();
    return result;
  } finally {
    finished = true; clearTimeout(timer); unsubscribe();
    if (cancellations.get(id) === controller) cancellations.delete(id);
    // Do not reject an unused stopped promise on the ordinary success path.
    controller.signal.removeEventListener('abort',stop); controller.abort();
    if (temporary) release(temporary);
  }
}
