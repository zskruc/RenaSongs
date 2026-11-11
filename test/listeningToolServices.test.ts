import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';

const deferred = <T,>() => { let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function harness() {
  const root=mkdtempSync(join(tmpdir(),'resonus-listening-test-')),uri=pathToFileURL(root+'/').href;
  const hashKey=(value:string)=>createHash('sha256').update(value).digest('hex');
  const auth=createStore<any>(()=>({auth:{profile:'A'},offline:false,autoOffline:false}));
  const profileScopeId=()=>auth.getState().auth?.profile??'local';
  let source='server';const scope=()=>({profile:profileScopeId(),source});
  const cache=new Map<string,unknown>(),writes:string[]=[],prunes:any[]=[],released:string[]=[],canceled:string[]=[],requests:any[]=[],prepared:any[]=[],analyses:any[]=[],translated:any[]=[];
  const timers=new Map<object,()=>void>(),secrets=new Map<string,string>();
  let infoGate:undefined|(()=>Promise<void>),cacheRead:undefined|((key:string)=>Promise<any>),prepare:undefined|(()=>Promise<any>),analyze:undefined|(()=>Promise<any>),translate:undefined|(()=>Promise<any>),network:undefined|(()=>Promise<Response>);
  let fsNoMtime=false, getInfoCalls=0,secretWrite:undefined|(()=>Promise<void>);
  const sourceFile=join(root,'music.mp3');writeFileSync(sourceFile,'first audio identity');
  const wav=join(root,'prepared.wav');writeFileSync(wav,'wav');
  const fs:any={documentDirectory:uri,cacheDirectory:uri,EncodingType:{Base64:'base64'},
    getInfoAsync:async(value:string,options?:{md5?:boolean})=>{getInfoCalls++;await infoGate?.();const path=fileURLToPath(value);try{const stat=statSync(path);return {exists:true,isDirectory:stat.isDirectory(),size:stat.size,modificationTime:fsNoMtime?undefined:stat.mtimeMs/1000,...(options?.md5?{md5:hash('md5',readFileSync(path))}:{})};}catch{return {exists:false};}},
    readAsStringAsync:async(value:string)=>readFileSync(fileURLToPath(value)).toString('base64')};
  const nativeAudio={uri:uri+'alignment-audio/alignment-test.wav',mime:'audio/wav',bytes:160044,durationSec:5,physicalStartSec:0,sampleRate:16000,channels:1,temporary:true};
  mkdirSync(join(root,'alignment-audio'));writeFileSync(fileURLToPath(nativeAudio.uri),'wav');
  const response={lines:[{id:'0',status:'aligned',words:[{text:'hello',start:0,end:1}]}]};
  const measurement={integratedLufs:-20.691,samplePeak:.5,blockEnergies:[.01,.01],durationSec:1,sampleRate:48000,channels:2,frames:48000,complete:true,algorithm:'bs1770-r128-v1'};
  const modules:Record<string,any>={};
  const imports:Record<string,any>={
    'expo-file-system/legacy':fs,'react-native':{AppState:{currentState:'active',addEventListener(){}}},
    zustand:{create:(initializer:any)=>createStore(initializer)},
    '@/store/auth':{profileScopeId,useAuthStore:auth},
    '@/store/downloads':{useDownloads:{getState:()=>({files:{}})}},
    '@/store/podcastDownloads':{usePodcastDownloads:{getState:()=>({scope:hashKey(profileScopeId()),files:{}})}},
    '@/store/songCache':{cachedUri:()=>undefined},'./localLibrary':{hashKey},
    './listeningExtras':{readListeningExtra:async(key:string,_scope:any,current:()=>boolean)=>{if(!current())throw Error('owner');return cacheRead?cacheRead(key):cache.get(key);},
      writeListeningExtra:async(key:string,value:any,_scope:any,current:()=>boolean)=>{if(!current())throw Error('owner');writes.push(key);cache.set(key,value);},pruneListeningCache:async(...args:any[])=>{prunes.push(args);}},
    './storage':{getItem:async(key:string)=>secrets.get(key)??null,setItemStrict:async(key:string,value:string)=>{await secretWrite?.();secrets.set(key,value);}},'@/api/netGate':{isManualOffline:()=>auth.getState().offline===true},
    '../../modules/listening-tools':{prepareAlignmentAudio:async(request:any)=>{prepared.push(request);return prepare?prepare():nativeAudio;},releaseAlignmentAudio:(uri:string)=>released.push(uri),cancelAlignmentAudio:(id:string)=>canceled.push(id),
      analyzeLoudness:async(request:any)=>{analyses.push(request);return analyze?analyze():measurement;},cancelLoudness:(id:string)=>canceled.push(id)},
    '../../modules/offline-translation':{offlineTranslation:{translate:async(...args:any[])=>{translated.push(args);return translate?translate():['你好'];}}},
    './currentContentKind':{isSpokenContent:(song:any)=>song.mediaKind==='audiobook'||song.mediaKind==='podcast'||!!song.podcastChannelId},
    'expo/fetch':{fetch:async(url:string,init:any)=>{requests.push({url,init});return network?network():new Response(JSON.stringify(response));}},
  };
  function load(name:string) {if(modules[name])return modules[name];const exports:any={};modules[name]=exports;
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {exports,require:(id:string)=>{if(id in imports)return imports[id];if(id.startsWith('./'))return load(id.slice(2));throw Error('unmocked '+id);},URL,TextEncoder,TextDecoder,AbortController,console,
        setTimeout:(callback:()=>void)=>{const id={};timers.set(id,callback);return id;},clearTimeout:(id:object)=>timers.delete(id)});
    return exports;}
  const owner=load('lyricOwner');
  imports['./localCustomizations']={customizationScope:scope,captureCustomizationOwner:(expected:any,extra=()=>true)=>{const current=owner.captureLyricOwner(expected.profile);return ()=>current()&&extra()&&scope().source===expected.source;}};
  // Local-library URIs are accepted only with no active server credentials.
  auth.setState({auth:undefined});
  const song:any={id:'track',title:'Track',localUri:pathToFileURL(sourceFile).href,albumId:'album'},document:any={synced:true,lines:[{start:0,value:'hello'}]};
  return {load,song,document,secrets,setSecretWrite(fn:()=>Promise<void>){secretWrite=fn;},setSource(value:string){source=value;auth.setState({offlineSource:{mode:'folder',folders:[value]}});},measurement,nativeAudio,root,auth,cache,writes,prunes,released,canceled,requests,prepared,analyses,translated,sourceFile,
    profileABA(){const a=auth.getState().auth;auth.setState({auth:{profile:'B'}});auth.setState({auth:a});},
    setPrepare(fn:()=>Promise<any>){prepare=fn;},setAnalyze(fn:()=>Promise<any>){analyze=fn;},setTranslate(fn:()=>Promise<any>){translate=fn;},setNetwork(fn:()=>Promise<Response>){network=fn;},setCacheRead(fn:(key:string)=>Promise<any>){cacheRead=fn;},
    setInfoGate(fn:()=>Promise<void>){infoGate=fn;},noMtime(){fsNoMtime=true;},infoCount:()=>getInfoCalls,
    expire(){for(const callback of [...timers.values()])callback();},dispose(){rmSync(root,{recursive:true,force:true});}};
}
function hash(kind:string,value:Buffer){return createHash(kind).update(value).digest('hex');}
const settings={endpoint:'https://alignment.example/v1/audio/alignments',language:'English'};

test('explicit alignment hashes actual source bytes before and after preparation; mutation never uploads',async()=>{const h=harness();try{
  const service=h.load('lyricAlignmentService');h.setPrepare(async()=>{writeFileSync(h.sourceFile,'changed original file');return h.nativeAudio;});
  await assert.rejects(service.alignLocalLyrics('mutation',h.song,h.document,settings,()=>true,()=>{}),/changed/);
  assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);assert.deepEqual(h.released,[h.nativeAudio.uri]);
}finally{h.dispose();}});
test('cancel promptly settles a held native preparation and cleans a WAV that arrives later',async()=>{const h=harness();try{
  const pending=deferred<any>();h.setPrepare(()=>pending.promise);const service=h.load('lyricAlignmentService');
  const work=service.alignLocalLyrics('cancel',h.song,h.document,settings,()=>true,()=>{});await tick();service.cancelLyricAlignment('cancel');
  await assert.rejects(work,/canceled/);pending.resolve(h.nativeAudio);await tick();assert.deepEqual(h.released,[h.nativeAudio.uri]);assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);
}finally{h.dispose();}});
test('timeout and account ABA both reject held alignment and release late temporary output',async()=>{for(const mode of ['timeout','account'] as const){const h=harness();try{
  const pending=deferred<any>();h.setPrepare(()=>pending.promise);const service=h.load('lyricAlignmentService');const work=service.alignLocalLyrics(mode,h.song,h.document,settings,()=>true,()=>{});await tick();
  if(mode==='timeout')h.expire();else h.profileABA();await assert.rejects(work,/canceled/);pending.resolve(h.nativeAudio);await tick();assert.equal(h.released.length,1);assert.equal(h.writes.length,0);
}finally{h.dispose();}}});
test('successful alignment releases WAV and a validated cache hit does not decode or upload again',async()=>{const h=harness();try{
  // Native owns its private path; bridge FS uses the same valid bytes for upload.
  const fsPath=fileURLToPath(h.nativeAudio.uri);writeFileSync(fsPath,'wav');
  const service=h.load('lyricAlignmentService'),first=await service.alignLocalLyrics('ok',h.song,h.document,settings,()=>true,()=>{});
  assert.equal(first.lines[0].words[0].value,'hello');assert.equal(h.released.length,1);assert.equal(h.requests.length,1);
  const second=await service.alignLocalLyrics('cached',h.song,h.document,settings,()=>true,()=>{});assert.equal(second.lines[0].words[0].start,0);assert.equal(h.prepared.length,1);assert.equal(h.requests.length,1);assert.equal(h.prunes[0][1],20*1024*1024);
}finally{h.dispose();}});
test('missing mtime hashes local bytes for cache identity and changed documents cannot publish a translation',async()=>{const h=harness();try{
  h.noMtime();const owned=h.load('ownedAudio'),one=await owned.ownedAudioIdentity(h.song);writeFileSync(h.sourceFile,'second audio identity');const two=await owned.ownedAudioIdentity(h.song);assert.notEqual(one.key,two.key);assert.match(two.md5,/^[0-9a-f]{32}$/);
  const pending=deferred<string[]>();h.setTranslate(()=>pending.promise);const service=h.load('lyricTranslation');let current=true;const work=service.translateLyricDocument('doc',h.document,'en','zh',()=>current);await tick();current=false;pending.resolve(['你好']);await assert.rejects(work,/owner/);assert.equal(h.writes.length,0);
}finally{h.dispose();}});
test('translation rejects invalid cache/native payloads and prunes successful bounded results',async()=>{const h=harness();try{
  const service=h.load('lyricTranslation');h.setCacheRead(async()=>({not:'lines'}));const translated=await service.translateLyricDocument('translate',h.document,'en','zh',()=>true);assert.equal(translated.lines[0].translation,'你好');assert.equal(h.prunes[0][0],'translation:');assert.equal(h.prunes[0][1],20*1024*1024);
  h.setTranslate(async()=>['x'.repeat(16001)]);await assert.rejects(service.translateLyricDocument('large',h.document,'en','zh',()=>true),/match/);assert.equal(h.writes.length,1);
}finally{h.dispose();}});
test('loudness cache validation rejects corrupt finite flags, energy/peak/timing and identity mismatch',async()=>{const h=harness();try{
  const service=h.load('loudnessTools');assert.equal(service.validLoudnessMeasurement(h.measurement),true);
  for(const patch of [{integratedLufs:NaN},{samplePeak:Infinity},{samplePeak:-1},{blockEnergies:[-1]},{blockEnergies:[.1]},{frames:1},{durationSec:Infinity},{complete:false}])assert.equal(service.validLoudnessMeasurement({...h.measurement,...patch}),false);
  const file=await h.load('ownedAudio').ownedAudioIdentity(h.song);h.cache.set('loudness:'+file.key,{version:1,identity:'different',measurement:h.measurement});await service.prepareLoudnessSnapshot(h.song,true);assert.equal(service.frozenLoudnessGain(h.song),undefined);
}finally{h.dispose();}});
test('loudness analysis refuses a file changed during decode and never changes an installed gain',async()=>{const h=harness();try{
  const service=h.load('loudnessTools');h.setAnalyze(async()=>{writeFileSync(h.sourceFile,'changed after analysis');return h.measurement;});await assert.rejects(service.analyzeLocalSongs([h.song]),/changed/);assert.equal(h.writes.length,0);assert.equal(service.frozenLoudnessGain(h.song),undefined);
}finally{h.dispose();}});
test('existing ReplayGain wins and automatic local analysis excludes spoken/radio content',async()=>{const h=harness();try{
  const service=h.load('loudnessTools');h.setCacheRead(async(key)=>key==='loudness-preferences'?{analyzeMissing:true}:undefined);await service.hydrateLoudnessPreferences();
  for(const song of [{...h.song,mediaKind:'audiobook'},{...h.song,podcastChannelId:'show'},{...h.song,id:'localradio:test'},{...h.song,replayGain:{trackGain:-2}}])service.maybeAnalyzeMissingLoudness(song);
  await tick();assert.equal(h.analyses.length,0);const before=h.infoCount();await service.prepareLoudnessSnapshot({...h.song,replayGain:{trackGain:-2}},true);assert.equal(h.infoCount(),before);
  service.maybeAnalyzeMissingLoudness(h.song);await tick();await tick();assert.equal(h.analyses.length,1);
}finally{h.dispose();}});
test('newer same-track gain preparation cannot be overwritten by an older held cache read',async()=>{const h=harness();try{
  const service=h.load('loudnessTools'),pending=deferred<any>();let reads=0;
  const file=await h.load('ownedAudio').ownedAudioIdentity(h.song);h.setCacheRead(async(key)=>{if(!key.startsWith('loudness:'))return;reads++;if(reads===1)return pending.promise;return {version:1,identity:file.key,measurement:h.measurement};});
  const first=service.prepareLoudnessSnapshot(h.song,true);await tick();await service.prepareLoudnessSnapshot(h.song,true);assert.ok(Math.abs(service.frozenLoudnessGain(h.song).trackGain-2.691)<.0001);
  pending.resolve(undefined);await first;assert.ok(Math.abs(service.frozenLoudnessGain(h.song).trackGain-2.691)<.0001);
}finally{h.dispose();}});

test('alignment aborts a held service request and source mutation before its reply cannot be cached',async()=>{for(const mutation of [false,true]){const h=harness();try{
 const pending=deferred<Response>();h.setNetwork(()=>pending.promise);const service=h.load('lyricAlignmentService');const work=service.alignLocalLyrics('network',h.song,h.document,settings,()=>true,()=>{});await tick();assert.equal(h.requests.length,1);
 if(mutation){writeFileSync(h.sourceFile,'edited while server worked');pending.resolve(new Response(JSON.stringify({lines:[{id:'0',status:'aligned',words:[{text:'hello',start:0,end:1}]}]})));await assert.rejects(work,/changed/);}
 else{service.cancelLyricAlignment('network');await assert.rejects(work,/canceled/);pending.resolve(new Response('{}'));await tick();}
 assert.equal(h.writes.length,0);assert.equal(h.released.length,1);
}finally{h.dispose();}}});
test('server tools reject a previous account localUri even if its song ID is reused',()=>{const h=harness();try{const owned=h.load('ownedAudio'),hash=(value:string)=>createHash('sha256').update(value).digest('hex');h.auth.setState({auth:{profile:'A'}});const own=pathToFileURL(join(h.root,'downloads',hash('A'),'song.mp3')).href,foreign=pathToFileURL(join(h.root,'downloads',hash('B'),'song.mp3')).href;assert.equal(owned.ownedAudioUri({...h.song,localUri:foreign}),undefined);assert.equal(owned.ownedAudioUri({...h.song,localUri:own}),own);}finally{h.dispose();}});

test('alignment credentials are bound to the exact endpoint and source; address changes require re-entry',async()=>{const h=harness();try{
 const service=h.load('lyricAlignmentService');await service.saveAlignmentSettings(settings,'host-A-secret');await service.saveAlignmentSettings({...settings,language:'Chinese'});await service.alignLocalLyrics('bound',h.song,h.document,settings,()=>true,()=>{});assert.equal(h.requests[0].init.headers.authorization,'Bearer host-A-secret');assert.equal(h.requests[0].init.redirect,'error');
 const other={...settings,endpoint:'https://other.example/align'};await service.saveAlignmentSettings(other);await service.alignLocalLyrics('other',h.song,h.document,other,()=>true,()=>{});assert.equal(h.requests[1].init.headers.authorization,undefined);assert.equal(JSON.parse([...h.secrets.values()][0]).token,'');
 await service.saveAlignmentSettings(other,'host-B-secret');h.cache.clear();h.setSource('folder:other');await service.alignLocalLyrics('new-source',h.song,h.document,other,()=>true,()=>{});assert.equal(h.requests[2].init.headers.authorization,undefined);await service.saveAlignmentSettings(other);assert.equal(JSON.parse([...h.secrets.values()][0]).token,'');
}finally{h.dispose();}});
test('legacy unbound raw credentials and exact-path changes never silently send old Bearer values',async()=>{const h=harness();try{
 const key='resonus.alignment.token.'+createHash('sha256').update('local').digest('hex');h.secrets.set(key,'legacy-secret');const service=h.load('lyricAlignmentService');await service.alignLocalLyrics('legacy',h.song,h.document,settings,()=>true,()=>{});assert.equal(h.requests[0].init.headers.authorization,undefined);
 await service.saveAlignmentSettings(settings);assert.deepEqual(JSON.parse(h.secrets.get(key)!),{version:1,source:'server',endpoint:settings.endpoint,token:''});await service.saveAlignmentSettings(settings,'path-secret');const path={...settings,endpoint:settings.endpoint+'/new'};await service.alignLocalLyrics('path',h.song,h.document,path,()=>true,()=>{});assert.equal(h.requests[1].init.headers.authorization,undefined);
}finally{h.dispose();}});

test('credential saves serialize destinations and profile deletion drains an already accepted native write',async()=>{for(const deleting of [false,true]){const h=harness();try{
 const service=h.load('lyricAlignmentService'),pending=deferred<void>();let writes=0;h.setSecretWrite(()=>++writes===1?pending.promise:Promise.resolve());
 const first=service.saveAlignmentSettings(settings,'first-secret');const outcome=first.then(()=>undefined,(error:Error)=>error);await tick();assert.equal(writes,1);
 if(deleting){h.profileABA();let drained=false;const drain=service.drainAlignmentCredentialWrites('local').then(()=>{drained=true;});await tick();assert.equal(drained,false);pending.resolve();await drain;assert.match(String(await outcome),/profile changed/);h.secrets.clear();await tick();assert.equal(h.secrets.size,0,'profile key stays deleted after draining native writes');}
 else{const other={...settings,endpoint:'https://second.example/align'},second=service.saveAlignmentSettings(other);await tick();assert.equal(writes,1);pending.resolve();await first;await second;const saved=JSON.parse([...h.secrets.values()][0]);assert.equal(saved.endpoint,other.endpoint);assert.equal(saved.token,'');assert.equal(h.cache.get('alignment-settings')&& (h.cache.get('alignment-settings') as any).endpoint,other.endpoint);}
}finally{h.dispose();}}});
