import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { validRepeatSection } from '../src/store/repeatRange';
const source=readFileSync(new URL('../src/store/player.ts',import.meta.url),'utf8');
const ast=ts.createSourceFile('player.ts',source,ts.ScriptTarget.Latest,true);
function actual(name:string){const node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name)!;assert.ok(node,name);return ts.transpileModule(node.getText(ast)+`\nexports.${name}=${name};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;}
function rangeHarness(){const repeat:any={section:null},state:any={queue:[{id:'cue',duration:100}],index:0,durationSec:100};const native:any={currentStatus:{abRepeat:null},setABRepeat:(a:any,b:any)=>{native.currentStatus={abRepeat:a===null?null:{start:a,end:b}};calls.push(['native',a,b]);},clearNextSource:()=>calls.push(['clear'])};const calls:any[]=[];const exports:any={};
 const context:any={exports,useRepeatSection:{getState:()=>repeat,setState:(value:any)=>{Object.assign(repeat,value);calls.push(['state',value.section]);}},usePlayerStore:{getState:()=>state},currentSong:(s:any)=>s.queue[s.index],activePlayer:()=>native,profileScopeId:()=> 'profile',remoteKind:()=>null,validRepeatSection,streamOffsetSec:0,queuedNext:{},preparingNext:{},applyLoop:()=>calls.push(['loop']),scheduleNextSource:()=>calls.push(['next']),syncPlaybackPowerPolicy:()=>calls.push(['power']),beat(){},expectedAudioBeatIntervalMs:500};
 runInNewContext(actual('setPlaybackRepeatSection')+actual('onStatus'),context);return {exports,repeat,state,native,calls,context};}
test('real A-B setter clears preload before installing native bounds and rejects unsafe CUE/stream offsets',()=>{const h=rangeHarness();h.exports.setPlaybackRepeatSection(2,5);assert.deepEqual(h.calls.map(row=>row[0]),['clear','native','state','loop','power']);assert.equal(h.repeat.section.start,2);assert.equal(h.repeat.section.songId,'cue');
 h.calls.length=0;h.context.streamOffsetSec=10;assert.throws(()=>h.exports.setPlaybackRepeatSection(2,5),/beginning/);assert.equal(h.calls.length,0);
 h.context.streamOffsetSec=0;assert.throws(()=>h.exports.setPlaybackRepeatSection(99,101),/valid/);assert.equal(h.calls.length,0);h.exports.setPlaybackRepeatSection();assert.equal(h.repeat.section,null);assert.equal(h.native.currentStatus.abRepeat,null);
});
test('native A-B rejection never publishes a false successful section',()=>{const h=rangeHarness();h.native.setABRepeat=()=>{throw Error('not seekable');};assert.throws(()=>h.exports.setPlaybackRepeatSection(2,5),/seekable/);assert.equal(h.repeat.section,null);assert.equal(h.calls.some(row=>row[0]==='state'),false);});
test('queued pre-enable null status cannot clear a newly active native A-B range; live cancellation can',()=>{const h=rangeHarness();h.exports.setPlaybackRepeatSection(2,5);h.context.remoteKind=()=>true;h.exports.onStatus({abRepeat:null,playing:false});assert.ok(h.repeat.section);h.native.currentStatus.abRepeat=null;h.exports.onStatus({abRepeat:null,playing:false});assert.equal(h.repeat.section,null);});
test('actual gain factor uses file tags before local analysis and peak-only tags do not suppress analyzed gain',()=>{const exports:any={},settings={replayGain:'track',replayGainPreampDb:0};let reads=0;runInNewContext(actual('gainFactor'),{exports,useSettings:{getState:()=>settings},usePlayerStore:{getState:()=>({})},frozenLoudnessGain:()=>{reads++;return {trackGain:-6,trackPeak:.9};}});
 assert.ok(Math.abs(exports.gainFactor({replayGain:{trackPeak:.8}})-Math.pow(10,-6/20))<1e-9);assert.equal(reads,1);
 assert.ok(Math.abs(exports.gainFactor({replayGain:{trackGain:-3,trackPeak:.5}})-Math.pow(10,-3/20))<1e-9);assert.equal(reads,1);
 settings.replayGain='off';assert.equal(exports.gainFactor({replayGain:{trackGain:-3}}),1);
});
