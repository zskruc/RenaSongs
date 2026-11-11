import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { parsePodcastTranscript, preferredPodcastTranscripts } from '../src/lib/podcastTranscript';
import { createEndpointReader } from '../src/lib/httpCooldown';
const executable=ts.transpileModule(readFileSync(new URL('../src/lib/publisherTranscript.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness(options: { response?: () => unknown; timer?: (callback: () => void) => unknown } = {}){let profile='A',epoch=0,offline=false,calls=0,release=0,body='WEBVTT\n\n00:01.000 --> 00:02.000\nHello';const cached=new Map<string,string>(),writes:string[]=[];let held:Promise<void>|undefined;
 const episode={id:'episode',channelId:'show',transcripts:[{url:'https://publisher.test/text.vtt',type:'text/vtt'}]};
 const dependencies:Record<string,unknown>={
  'expo/fetch':{fetch:async()=>{calls++;await held;return options.response ? options.response() : new Response(body,{status:200});}},
  '@/api/netGate':{isManualOffline:()=>offline},'@/store/auth':{profileScopeId:()=>profile,useAuthStore:{getState:()=>({offline})}},
  './localLibrary':{hashKey:(v:string)=>v},'./lyricOwner':{captureLyricOwner:()=>{const initial=epoch;return()=>initial===epoch;}},
  './podcastDb':{getEpisode:async()=>episode,readPodcastTranscript:async(scope:string)=>cached.get(scope),savePodcastTranscript:async(scope:string,_id:string,_channel:string,_url:string,data:string,current:()=>boolean)=>{assert.equal(current(),true);cached.set(scope,data);writes.push(scope);}},
  './podcastTranscript':{parsePodcastTranscript,preferredPodcastTranscripts},'./httpCooldown':{readDiscoveryEndpoint:createEndpointReader()},
  './podcastStorageLease':{protectPodcastStorageChannel:()=>()=>{release++;}},
 };const exports:Record<string,any>={};runInNewContext(executable,{exports,AbortController,TextDecoder,setTimeout: options.timer ?? setTimeout,clearTimeout: options.timer ? () => {} : clearTimeout,require:(name:string)=>{assert.ok(name in dependencies,name);return dependencies[name];}});
 return{read:(current=()=>true)=>exports.publisherTranscript({id:'episode',title:'Episode',podcastChannelId:'show'},current),switchProfile:()=>{profile=profile==='A'?'B':'A';epoch++;},offline:()=>{offline=true;},hold:(value:Promise<void>)=>{held=value;},body:(value:string)=>{body=value;},episode,cached,stats:()=>({calls,release,writes})};}
test('publisher VTT retains timestamps and persists a local document reused offline',async()=>{const h=harness();const value=await h.read();assert.equal(value.synced,true);assert.equal(value.lines[0].start,1000);assert.equal(value.lines[0].value,'Hello');h.offline();assert.deepEqual(JSON.parse(JSON.stringify(await h.read())),JSON.parse(JSON.stringify(value)));assert.deepEqual(h.stats(),{calls:1,release:1,writes:['A']});});
test('manual offline with no transcript never starts network or a cache lease',async()=>{const h=harness();h.offline();assert.equal(await h.read(),null);assert.deepEqual(h.stats(),{calls:0,release:0,writes:[]});});
test('an unabortable response after account ABA cannot persist or publish its text',async()=>{const h=harness();let finish!:()=>void;h.hold(new Promise<void>(r=>{finish=r;}));const work=h.read();await new Promise(r=>setImmediate(r));h.switchProfile();h.switchProfile();finish();await assert.rejects(work,/profile changed/);assert.deepEqual(h.stats().writes,[]);assert.equal(h.stats().release,1);});
test('a transcript URL from another episode channel is never fetched',async()=>{const h=harness();h.episode.channelId='other';assert.equal(await h.read(),null);assert.equal(h.stats().calls,0);});
test('oversized and malformed supplied transcripts cannot enter the local cache',async()=>{for(const value of ['x'.repeat(1500001),'WEBVTT\n\ninvalid --> invalid\nText']){const h=harness();h.body(value);await assert.rejects(h.read());assert.deepEqual(h.stats().writes,[]);assert.equal(h.stats().release,1);}});

test('a timed-out body cancels its reader immediately and cannot save a late unabortable chunk', async () => {
  let deadline!: () => void, deliver!: () => void, reads = 0, cancels = 0, released = 0;
  const response = { ok: true, headers: { get: () => null }, body: { getReader: () => ({
    read: () => reads++ === 0 ? new Promise((resolve) => { deliver = () => resolve({ done: false, value: new TextEncoder().encode('WEBVTT\n\n00:01.000 --> 00:02.000\nLate') }); }) : Promise.resolve({ done: true }),
    cancel: () => { cancels++; return new Promise(() => {}); }, releaseLock: () => { released++; },
  }) } };
  const h = harness({ response: () => response, timer: (callback) => { deadline = callback; return 1; } });
  const work = h.read(); while (!deliver) await new Promise((resolve) => setImmediate(resolve));
  deadline(); await assert.rejects(work, /timed out/);
  assert.equal(cancels, 1, 'abort attempts native reader cancellation without awaiting a noncooperative cancel');
  assert.equal(h.stats().release, 1); deliver();
  for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(released, 1); assert.deepEqual(h.stats().writes, []); assert.equal(h.cached.size, 0);
});

test('a successful streamed transcript is not held open by a reader cancel promise that never settles', async () => {
  let reads = 0, released = 0;
  const response = { ok: true, headers: { get: () => null }, body: { getReader: () => ({
    read: async () => reads++ === 0 ? { done: false, value: new TextEncoder().encode('WEBVTT\n\n00:01.000 --> 00:02.000\nReady') } : { done: true },
    cancel: () => new Promise(() => {}), releaseLock: () => { released++; },
  }) } };
  const h = harness({ response: () => response, timer: () => 1 });
  const value = await h.read(); assert.equal(value.lines[0].value, 'Ready'); assert.equal(released, 1);
  assert.deepEqual(h.stats().writes, ['A']); assert.equal(h.stats().release, 1);
});

test('a text-only native response completing after its deadline cannot populate the cache', async () => {
  let deadline!: () => void, finish!: (value: string) => void;
  const h = harness({ response: () => ({ ok: true, headers: { get: () => null }, text: () => new Promise<string>((resolve) => { finish = resolve; }) }),
    timer: (callback) => { deadline = callback; return 1; } });
  const work = h.read(); while (!finish) await new Promise((resolve) => setImmediate(resolve));
  deadline(); await assert.rejects(work, /timed out/); finish('WEBVTT\n\n00:01.000 --> 00:02.000\nLate');
  for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.stats().writes, []); assert.equal(h.cached.size, 0);
});
