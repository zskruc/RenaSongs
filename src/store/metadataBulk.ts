import { create } from 'zustand';
import { useAuthStore } from './auth';
import { scopeKey,useLocalMetadata } from './localMetadata';
import { acquireBackgroundWork,type BackgroundWorkLease } from '@/lib/backgroundWork';
import { publishLocalCustomizationChanges } from '@/lib/localCustomizations';
import { lyricRecordingKey } from '@/lib/lyricDocuments';
import { sourceSong } from '@/lib/sourceSongMetadata';
import { metadataOperation,readMetadataRecord } from '@/lib/metadata/repository';
import { DEFAULT_METADATA_SETTINGS,BUILTIN_PROVIDERS,metadataCheck,validMetadataSettings,type MetadataSettings,type ScrapeField,type ScrapeOperation } from '@/lib/metadata/models';
import { validateScraperProfile,type ScraperProfile } from '@/lib/metadata/config';
import { readMetadataCatalogPage,resolveMetadataCatalogSong,metadataMissingFields,type BulkMetadataScope } from '@/lib/metadata/catalog';
import { createBulkJob,loadBulkJob,listBulkJobs,readBulkProfiles,updateBulkJob,retryBulkFailures,clearBulkJobRows,type BulkMetadataJob } from '@/lib/metadata/bulkJobDb';
import { runBulkMetadataJob } from '@/lib/metadata/bulkJobs';
import { claimMetadataRun } from '@/lib/metadata/runLock';
import { searchMetadata,resolveMetadataCandidateForFields } from '@/lib/metadata/providers';
import { applyMetadataCandidate } from '@/lib/metadata/apply';
import { fetchMetadataArtwork } from '@/lib/metadata/artwork';
interface BulkState {
 scope:string;ready:boolean;error:string;jobs:BulkMetadataJob[];
 hydrate(force?:boolean):Promise<void>;
 start(scope:BulkMetadataScope,title:string,fields:readonly ScrapeField[],overwrite:boolean):Promise<string>;
 resume(id:string,retryFailed?:boolean):Promise<void>;
 stop(id:string,cancel?:boolean):Promise<void>;
}
interface Run { id:string;key:string;op:ScrapeOperation;controller:AbortController;lease?:BackgroundWorkLease;release:()=>void;interrupted:'paused'|'cancelled';task?:Promise<void>; }
let subscribed=false,starting=false,loadVersion=0,running:Run|undefined;
let pendingLoad:{key:string;profile:string;current:()=>boolean;task:Promise<void>}|undefined;
const retired=new Map<string,unknown>();
const retiredProfile=(profile:string)=>retired.has(profile)&&retired.get(profile)===(useAuthStore.getState().auth??useAuthStore.getState().offlineSource);
function installFence(){if(subscribed)return;subscribed=true;useAuthStore.subscribe((next,before)=>{
 if(next.auth!==before.auth||next.offline!==before.offline||next.autoOffline!==before.autoOffline||next.offlineSource!==before.offlineSource){loadVersion++;running?.controller.abort();pendingLoad=undefined;useMetadataBulk.setState({scope:'',ready:false,error:'',jobs:[]});}
});}
function publish(run:Run,job:BulkMetadataJob){if(!run.op.current()||useMetadataBulk.getState().scope!==run.key)return;useMetadataBulk.setState(state=>({jobs:[job,...state.jobs.filter(old=>old.id!==job.id)].slice(0,20)}));run.lease?.update({completed:job.counts.processed,total:Math.max(job.counts.queued,job.counts.processed+(!job.enumerationDone?1:0)),failed:job.counts.failed});}
function newRun(id:string):Run{const controller=new AbortController(),captured=metadataOperation(undefined,controller.signal),op={...captured,current:()=>captured.current()&&!retiredProfile(captured.scope.profile)};if(retiredProfile(op.scope.profile))throw new Error('Metadata profile is being removed');return {id,key:scopeKey(op.scope),op,controller,release:claimMetadataRun('bulk',id,op.current),interrupted:'paused'};}
async function acquire(run:Run){run.lease=await acquireBackgroundWork('metadata',{completed:0,total:1},reason=>{run.interrupted=reason==='cancel'?'cancelled':'paused';run.controller.abort();},run.op.current,run.controller.signal);metadataCheck(run.op);}
async function finishRun(run:Run){try{if(run.op.current())publishLocalCustomizationChanges(run.op.current);await run.lease?.release().catch(()=>{});
 if(run.op.current()){await useLocalMetadata.getState().hydrate(run.op.scope,true).catch(()=>{});await useMetadataBulk.getState().hydrate(true);}
 }finally{run.release();if(running===run)running=undefined;}}
function launch(run:Run,retryFailed=false):Promise<void>{running=run;const task=(async()=>{
 try{
  metadataCheck(run.op);let job=await loadBulkJob(run.id,run.op);if(!job)throw new Error('Metadata task not found');if(retryFailed)job=await retryBulkFailures(run.id,run.op);metadataCheck(run.op);
  const profiles=await readBulkProfiles(run.id,run.op);metadataCheck(run.op);const settings=job.settings,overwrite=job.overwrite&&job.scope.kind!=='missing',auth=useAuthStore.getState(),selectedDirect=!!auth.auth&&!auth.offline;
  if(job.scope.kind==='selected'&&job.selectionMode!==(selectedDirect?'direct':'scan'))job=await updateBulkJob(run.id,value=>({...value,selectionMode:selectedDirect?'direct':'scan',cursor:undefined,selectionPage:0,enumerationDone:false}),run.op);
  await runBulkMetadataJob(run.id,run.op,{
   selectedDirect,readPage:readMetadataCatalogPage,resolveSong:async(id,op)=>{const song=await resolveMetadataCatalogSong(id,op);return song?sourceSong(song):undefined;},missingFields:metadataMissingFields,
   find:async(song,fields,op)=>{const result=await searchMetadata(song,settings,profiles,op,fields.includes('lyrics')?'all':'metadata');metadataCheck(op);const candidate=await resolveMetadataCandidateForFields(result.candidates,fields,profiles,op);metadataCheck(op);if(!candidate&&!result.candidates.length&&result.issues.length)throw new Error('Metadata providers are unavailable');return {candidate,review:result.candidates[0]};},
   apply:async(item,song,candidate,fields,op)=>{await applyMetadataCandidate(song,candidate,fields,overwrite,op,item.intentId,false);metadataCheck(op);if(fields.includes('cover')&&candidate.coverUrl){await fetchMetadataArtwork(candidate.coverUrl,'song',song.id,op,!overwrite?async()=>{const latest=await resolveMetadataCatalogSong(song.id,op);metadataCheck(op);if(!latest||lyricRecordingKey(sourceSong(latest))!==lyricRecordingKey(item.song)||(await metadataMissingFields(latest,['cover'],op)).length===0)throw new Error('Local metadata changed. Review again.');}:undefined);metadataCheck(op);}},
   publish:job=>publish(run,job),
  });
 }catch(error){
  // Abort cancels network work. The captured account/source owner still allows
  // writing its paused checkpoint; an account ABA never gets a fresh owner.
  if(run.op.current()&&!retiredProfile(run.op.scope.profile)){
   const op=metadataOperation(run.op.scope,undefined,run.op.current);
   try{const job=await updateBulkJob(run.id,value=>({...value,status:run.interrupted,error:run.controller.signal.aborted?undefined:'Could not continue this task. Resume to retry.'}),op);publish(run,job);}catch{/* A storage failure must not publish false progress. */}
   if(!run.controller.signal.aborted)useMetadataBulk.setState({error:error instanceof Error&&error.message==='Metadata task not found'?error.message:'Could not continue this task. Resume to retry.'});
  }
 }finally{await finishRun(run);}
 })();run.task=task;return task;}
export const useMetadataBulk=create<BulkState>((set,get)=>({scope:'',ready:false,error:'',jobs:[],
 hydrate(force=false){installFence();const op=metadataOperation(),key=scopeKey(op.scope);if(!op.current()||retiredProfile(op.scope.profile))return Promise.resolve();if(!force&&get().ready&&get().scope===key)return Promise.resolve();if(!force&&pendingLoad?.key===key&&pendingLoad.current())return pendingLoad.task;
  const token=++loadVersion;if(get().scope!==key)set({scope:key,ready:false,error:'',jobs:[]});const task=(async()=>{try{const jobs=await listBulkJobs(op,running?.key===key&&running.op.current()?running.id:undefined);metadataCheck(op);if(token===loadVersion)set({scope:key,ready:true,error:'',jobs});}catch{if(token===loadVersion&&op.current())set({ready:true,error:'Could not load metadata tasks'});}})();pendingLoad={key,profile:op.scope.profile,current:op.current,task};void task.finally(()=>{if(pendingLoad?.task===task)pendingLoad=undefined;});return task;
 },
 async start(scope,title,fields,overwrite){installFence();if(starting)throw new Error('A metadata task is already starting');starting=true;let run:Run|undefined;
  try{run=newRun('starting');await acquire(run);const settingsValue=await readMetadataRecord<MetadataSettings>('settings','main',run.op);metadataCheck(run.op);const settings=validMetadataSettings(settingsValue)?settingsValue:{...DEFAULT_METADATA_SETTINGS};const profiles:ScraperProfile[]=[];
   for(const id of settings.enabled){if((BUILTIN_PROVIDERS as readonly string[]).includes(id))continue;const value=await readMetadataRecord<ScraperProfile>('provider',id,run.op);metadataCheck(run.op);if(value)profiles.push(validateScraperProfile(value));}
   const job=await createBulkJob(scope,title,fields,overwrite,settings,profiles,run.op);metadataCheck(run.op);run.id=job.id;set(state=>({scope:run!.key,ready:true,error:'',jobs:[job,...(state.scope===run!.key?state.jobs:[])].slice(0,20)}));starting=false;void launch(run).catch(()=>{});return job.id;
  }catch(error){if(run){await run.lease?.release().catch(()=>{});run.release();}throw error;}finally{starting=false;}
 },
 async resume(id,retryFailed=false){installFence();if(starting)throw new Error('A metadata task is already starting');starting=true;let run:Run|undefined;
  try{run=newRun(id);await get().hydrate();metadataCheck(run.op);const job=await loadBulkJob(id,run.op);if(!job)throw new Error('Metadata task not found');await acquire(run);metadataCheck(run.op);starting=false;await launch(run,retryFailed);
  }catch(error){if(run&&running!==run){await run.lease?.release().catch(()=>{});run.release();}throw error;}finally{starting=false;}
 },
 async stop(id,cancel=false){const active=running;if(active?.id===id&&active.op.current()){active.interrupted=cancel?'cancelled':'paused';active.controller.abort();await active.task?.catch(()=>{});}
  const op=metadataOperation();if(retiredProfile(op.scope.profile))return;const value=await loadBulkJob(id,op);if(!value)return;const job=await updateBulkJob(id,old=>({...old,status:cancel?'cancelled':'paused',error:undefined}),op);metadataCheck(op);if(get().scope===scopeKey(op.scope))set(state=>({jobs:[job,...state.jobs.filter(old=>old.id!==id)].slice(0,20)}));
 },
}));
/** Account removal retires/aborts before waiting for writes, then clears only
 * that account's database. It must run before closeMediaCacheFor. */
export async function clearBulkMetadataProfile(profile:string):Promise<void>{if(pendingLoad?.profile===profile){loadVersion++;pendingLoad=undefined;}retired.set(profile,useAuthStore.getState().auth??useAuthStore.getState().offlineSource);if(running?.op.scope.profile===profile){const run=running;run.controller.abort();await run.task?.catch(()=>{});}await clearBulkJobRows(profile);if(metadataOperation().scope.profile===profile)useMetadataBulk.setState({scope:'',ready:false,jobs:[],error:''});}
