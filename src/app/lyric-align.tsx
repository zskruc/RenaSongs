import { useEffect,useLayoutEffect,useRef,useState } from 'react';
import { FlatList,Text,TextInput,ActivityIndicator } from 'react-native';
import { SettingsPage,SettingsGroup,SettingRow,SelectList,settingsStyles } from '@/components/SettingsUI';
import { useLyricToolSong } from '@/hooks/useLyricToolSong';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import { colors,useTheme } from '@/theme';
import { alignmentSettings,saveAlignmentSettings,alignLocalLyrics,cancelLyricAlignment,type AlignmentSettings } from '@/lib/lyricAlignmentService';
import { captureCustomizationOwner,customizationScope,writeLocalCustomization } from '@/lib/localCustomizations';
import { lyricRecordingKey } from '@/lib/lyricDocuments';
import type { SongLyrics } from '@/api/subsonic';
import { useAuthStore } from '@/store/auth';
const languages=['Chinese','English','Cantonese','Japanese','Korean','French','German','Italian','Portuguese','Russian','Spanish'];
export default function LyricAlign(){useTheme();const t=useT(),{song}=useLyricToolSong(),lyrics=useLyrics(song??undefined),[settings,setSettings]=useState<AlignmentSettings>({endpoint:'',language:'Chinese'}),[token,setToken]=useState<string>(),[busy,setBusy]=useState(false),[phase,setPhase]=useState(''),[error,setError]=useState(''),[preview,setPreview]=useState<{lyrics:SongLyrics;signature:string}>();
 const alive=useRef(true),request=useRef(''),revision=useRef(0),scope=customizationScope(),document=lyrics.unshiftedLyrics;
 const signature=JSON.stringify([scope,song?.id,document]),latest=useRef(signature);useLayoutEffect(()=>{latest.current=signature;},[signature]);
 const result=preview?.signature===signature?preview.lyrics:undefined;
 const invalidate=()=>{revision.current++;if(request.current)cancelLyricAlignment(request.current);request.current='';if(alive.current){setBusy(false);setPreview(undefined);setError('');setPhase('');}};
 // Async operations are retired on unmount; revision is intentionally read at teardown.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{alive.current=true;const unsubscribe=useAuthStore.subscribe((next,before)=>{if(next.auth!==before.auth||next.offlineSource!==before.offlineSource||next.offline!==before.offline||next.autoOffline!==before.autoOffline){invalidate();setToken(undefined);setSettings({endpoint:'',language:'Chinese'});}});return()=>{alive.current=false;revision.current++;if(request.current)cancelLyricAlignment(request.current);request.current='';unsubscribe();};},[]);
 useEffect(()=>{invalidate();},[signature]);
 const scopeKey=JSON.stringify(scope);
 // Scope is a profile/source value; its serialized identity controls this read.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{const current=captureCustomizationOwner(scope,()=>alive.current);void alignmentSettings().then(value=>{if(current())setSettings(value);}).catch(()=>{});},[scopeKey]);
 const run=async(work:(current:()=>boolean,id:string)=>Promise<void>)=>{if(request.current)return;const version=revision.current,id='alignment-'+Date.now()+'-'+version;request.current=id;
  const current=captureCustomizationOwner(scope,()=>alive.current&&revision.current===version&&latest.current===signature&&request.current===id);setBusy(true);setError('');setPhase('');
  try{await work(current,id);}catch(error){if(current())setError(error instanceof Error?t(error.message):t('Lyric alignment failed'));}finally{if(request.current===id){request.current='';if(alive.current){setBusy(false);setPhase('');}}}};
 return <SettingsPage title={t('Align word timing')}><FlatList data={result?.lines??[]} keyExtractor={(_,index)=>String(index)} contentContainerStyle={settingsStyles.content} initialNumToRender={10} maxToRenderPerBatch={10}
 ListHeaderComponent={<><Text style={settingsStyles.sectionTitle}>{song?.title??t('Choose a song first to use lyrics tools.')}</Text><Text style={settingsStyles.sectionDescription}>{t('Use a compatible service that accepts audio_base64, mime_type, language and lines at an alignment endpoint. Only the selected local audio and lyric text are uploaded when you start. Results are saved in this app only.')}</Text>
 <Text style={settingsStyles.sectionDescription}>{t('Alignment endpoint URL')}</Text><TextInput value={settings.endpoint} onChangeText={endpoint=>setSettings(value=>({...value,endpoint}))} autoCapitalize="none" autoCorrect={false} editable={!busy} placeholder="https://your-service/v1/audio/alignments" placeholderTextColor={colors.textMuted} style={{color:colors.text,padding:16,backgroundColor:colors.surface,borderRadius:16}}/>
 <Text style={settingsStyles.sectionDescription}>{t('Bearer token (optional; stored securely)')}</Text><TextInput value={token??''} onChangeText={setToken} editable={!busy} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder={t('Keep the saved token only for this exact address and music source')} placeholderTextColor={colors.textMuted} style={{color:colors.text,padding:16,backgroundColor:colors.surface,borderRadius:16}}/>
 <Text style={settingsStyles.sectionDescription}>{t('Changing the service address or music source clears the saved token. Enter it again for the new service.')}</Text>
 <SettingsGroup><SelectList label={t('Lyric language')} value={settings.language} options={languages.map(value=>({value,label:t(value)}))} onChange={language=>setSettings(value=>({...value,language}))} disabled={busy}/>
 <SettingRow label={t('Save alignment service settings')} onPress={busy?undefined:()=>{void run(async(current)=>{await saveAlignmentSettings(settings,token);if(current())setToken(undefined);});}}/>
 <SettingRow label={t('Upload selected audio and align lyrics')} onPress={busy||!song||!document?undefined:()=>{void run(async(current,id)=>{await saveAlignmentSettings(settings,token);if(!current())return;setPreview(undefined);const value=await alignLocalLyrics(id,song!,document!,settings,current,value=>{if(current())setPhase(t(value));});if(current())setPreview({lyrics:value,signature});});}}/>
 {result&&song?<SettingRow label={t('Apply word timing in this app')} onPress={busy?undefined:()=>{void run(async current=>{await writeLocalCustomization(scope,'lyric-edit',song.id,{version:1,recording:lyricRecordingKey(song),base:lyrics.localEdit?.base??document,lyrics:result,updatedAt:Date.now()},current);});}}/>:null}
 {busy?<SettingRow label={t('Cancel')} onPress={invalidate}/>:null}</SettingsGroup>
 {busy?<><ActivityIndicator/><Text style={settingsStyles.sectionDescription}>{phase}</Text></>:null}{error?<Text style={settingsStyles.sectionDescription}>{error}</Text>:null}</>}
 renderItem={({item})=><><Text style={settingsStyles.sectionTitle}>{item.value}</Text><Text style={settingsStyles.sectionDescription}>{item.words?.map(word=>`${(word.start/1000).toFixed(2)} ${word.value}`).join(' · ')??t('No word timing')}</Text></>}/></SettingsPage>;
}
