import type { Song } from '@/api/subsonic';
import { lyricRecordingKey } from '@/lib/lyricDocuments';
import type { BulkMetadataScope } from './catalog';
import { metadataCheck,isMetadataCancelled,type ScrapeField,type ScrapeCandidate,type ScrapeOperation } from './models';
import { loadBulkJob,nextBulkJobItem,readBulkSelectionPage,unqueuedBulkSelections,filterBulkSelectedSongs,appendBulkCatalogPage,checkpointBulkItem,updateBulkJob,type BulkMetadataJob,type BulkMetadataItem } from './bulkJobDb';
export { loadBulkJob,readBulkJobItems } from './bulkJobDb';
export type { BulkMetadataJob,BulkMetadataItem,BulkMetadataCounts } from './bulkJobDb';
export interface BulkMetadataDependencies {
 selectedDirect?:boolean;
 readPage(scope:BulkMetadataScope,cursor:string|undefined,op:ScrapeOperation,options:{fields:readonly ScrapeField[]}):Promise<{songs:Song[];nextCursor?:string;scanned:number;done:boolean;unavailable?:{id:string;issue:string}[]}>;
 resolveSong(id:string,op:ScrapeOperation):Promise<Song|undefined>;
 missingFields(song:Song,fields:readonly ScrapeField[],op:ScrapeOperation):Promise<ScrapeField[]>;
 find(song:Song,fields:readonly ScrapeField[],op:ScrapeOperation):Promise<{candidate?:ScrapeCandidate;review?:ScrapeCandidate}>;
 apply(item:BulkMetadataItem,song:Song,candidate:ScrapeCandidate,fields:readonly ScrapeField[],op:ScrapeOperation):Promise<void>;
 publish(job:BulkMetadataJob):void;
}
/** Scan one bounded page, drain it record by record, then advance the durable
 * cursor. Candidate+intent checkpoint precedes writes, so retries reuse CAS. */
export async function runBulkMetadataJob(id:string,op:ScrapeOperation,deps:BulkMetadataDependencies):Promise<BulkMetadataJob> {
 let job=await loadBulkJob(id,op);if(!job)throw new Error('Metadata task not found');
 job=await updateBulkJob(id,value=>({...value,status:'running',error:undefined}),op);deps.publish(job);
 while(true){
  metadataCheck(op);
  let item=await nextBulkJobItem(id,op);metadataCheck(op);
  if(!item){
   if(job.enumerationDone){
    if(job.scope.kind==='selected'&&deps.selectedDirect===false){const missing=await unqueuedBulkSelections(id,op);if(missing.length){job=await appendBulkCatalogPage(id,{songs:[],unavailable:missing.map(id=>({id,issue:'Metadata recording changed. Review again.'})),scanned:0,done:true},op);deps.publish(job);continue;}}
    job=await updateBulkJob(id,value=>({...value,status:'completed',phase:'complete'}),op);deps.publish(job);return job;}
   job=await updateBulkJob(id,value=>({...value,phase:'enumerating'}),op);deps.publish(job);
   const selected=job.scope.kind==='selected'&&deps.selectedDirect!==false,selectionScan=job.scope.kind==='selected'&&!selected;
   const ids=selected?await readBulkSelectionPage(id,job.selectionPage??0,op):undefined;metadataCheck(op);
   if(selected&&!ids){job=await appendBulkCatalogPage(id,{songs:[],scanned:0,done:true},op,job.selectionPage);deps.publish(job);continue;}
   const scope=selected?{kind:'selected' as const,songIds:ids!}:selectionScan?{kind:'all' as const}:job.scope;
   let page=await deps.readPage(scope,job.cursor,op,{fields:job.fields});metadataCheck(op);
   if(selectionScan)page={...page,songs:await filterBulkSelectedSongs(id,page.songs,op)};
   if(!page.done&&(!page.nextCursor||page.nextCursor===job.cursor))throw new Error('Catalogue cursor did not advance');
   const nextSelection=selected&&page.done?(job.selectionPage??0)+1:job.selectionPage;
   const done=selected?page.done&&nextSelection!>=Math.ceil((job.selectedCount??0)/100):page.done;
   job=await appendBulkCatalogPage(id,{...page,done,nextCursor:selected&&page.done?undefined:page.nextCursor},op,nextSelection);deps.publish(job);
   await new Promise<void>(resolve=>setTimeout(resolve,0));continue;
  }
  if(job.phase!=='processing'){job=await updateBulkJob(id,value=>({...value,phase:'processing'}),op);deps.publish(job);}
  try{
   const song=await deps.resolveSong(item.song.id,op);metadataCheck(op);
   if(!song||lyricRecordingKey(song)!==lyricRecordingKey(item.song)){
    item={...item,status:'review',issue:'Metadata recording changed. Review again.'};
   }else{
    const preserveExisting=!job.overwrite||job.scope.kind==='missing';
    let fields=preserveExisting?await deps.missingFields(song,job.fields,op):job.fields;metadataCheck(op);
    if(!fields.length)item={...item,status:'skipped',issue:undefined};
    else{
     let candidate=item.candidate;
     if(!candidate){const result=await deps.find(song,fields,op);metadataCheck(op);candidate=result.candidate;
      if(!candidate)item={...item,status:'review',candidate:result.review,issue:'No confident metadata match. Review this song.'};}
     if(candidate){
      if(candidate.confident!==true)item={...item,status:'review',candidate,issue:'No confident metadata match. Review this song.'};
      else{
       item={...item,candidate,issue:undefined};job=await checkpointBulkItem(id,item,op);deps.publish(job);metadataCheck(op);
       // A queued provider response must not replace a manual edit made while
       // the request was in flight, including newly cached cover/lyrics.
       const latest=await deps.resolveSong(item.song.id,op);metadataCheck(op);
       if(!latest||lyricRecordingKey(latest)!==lyricRecordingKey(item.song))item={...item,status:'review',issue:'Metadata recording changed. Review again.'};
       else{
        fields=preserveExisting?await deps.missingFields(latest,fields,op):fields;metadataCheck(op);
        if(!fields.length)item={...item,status:'skipped'};
        else{await deps.apply(item,latest,candidate,fields,op);metadataCheck(op);item={...item,status:'done'};}
       }
      }
     }
    }
   }
  }catch(error){if(isMetadataCancelled(error)||!op.current()||op.signal?.aborted)throw error;const conflict=error instanceof Error&&error.message==='Local metadata changed. Review again.';item={...item,status:conflict?'review':'failed',issue:conflict?error.message:'Could not complete this song'};}
  job=await checkpointBulkItem(id,item,op);metadataCheck(op);deps.publish(job);
  await new Promise<void>(resolve=>setTimeout(resolve,0));
 }
}

/** Lazy bridge avoids loading the UI store while auth/profile cleanup initializes. */
export async function clearBulkMetadataProfile(profile:string):Promise<void>{const store=await import('@/store/metadataBulk');await store.clearBulkMetadataProfile(profile);}
