import { AppState } from 'react-native';
import { create } from 'zustand';
import type { Song } from '@/api/subsonic';
import { analyzeLoudness, cancelLoudness, type LoudnessMeasurement } from '../../modules/listening-tools';
import { readListeningExtra, writeListeningExtra, pruneListeningCache } from './listeningExtras';
import { customizationScope, captureCustomizationOwner } from './localCustomizations';
import { hashKey } from './localLibrary';
import { ownedAudioUri, ownedAudioIdentity } from './ownedAudio';
import { isSpokenContent } from './currentContentKind';
import { profileScopeId, useAuthStore } from '@/store/auth';
export interface LoudnessPreferences { analyzeMissing: boolean; }
export const useLoudnessTools = create<{scope:string;analyzeMissing:boolean;busy:boolean;progress:number;total:number;error:string}>(() => ({scope:'',analyzeMissing:false,busy:false,progress:0,total:0,error:''}));
interface CachedMeasurement { version:1;identity:string;measurement:LoudnessMeasurement; }
const attempts = new Map<string,number>(), frozen = new Map<string,Song['replayGain']|null>(), snapshots = new Map<string,number>();
let activeId = '', stopActive: (() => void) | undefined, sequence = 0;
const itemKey = (song:Song) => JSON.stringify([profileScopeId(),customizationScope().source,song.id,song.cueStartSec,song.cueEndSec]);
const albumKey = (song:Song) => song.albumId ?? JSON.stringify([song.album??'',song.albumArtist??song.artist??'']);
function usableTags(song:Song) { return !!song.replayGain && [song.replayGain.trackGain,song.replayGain.albumGain].some(Number.isFinite); }
const finite = (value:unknown, low:number, high:number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
export function albumLoudness(values: readonly Pick<LoudnessMeasurement,'blockEnergies'|'samplePeak'>[]): {lufs:number|null;peak:number} {
  let count=0,total=0,peak=0;
  for (const value of values) {
    if (!value || !finite(value.samplePeak,0,16) || !Array.isArray(value.blockEnergies) || (count+=value.blockEnergies.length)>2_000_000) throw new Error('Invalid or excessive album loudness data');
    peak=Math.max(peak,value.samplePeak);
    for (const energy of value.blockEnergies) { if (!finite(energy,0,1_000_000)) throw new Error('Invalid loudness energy'); total+=energy; }
  }
  if (!count) return {lufs:null,peak};
  const threshold=(total/count)/10; let relativeTotal=0,relativeCount=0;
  for (const value of values) for (const energy of value.blockEnergies) if (energy>=threshold) { relativeTotal+=energy; relativeCount++; }
  const energy=relativeCount?relativeTotal/relativeCount:0;
  return {lufs:energy>0?-0.691+10*Math.log10(energy):null,peak};
}
/** Cache/native payloads are data, not proof of a completed measurement. */
export function validLoudnessMeasurement(value:unknown): value is LoudnessMeasurement {
  const m=value as LoudnessMeasurement | undefined;
  if (!m || m.complete!==true || m.algorithm!=='bs1770-r128-v1' || !finite(m.samplePeak,0,16)
    || !finite(m.durationSec,.39,14_400) || !finite(m.sampleRate,8000,384000) || !Number.isInteger(m.sampleRate)
    || ![1,2].includes(m.channels) || !Number.isSafeInteger(m.frames) || m.frames<=0
    || Math.abs(m.frames/m.sampleRate-m.durationSec)>.0001 || !Array.isArray(m.blockEnergies)
    || m.blockEnergies.length>Math.max(0,Math.floor(m.frames/Math.round(m.sampleRate/10))-3)
    || m.blockEnergies.some(energy=>!finite(energy,Math.pow(10,(-70+.691)/10),1_000_000))) return false;
  const expected=albumLoudness([m]).lufs;
  return expected===null ? m.integratedLufs===null : finite(m.integratedLufs,-70,60) && Math.abs(m.integratedLufs-expected)<.00001;
}
function cachedMeasurement(value:unknown,key:string): value is CachedMeasurement {
  const saved=value as CachedMeasurement | undefined;
  return !!saved && saved.version===1 && saved.identity===key && validLoudnessMeasurement(saved.measurement);
}
function validAlbum(value:unknown,key:string): value is {keys:string[];lufs:number;peak:number} {
  const album=value as {keys?:unknown;lufs?:unknown;peak?:unknown} | undefined;
  return !!album && Array.isArray(album.keys) && album.keys.length<=200 && album.keys.every(key=>typeof key==='string'&&key.length<=200)
    && album.keys.includes(key) && finite(album.lufs,-70,60) && finite(album.peak,0,16);
}
function gain(m:LoudnessMeasurement):Song['replayGain']|null { return m.integratedLufs===null?null:{trackGain:-18-m.integratedLufs,trackPeak:m.samplePeak}; }
export function frozenLoudnessGain(song:Song|undefined|null):Song['replayGain']|undefined { return song?frozen.get(itemKey(song))??undefined:undefined; }
export async function hydrateLoudnessPreferences() {
  const scope=customizationScope(),current=captureCustomizationOwner(scope);
  try { const value=await readListeningExtra<LoudnessPreferences>('loudness-preferences',scope,current); if(current()) useLoudnessTools.setState({scope:JSON.stringify(scope),analyzeMissing:value?.analyzeMissing===true}); }
  catch { if(current()) useLoudnessTools.setState({scope:JSON.stringify(scope),analyzeMissing:false}); }
}
export async function setAutomaticLoudness(enabled:boolean) {
  const scope=customizationScope(),current=captureCustomizationOwner(scope);
  await writeListeningExtra('loudness-preferences',{analyzeMissing:enabled},scope,current);
  if(current()) useLoudnessTools.setState({scope:JSON.stringify(scope),analyzeMissing:enabled});
}
/** Only explicit source installation refreshes this snapshot, never an analysis completion. */
export async function prepareLoudnessSnapshot(song:Song,refresh=false,extraCurrent:()=>boolean=()=>true) {
  const key=itemKey(song); if(!refresh&&frozen.has(key))return;
  const generation=++sequence; snapshots.set(key,generation);
  // Cap even aborted preparations; no retained Song or account object.
  while(snapshots.size>160)snapshots.delete(snapshots.keys().next().value!);
  const scope=customizationScope(),current=captureCustomizationOwner(scope,()=>extraCurrent()&&snapshots.get(key)===generation);
  let snapshot:Song['replayGain']|null=null;
  try { if(!usableTags(song)) {
    const file=await ownedAudioIdentity(song,current); if(!current())return;
    const saved=await readListeningExtra<unknown>('loudness:'+file.key,scope,current);
    if(cachedMeasurement(saved,file.key)) {
      snapshot=gain(saved.measurement);
      const album=await readListeningExtra<unknown>('loudness-album:'+hashKey(albumKey(song)),scope,current);
      if(snapshot&&validAlbum(album,file.key))snapshot={...snapshot,albumGain:-18-album.lufs,albumPeak:album.peak};
    }
  }} catch { /* Cache failure never blocks ordinary playback. */ }
  if(current()) { frozen.delete(key); frozen.set(key,snapshot); while(frozen.size>80)frozen.delete(frozen.keys().next().value!); }
}
export function cancelLoudnessWork() { stopActive?.(); if(activeId)cancelLoudness(activeId); }
export async function analyzeLocalSongs(songs:readonly Song[],asAlbum=false,extraCurrent:()=>boolean=()=>true):Promise<void> {
  if(useLoudnessTools.getState().busy)throw new Error('A loudness analysis is already running');
  if(!songs.length||songs.length>200)throw new Error('Choose between one and 200 tracks');
  const album=albumKey(songs[0]); if(asAlbum&&!songs.every(song=>albumKey(song)===album))throw new Error('Choose tracks from one album');
  const scope=customizationScope(); let canceled=false,blocks=0;
  const owns=captureCustomizationOwner(scope,()=>!canceled&&extraCurrent()),results:{key:string;measurement:LoudnessMeasurement}[]=[];
  const stop=()=>{canceled=true;};stopActive=stop;
  const check=()=>{if(!owns())throw new Error('Loudness analysis canceled');};
  useLoudnessTools.setState({busy:true,progress:0,total:songs.length,error:''});
  try {
    for(let index=0;index<songs.length;index++) {
      check(); const song=songs[index],file=await ownedAudioIdentity(song,owns);check();
      let saved:unknown=await readListeningExtra('loudness:'+file.key,scope,owns);check();
      if(!cachedMeasurement(saved,file.key)) {
        activeId='loudness-'+Date.now()+'-'+(++sequence);
        const measurement=await analyzeLoudness({requestId:activeId,uri:file.uri,startSec:song.cueStartSec,endSec:song.cueEndSec});check();
        if(!validLoudnessMeasurement(measurement))throw new Error('Loudness analysis did not complete');
        const after=await ownedAudioIdentity(song,owns);check();
        if(after.stamp!==file.stamp)throw new Error('The local audio changed during analysis');
        saved={version:1,identity:file.key,measurement};
        await writeListeningExtra('loudness:'+file.key,saved,scope,owns);check();
      }
      const accepted=saved as CachedMeasurement;
      if(asAlbum) { blocks+=accepted.measurement.blockEnergies.length;if(blocks>2_000_000)throw new Error('Album loudness exceeds the analysis budget');results.push({key:file.key,measurement:accepted.measurement}); }
      if(owns())useLoudnessTools.setState({progress:index+1});
    }
    if(asAlbum){const value=albumLoudness(results.map(result=>result.measurement));await writeListeningExtra('loudness-album:'+hashKey(album),{keys:results.map(result=>result.key),...value},scope,owns);check();}
    await pruneListeningCache('loudness:',100*1024*1024,scope,owns);check();
  }catch(error){if(owns())useLoudnessTools.setState({error:error instanceof Error?error.message:'Loudness analysis failed'});throw error;}
  finally{if(stopActive===stop){activeId='';stopActive=undefined;useLoudnessTools.setState({busy:false});}}
}
export function maybeAnalyzeMissingLoudness(song:Song) {
  const state=useLoudnessTools.getState(),key=itemKey(song);
  if(Date.now()-(attempts.get(key)??0)<600000)return;
  if(state.scope!==JSON.stringify(customizationScope())||!state.analyzeMissing||state.busy||usableTags(song)||song.id.startsWith('radio:')||song.id.startsWith('localradio:')||isSpokenContent(song)||AppState.currentState!=='active'||!ownedAudioUri(song))return;
  attempts.set(key,Date.now());while(attempts.size>80)attempts.delete(attempts.keys().next().value!);
  void analyzeLocalSongs([song]).catch(()=>{});
}
AppState.addEventListener('change',state=>{if(state!=='active')cancelLoudnessWork();});
useAuthStore.subscribe((next,previous)=>{if(next.auth!==previous.auth||next.offlineSource!==previous.offlineSource||next.offline!==previous.offline||next.autoOffline!==previous.autoOffline){cancelLoudnessWork();frozen.clear();snapshots.clear();attempts.clear();useLoudnessTools.setState({scope:'',analyzeMissing:false,progress:0,total:0,error:''});void hydrateLoudnessPreferences();}});
