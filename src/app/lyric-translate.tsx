import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text } from 'react-native';
import { SettingsPage, SettingsGroup, SettingRow, SelectList, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import { useLyricToolSong } from '@/hooks/useLyricToolSong';
import { useLyrics } from '@/hooks/useLyrics';
import { offlineTranslation } from '../../modules/offline-translation';
import { TRANSLATION_LANGUAGES, translateLyricDocument } from '@/lib/lyricTranslation';
import { customizationScope, captureCustomizationOwner, writeLocalCustomization } from '@/lib/localCustomizations';
import { lyricRecordingKey } from '@/lib/lyricDocuments';
import type { SongLyrics } from '@/api/subsonic';
import { useAuthStore } from '@/store/auth';
import { TranslationAttribution } from '@/components/TranslationAttribution';
export default function LyricTranslate() {
  useTheme(); const t=useT(), {song}=useLyricToolSong(), lyrics=useLyrics(song??undefined);
  const [from,setFrom]=useState('en'),[to,setTo]=useState('zh'),[models,setModels]=useState<string[]>([]),[busy,setBusy]=useState(''),[error,setError]=useState(''),[preview,setPreview]=useState<{lyrics:SongLyrics;signature:string}>();
  const alive=useRef(true), request=useRef(''), revision=useRef(0), scope=customizationScope();
  const document=lyrics.unshiftedLyrics, signature=JSON.stringify([scope,song?.id,document,from,to]),latest=useRef(signature);useLayoutEffect(()=>{latest.current=signature;},[signature]);
  const result=preview?.signature===signature?preview.lyrics:undefined;
  const invalidate=()=>{revision.current++;if(request.current)offlineTranslation?.cancel(request.current);request.current='';if(alive.current){setBusy('');setError('');setPreview(undefined);}};
  useEffect(()=>{invalidate();},[signature]);
  useEffect(()=>{alive.current=true;void offlineTranslation?.models().then(value=>{if(alive.current)setModels(value);}).catch(()=>{});
    const unsubscribe=useAuthStore.subscribe((next,before)=>{if(next.auth!==before.auth||next.offlineSource!==before.offlineSource||next.offline!==before.offline||next.autoOffline!==before.autoOffline)invalidate();});
    // The revision counter must be retired at teardown, not captured at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{alive.current=false;revision.current++;if(request.current)offlineTranslation?.cancel(request.current);request.current='';unsubscribe();};},[]);
  const run=async(kind:string,work:(id:string,current:()=>boolean)=>Promise<void>)=>{if(request.current)return;const version=revision.current,id='translate-'+Date.now()+'-'+version;request.current=id;
    const current=captureCustomizationOwner(scope,()=>alive.current&&version===revision.current&&latest.current===signature&&request.current===id);setBusy(kind);setError('');
    try{await work(id,current);}catch(e){if(current())setError(e instanceof Error?t(e.message):t('Translation failed'));}finally{if(request.current===id){request.current='';if(alive.current)setBusy('');}}};
  const options=TRANSLATION_LANGUAGES.map(([value,label])=>({value,label:t(label)}));
  return <SettingsPage title={t('Offline lyric translation')}><FlatList data={result?.lines??[]} keyExtractor={(_,index)=>String(index)} contentContainerStyle={settingsStyles.content} initialNumToRender={12} maxToRenderPerBatch={12}
    ListHeaderComponent={<><Text style={settingsStyles.sectionDescription}>{t('Download language models once, then translate on this device. Lyric text is not sent to a translation server.')}</Text>
      <Text style={settingsStyles.sectionTitle}>{song?.title??t('Choose a song first to use lyrics tools.')}</Text>
      <SettingsGroup><SelectList label={t('Source language')} value={from} options={options} onChange={value=>setFrom(value as string)} disabled={!!busy}/><SelectList label={t('Target language')} value={to} options={options} onChange={value=>setTo(value as string)} disabled={!!busy}/></SettingsGroup>
      <Text style={settingsStyles.sectionDescription}>{t('Downloaded languages')}: {models.join(', ')||t('None')}</Text>
      <SettingsGroup><SettingRow label={t('Download selected models over Wi-Fi')} onPress={busy||!offlineTranslation?undefined:()=>{void run('models',async(id,current)=>{await offlineTranslation!.prepare(id,from,to,true);const value=await offlineTranslation!.models();if(current())setModels(value);});}}/>
      <SettingRow label={t('Translate with Google')} onPress={busy||!document||!offlineTranslation?undefined:()=>{void run('translate',async(id,current)=>{const value=await translateLyricDocument(id,document!,from,to,current);if(current())setPreview({lyrics:value,signature});});}}/>
      {result&&song?<SettingRow label={t('Apply translation in this app')} onPress={busy?undefined:()=>{void run('save',async(_id,current)=>{await writeLocalCustomization(scope,'lyric-edit',song.id,{version:1,recording:lyricRecordingKey(song),base:lyrics.localEdit?.base??document,lyrics:result,updatedAt:Date.now()},current);});}}/>:null}
      {busy?<SettingRow label={t('Cancel')} onPress={invalidate}/>:null}</SettingsGroup>
      {result?<TranslationAttribution provider={result.translationProvider} force/>:null}
      {busy?<ActivityIndicator/>:null}{error?<Text style={settingsStyles.sectionDescription}>{error}</Text>:null}
      <Text style={settingsStyles.sectionTitle}>{t('Manage downloaded models')}</Text><SettingsGroup>{models.map(code=><SettingRow key={code} label={`${t('Delete model')}: ${code}`} onPress={busy?undefined:()=>{void run('delete',async(_id,current)=>{await offlineTranslation?.removeModel(code);const value=await offlineTranslation!.models();if(current())setModels(value);});}}/>)}</SettingsGroup>
      <Text style={settingsStyles.sectionDescription}>{t('Translation engine: Google ML Kit. Model downloads need an available network; downloaded models work offline.')}</Text></>}
    renderItem={({item})=><><Text style={settingsStyles.sectionDescription}>{item.value}</Text><Text style={settingsStyles.sectionTitle}>{item.translation}</Text></>}/></SettingsPage>;
}
