import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as cueLease from '../src/lib/cueDeletionLease';
import { cueSongs, cueFileName } from '../src/lib/cue';
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function deferred() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }
function load(path: string, imports: Record<string, any>, globals = {}) {
 const exports: Record<string, any> = {};
 runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Date,setTimeout,...globals,require:(key:string)=>{assert.ok(Object.hasOwn(imports,key),key);return imports[key];}}); return exports;
}
function harness(profile = 'A') {
 const scope={profile,source:'server'}, files=new Map<string,string>(), removed:string[]=[]; let epoch=0,queue:any[]=[],failDelete=false,failWrite=false;
 let readGate:Promise<void>|undefined,unlinkGate:Promise<void>|undefined,copyGate:Promise<void>|undefined,writeGate:Promise<void>|undefined;
 const raw=new DatabaseSync(':memory:'); const params=(args:any[])=>args.length===1&&Array.isArray(args[0])?args[0]:args;
 const db:any={execAsync:async(sql:string)=>raw.exec(sql),getFirstAsync:async(sql:string,...args:any[])=>{if(readGate&&sql.includes('FROM listening_extras')){const gate=readGate;readGate=undefined;await gate;}return raw.prepare(sql).get(...params(args));},
  getAllAsync:async(sql:string,...args:any[])=>raw.prepare(sql).all(...params(args)),runAsync:async(sql:string,...args:any[])=>{if(writeGate){const gate=writeGate;writeGate=undefined;await gate;}if(failWrite)throw Error('Disk full');return raw.prepare(sql).run(...params(args));},
  withTransactionAsync:async(work:()=>Promise<void>)=>{raw.exec('BEGIN');try{await work();raw.exec('COMMIT');}catch(e){raw.exec('ROLLBACK');throw e;}}};
 const media={mediaCacheDatabase:async()=>db},local={hashKey:(value:string)=>value.replace(/[^a-z0-9]/gi,'_')};
 const ownership={customizationScope:()=>scope,captureCustomizationOwner:()=>{const token=epoch;return()=>token===epoch;}};
 const extras=load('lib/listeningExtras.ts',{'./mediaCacheDb':media,'./localLibrary':local,'./localCustomizations':ownership});
 const fs={documentDirectory:'file:///app/',EncodingType:{Base64:'base64'},makeDirectoryAsync:async()=>{},
  copyAsync:async({from,to}:{from:string;to:string})=>{if(copyGate){const gate=copyGate;copyGate=undefined;await gate;}files.set(to,files.get(from)??'original');},
  deleteAsync:async(path:string)=>{if(unlinkGate){const gate=unlinkGate;unlinkGate=undefined;await gate;}if(failDelete)throw Error('Unlink failed');removed.push(path);for(const key of files.keys())if(key.startsWith(path))files.delete(key);}};
 const player={getState:()=>({queue})};
 const api=load('lib/cueLibrary.ts',{'expo-file-system/legacy':fs,'./localLibrary':local,'./listeningExtras':extras,'@/store/player':{usePlayerStore:player},'./cueDeletionLease':cueLease,'./mediaCacheDb':media});
 const song=(id:string)=>({id:`cue:${id}:1`,title:id,cueSourceId:id,cueStartSec:0,mediaKind:'music',localUri:api.cueImportDirectory(scope)+id+'/disc.flac',url:api.cueImportDirectory(scope)+id+'/disc.flac'});
 return{scope,files,removed,raw,fs,api,extras,song,owns:()=>{const token=epoch;return()=>token===epoch;},switch:()=>{epoch++;},queue:(value:any[])=>{queue=value;},
  holdRead:(value:Promise<void>)=>{readGate=value;},holdUnlink:(value:Promise<void>)=>{unlinkGate=value;},holdCopy:(value:Promise<void>)=>{copyGate=value;},holdWrite:(value:Promise<void>)=>{writeGate=value;},failDelete:(v:boolean)=>{failDelete=v;},failWrite:(v:boolean)=>{failWrite=v;},
  media,local,ownership};
}
test('real SQL appends are atomic, preserve simultaneous imports and reject duplicates/over500 without replacing the catalog',async()=>{
 const h=harness();await Promise.all([h.api.appendCueTracks([h.song('first')],h.scope,h.owns()),h.api.appendCueTracks([h.song('second')],h.scope,h.owns())]);
 assert.equal((await h.extras.readListeningExtra('cue-catalog',h.scope,h.owns())).length,2);
 await assert.rejects(h.api.appendCueTracks([h.song('first')],h.scope,h.owns()),/already exists/);
 await h.api.appendCueTracks(Array.from({length:498},(_,i)=>h.song(`item${i}`)),h.scope,h.owns());
 await assert.rejects(h.api.appendCueTracks([h.song('overflow')],h.scope,h.owns()),/500/);assert.equal((await h.extras.readListeningExtra('cue-catalog',h.scope,h.owns())).length,500);
 await assert.rejects(h.api.appendCueTracks([{...h.song('bad'),localUri:'file:///external/disc.flac'}],h.scope,h.owns()),/Invalid/);
});
test('a queue change while the catalog read is held prevents clearing any files or rows',async()=>{
 const h=harness(),song=h.song('queued');await h.api.appendCueTracks([song],h.scope,h.owns());h.files.set(song.localUri,'audio');
 const gate=deferred();h.holdRead(gate.promise);const clear=h.api.clearCueTracks(h.scope,h.owns());await tick();h.queue([song]);gate.resolve();
 await assert.rejects(clear,/playback queue/);assert.equal(h.files.get(song.localUri),'audio');assert.equal(h.removed.length,0);assert.equal((await h.extras.readListeningExtra('cue-catalog',h.scope,h.owns())).length,1);
 assert.equal(cueLease.cueDeletionBlocked(song),false);
});
test('cleanup excludes imports/playback for the complete native unlink window, then allows a new independent import',async()=>{
 const h=harness(),old=h.song('old');await h.api.appendCueTracks([old],h.scope,h.owns());h.files.set(old.localUri,'audio');
 const gate=deferred();h.holdUnlink(gate.promise);const clear=h.api.clearCueTracks(h.scope,h.owns());await tick();
 assert.equal(cueLease.cueDeletionBlocked(old),true);assert.throws(()=>h.api.beginCueImport(h.scope),/cleared/);
 await assert.rejects(h.api.appendCueTracks([h.song('new')],h.scope,h.owns()),/owner changed/);gate.resolve();await clear;
 assert.equal(cueLease.cueDeletionBlocked(old),false);const lease=h.api.beginCueImport(h.scope);try{await h.api.reserveCueImport(h.scope,lease.current,1);const song=h.song('new');h.files.set(song.localUri,'new');await h.api.appendCueTracks([song],h.scope,lease.current);}finally{lease.release();}
 assert.equal((await h.extras.readListeningExtra('cue-catalog',h.scope,h.owns()))[0].id,'cue:new:1');
});
test('unlink and post-unlink SQL failures leave a visible retryable catalog and never remove original documents',async()=>{
 const h=harness(),song=h.song('retry');await h.api.appendCueTracks([song],h.scope,h.owns());h.files.set(song.localUri,'audio');h.files.set('content://original/disc','original');
 h.failDelete(true);await assert.rejects(h.api.clearCueTracks(h.scope,h.owns()),/Unlink failed/);h.failDelete(false);
 assert.equal((await h.extras.readListeningExtra('cue-catalog',h.scope,h.owns())).length,1);h.failWrite(true);await assert.rejects(h.api.clearCueTracks(h.scope,h.owns()),/Disk full/);h.failWrite(false);
 assert.equal((await h.extras.readListeningExtra('cue-catalog',h.scope,h.owns())).length,1);await h.api.clearCueTracks(h.scope,h.owns());assert.equal((await h.extras.readListeningExtra('cue-catalog',h.scope,h.owns())).length,0);
 assert.equal(h.files.get('content://original/disc'),'original');assert.ok(h.removed.every(path=>path.startsWith(h.api.cueImportDirectory(h.scope))));
});
test('actual UI import holds its job through a native copy and compensating unlink; profile stop waits before any database can close',async()=>{
 const h=harness();h.files.set('content://original/disc','original');const tracks=[{file:'disc.flac',number:1,title:'Track',start:0}];
 const source=ts.createSourceFile('cue-import.tsx',readFileSync(new URL('../src/app/cue-import.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let fn:ts.FunctionDeclaration|undefined;
 const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='importAudio')fn=node;ts.forEachChild(node,visit);};visit(source);assert.ok(fn);
 const context:any={exports:{},scope:h.scope,tracks,Date,DocumentPicker:{getDocumentAsync:async()=>({canceled:false,assets:[{uri:'content://original/disc',name:'disc.flac'}]})},FileSystem:h.fs,cueFileName,cueSongs,hashKey:h.local.hashKey,...h.api,setSongs:()=>assert.fail('retired import cannot publish a catalog')};
 runInNewContext(ts.transpileModule(fn.getText(source)+'\nexports.importAudio=importAudio;', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 const gate=deferred();h.holdCopy(gate.promise);const work=context.exports.importAudio(h.owns());await tick();let stopped=false;
 const stop=h.api.stopCueProfile('A').then((release:()=>void)=>{stopped=true;return release;});await tick();assert.equal(stopped,false);gate.resolve();await assert.rejects(work,/canceled/);
 const release=await stop;try{assert.equal(stopped,true);await h.extras.drainListeningExtrasProfile('A');await h.api.clearCueProfile('A');assert.equal([...h.files.keys()].some(key=>key.startsWith('file:///app/')),false);assert.equal(h.files.get('content://original/disc'),'original');assert.throws(()=>h.api.beginCueImport(h.scope),/removed/);}finally{release();}
 const again=h.api.beginCueImport(h.scope);again.release();
});

test('concurrent profile cleanup leases stay closed until every owner releases, including duplicate releases',async()=>{
 const h=harness(), importing=h.api.beginCueImport(h.scope);let stopped=0;
 const first=h.api.stopCueProfile('A').then((release:()=>void)=>{stopped++;return release;});
 const second=h.api.stopCueProfile('A').then((release:()=>void)=>{stopped++;return release;});
 await tick();assert.equal(stopped,0);assert.equal(importing.current(),false);assert.throws(()=>h.api.beginCueImport(h.scope),/removed/);
 importing.release();const releaseFirst=await first,releaseSecond=await second;assert.equal(stopped,2);
 releaseFirst();releaseFirst();assert.throws(()=>h.api.beginCueImport(h.scope),/removed/);
 await assert.rejects(h.api.reserveCueImport(h.scope,h.owns(),1),/owner changed/);
 releaseSecond();const fresh=h.api.beginCueImport(h.scope);assert.equal(fresh.current(),true);fresh.release();
});

test('the actual profile cleanup retires ownership and drains SQL before CUE cleanup, database close and file removal',async()=>{
 const h=harness('scope|A'),events:string[]=[];const song=h.song('old');await h.api.appendCueTracks([song],h.scope,h.owns());h.files.set(song.localUri,'owned');h.files.set('content://original/disc','original');
 const gate=deferred();h.holdWrite(gate.promise);const write=h.extras.writeListeningExtra('held-write',{safe:true},h.scope,h.owns());await tick();
 const noop=async()=>{},clear=()=>events.push('clear');
 const modules:Record<string,any>={
  'expo-file-system/legacy':h.fs,'./downloadsDb':{closeCatalog:noop},'./localLibrary':h.local,'./mediaCacheDb':{...h.media,closeMediaCacheFor:async()=>{assert.ok(events.includes('drained'));assert.ok(events.includes('bulk-drained'));events.push('close');}},
  './mirrorDb':{closeMirrorFor:noop},'./mirrorCovers':{removeMirrorCovers:noop},'./podcastDb':{closePodcastDb:noop,podcastDbDir:()=> 'file:///app/podcast/'},
  './serverUrls':{primaryUrl:()=> 'scope'},'./songCacheDb':{closeCacheDb:noop},'./storage':{deleteItem:noop},'@/store/offlineQueue':{stopOfflineQueueProfile:noop},
  './cueLibrary':h.api,'./podcastStorage':{stopPodcastStorageProfile:noop},'./playbackCheckpoint':{clearPlaybackCheckpoint:noop},
  './listeningDb':{clearMusicToolsProfile:noop},'@/store/silenceTrim':{clearSilenceTrimProfile:noop},'@/store/longAudio':{clearLongAudioProfile:noop},'@/store/podcastPreferences':{clearPodcastPreferencesProfile:noop},
  './localCustomizations':{clearLocalCustomizationsProfile:async()=>{events.push('retire');h.switch();}},'@/store/discoveryPreferences':{clearDiscoveryProfile:noop},'@/store/listeningTools':{clearListeningToolsProfile:noop},
  '@/store/playlistRecovery':{clearPlaylistRecoveryProfile:noop},'./musicDiscoveryIndex':{clearMusicDiscoveryProfile:noop},'@/store/pendingSongMarks':{clearPendingSongMarksProfile:noop},
  '@/store/playlistRecoveryJournal':{clearRecoveryJournalsProfile:noop},'@/store/pins':{clearPinsProfile:noop},'./personalPlaybackBackup':{clearPersonalPlaybackProfile:noop},
  './metadata/repository':{clearMetadataProfile:clear},'./recentlyDeleted':{clearRecentlyDeletedProfile:clear},
  '@/store/metadataBulk':{clearBulkMetadataProfile:async(profile:string)=>{assert.equal(profile,'scope|A');assert.ok(events.includes('retire'));events.push('bulk-drained');}},
  './lyricAlignmentService':{drainAlignmentCredentialWrites:noop},
  './listeningExtras':{drainListeningExtrasProfile:async(profile:string)=>{events.push('drain');await h.extras.drainListeningExtrasProfile(profile);events.push('drained');}},
 };
 const production=load('lib/profileData.ts',modules);let complete=false;const deletion=production.deleteProfileData({username:'A'}).then(()=>{complete=true;});
 await tick();assert.equal(complete,false);assert.equal(events.includes('close'),false);gate.resolve();await assert.rejects(write,/owner changed/);await deletion;
 assert.ok(events.indexOf('retire')<events.indexOf('drain'));assert.ok(events.indexOf('drained')<events.indexOf('close'));
 assert.equal(h.raw.prepare("SELECT data FROM listening_extras WHERE key='held-write'").get(),undefined);assert.equal(h.files.has(song.localUri),false);assert.equal(h.files.get('content://original/disc'),'original');
 const lease=h.api.beginCueImport(h.scope);lease.release();
});
