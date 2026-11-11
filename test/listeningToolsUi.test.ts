import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act,create,type ReactTestRenderer } from 'react-test-renderer';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const element=React.createElement;
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
function harness(page:'lyric-align'|'lyric-translate'|'settings/loudness-analysis'|'playback-range') {
  let song:any={id:'song',title:'Song',albumId:'album'},document:any={synced:true,lines:[{value:'hello',start:0}]};
  let renderer!:ReactTestRenderer,Component:any,epoch=0;
  const auth=createStore<any>(()=>({auth:{profile:'A'},offline:false,autoOffline:false}));auth.subscribe(()=>{epoch++;});
  function useAuthStore(selector:(state:any)=>any){return React.useSyncExternalStore(auth.subscribe,()=>selector(auth.getState()));}
  useAuthStore.subscribe=auth.subscribe;
  const scope=()=>({profile:auth.getState().auth.profile,source:'server'});
  let pending=deferred<any>(),album=deferred<any>(),callCount=0,analysisCount=0;
  const canceled:string[]=[],saved:any[]=[],applied:any[]=[];
  const imports:Record<string,any>={react:React,'react/jsx-runtime':JSXRuntime,'react-native':{Text:'Text',View:'View',TextInput:'Input',ActivityIndicator:'Spinner',FlatList:(props:any)=>element('List',props,props.ListHeaderComponent,...props.data.map((item:any,index:number)=>element(React.Fragment,{key:index},props.renderItem({item,index}))))},
    '@/components/SettingsUI':{SettingsPage:'Page',SettingsGroup:'Group',SettingRow:'Row',SelectList:'Select',settingsStyles:{}},
    '@/components/TranslationAttribution':{TranslationAttribution:'Attribution'},
    '@/components/DockScrollView':{DockScrollView:'Scroll'},'@/i18n':{useT:()=>((key:string)=>key)},'@/theme':{useTheme(){},colors:{}},
    '@/hooks/useLyricToolSong':{useLyricToolSong:()=>({song})},'@/hooks/useLyrics':{useLyrics:()=>({unshiftedLyrics:document})},
    '@/store/auth':{useAuthStore,profileScopeId:()=>scope().profile},
    '@/lib/localCustomizations':{customizationScope:scope,captureCustomizationOwner:(owner:any,extra=()=>true)=>{const token=epoch;return ()=>epoch===token&&owner.profile===scope().profile&&extra();},writeLocalCustomization:async(...args:any[])=>{const guard=args[4];if(guard())saved.push(args);}},
    '@/lib/lyricDocuments':{lyricRecordingKey:(song:any)=>song.id},
    '@/lib/lyricAlignmentService':{alignmentSettings:async()=>({endpoint:'https://example/align',language:'English'}),saveAlignmentSettings:async()=>{},alignLocalLyrics:async()=>{callCount++;return pending.promise;},cancelLyricAlignment:(id:string)=>canceled.push(id)},
    '../../modules/offline-translation':{offlineTranslation:{models:async()=>['en','zh'],prepare:async()=>{},translate:async()=>[],cancel:(id:string)=>canceled.push(id)}},
    '@/lib/lyricTranslation':{TRANSLATION_LANGUAGES:[['en','English'],['zh','Chinese']],translateLyricDocument:async()=>{callCount++;return pending.promise;}},
    '@/store/settings':{useSettings:(selector:any)=>selector({replayGain:'off',setReplayGain(){}})},
    '@/store/player':{usePlayerStore:(selector:any)=>selector({song}),currentSong:(state:any)=>state.song,setPlaybackRepeatSection:(...args:any[])=>applied.push(args),playbackRepeatPosition:()=>42},
    '@/store/repeatRange':{useRepeatSection:(selector:any)=>selector({section:null}),playbackClock:(value:string)=>Number(value)},
    '@/lib/loudnessTools':{useLoudnessTools:()=>({busy:false,analyzeMissing:false,error:''}),hydrateLoudnessPreferences:async()=>{},setAutomaticLoudness:async()=>{},analyzeLocalSongs:async()=>{analysisCount++;},cancelLoudnessWork:()=>canceled.push('loudness')},
    '../../../modules/listening-tools':{loudnessAnalysisAvailable:true},'@/api/data':{getAlbum:()=>album.promise},'@/lib/listeningExtras':{pruneListeningCache:async()=>{}},
  };
  const exports:any={};runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/app/${page}.tsx`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:(key:string)=>{if(key in imports)return imports[key];throw Error('unmocked '+key);},console});Component=exports.default;
  return {get renderer(){return renderer;},canceled,saved,applied,get calls(){return callCount;},get analysisCalls(){return analysisCount;},get document(){return document;},
    async mount(){await act(async()=>{renderer=create(element(Component));});},async unmount(){await act(async()=>renderer.unmount());},
    row(label:string){return renderer.root.findAllByType('Row' as any).find(row=>row.props.label===label);},
    async press(label:string){const row=this.row(label);assert.ok(row,'missing '+label);assert.equal(typeof row.props.onPress,'function','disabled '+label);await act(async()=>{row.props.onPress();});},
    async resolve(value:any){await act(async()=>{pending.resolve(value);await pending.promise;});},
    async setDocument(value:any){await act(async()=>{document=value;renderer.update(element(Component));});},
    async switchSong(id:string){await act(async()=>{song={...song,id,title:id};renderer.update(element(Component));});},
    async ABA(){await act(async()=>{const a=auth.getState().auth;auth.setState({auth:{profile:'B'}});auth.setState({auth:a});});},
    async resolveAlbum(){await act(async()=>{album.resolve({songs:[song]});await album.promise;});},
    next(){pending=deferred<any>();},
  };
}
for(const [page,start,apply] of [['lyric-align','Upload selected audio and align lyrics','Apply word timing in this app'],['lyric-translate','Translate with Google','Apply translation in this app']] as const){
  test(`${page}: timing-only document changes cancel the request and late result cannot become applicable`,async()=>{const h=harness(page);await h.mount();try{
    await h.press(start);assert.equal(h.calls,1);await h.setDocument({synced:true,lines:[{value:'hello',start:500}]});assert.equal(h.canceled.length,1);
    await h.resolve({...h.document,lines:[{value:'hello',start:0,translation:'stale'}]});assert.equal(h.row(apply),undefined);assert.equal(h.saved.length,0);
  }finally{await h.unmount();}});
  test(`${page}: an account ABA clears an already displayed preview, then current work can still apply`,async()=>{const h=harness(page);await h.mount();try{
    await h.press(start);await h.resolve({...h.document,lines:[{value:'hello',start:0,translation:'translated'}]});assert.ok(h.row(apply));await h.ABA();assert.equal(h.row(apply),undefined);
    h.next();await h.press(start);await h.resolve({...h.document,lines:[{value:'hello',start:0,translation:'new'}]});await h.press(apply);assert.equal(h.saved.length,1);assert.equal(h.saved[0][0].profile,'A');
  }finally{await h.unmount();}});
  test(`${page}: two same-frame taps issue one request and unmount cancels it`,async()=>{const h=harness(page);await h.mount();try{
    const action=h.row(start)!.props.onPress;await act(async()=>{action();action();});assert.equal(h.calls,1);
    await h.unmount();assert.equal(h.canceled.length,1);await h.resolve(h.document);assert.equal(h.saved.length,0);
  }catch(error){try{await h.unmount();}catch{}throw error;}});
}
test('album analysis never starts if account changed during catalogue lookup',async()=>{const h=harness('settings/loudness-analysis');await h.mount();try{await h.press('Analyze the full current album');await h.ABA();await h.resolveAlbum();assert.equal(h.analysisCalls,0);}finally{await h.unmount();}});
test('A-B draft boundaries reset when another song becomes current',async()=>{const h=harness('playback-range');await h.mount();try{
  await h.press('Mark A at current position');assert.equal(h.renderer.root.findAllByType('Input' as any)[0].props.value,'42.00');await h.switchSong('next');const inputs=h.renderer.root.findAllByType('Input' as any);assert.equal(inputs[0].props.value,'0');assert.equal(inputs[1].props.value,'');
}finally{await h.unmount();}});

test('translation preview shows the official provider attribution before applying',async()=>{const h=harness('lyric-translate');await h.mount();try{await h.press('Translate with Google');await h.resolve({...h.document,translationProvider:'google-mlkit'});const badge=h.renderer.root.findByType('Attribution' as any);assert.equal(badge.props.provider,'google-mlkit');assert.equal(badge.props.force,true);}finally{await h.unmount();}});
