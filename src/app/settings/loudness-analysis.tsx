import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingsPage, SettingsGroup, SettingRow, SelectList, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import { useSettings } from '@/store/settings';
import { currentSong, usePlayerStore } from '@/store/player';
import { useLoudnessTools, hydrateLoudnessPreferences, setAutomaticLoudness, analyzeLocalSongs, cancelLoudnessWork } from '@/lib/loudnessTools';
import { loudnessAnalysisAvailable } from '../../../modules/listening-tools';
import { getAlbum } from '@/api/data';
import { pruneListeningCache } from '@/lib/listeningExtras';
import { customizationScope, captureCustomizationOwner } from '@/lib/localCustomizations';
import { useAuthStore } from '@/store/auth';
export default function LoudnessAnalysis(){useTheme();const t=useT(),song=usePlayerStore(state=>currentSong(state)),state=useLoudnessTools(),mode=useSettings(value=>value.replayGain),setMode=useSettings(value=>value.setReplayGain),[message,setMessage]=useState('');
 const alive=useRef(true),revision=useRef(0),ownAnalysis=useRef(false),starting=useRef(false),scope=customizationScope();
 const signature=JSON.stringify([scope,song?.id]),latest=useRef(signature);useLayoutEffect(()=>{latest.current=signature;},[signature]);
 const invalidate=()=>{revision.current++;if(ownAnalysis.current)cancelLoudnessWork();if(alive.current)setMessage('');};
 useEffect(()=>{invalidate();},[signature]);
 useEffect(()=>{alive.current=true;void hydrateLoudnessPreferences();const unsubscribe=useAuthStore.subscribe((next,before)=>{if(next.auth!==before.auth||next.offlineSource!==before.offlineSource||next.offline!==before.offline||next.autoOffline!==before.autoOffline)invalidate();});return()=>{alive.current=false;invalidate();unsubscribe();};},[]);
 const run=async(album=false)=>{if(!song||starting.current||state.busy)return;starting.current=true;const version=revision.current,current=captureCustomizationOwner(scope,()=>alive.current&&version===revision.current&&latest.current===signature);setMessage('');
  try{const tracks=album&&song.albumId?(await getAlbum(song.albumId)).songs:[song];if(!current())return;ownAnalysis.current=true;await analyzeLocalSongs(tracks,album,current);if(current())setMessage(t('Analysis saved. Results are used when playback starts again; the current track volume stays stable.'));}catch(error){if(current())setMessage(error instanceof Error?t(error.message):t('Loudness analysis failed'));}finally{ownAnalysis.current=false;starting.current=false;}};
 const clearCache=async()=>{const current=captureCustomizationOwner(scope,()=>alive.current);try{await pruneListeningCache('loudness:',0,scope,current);if(!current())return;await pruneListeningCache('loudness-album:',0,scope,current);if(current())setMessage(t('Analysis cache cleared'));}catch(error){if(current())setMessage(t(String(error)));}};
 return <SettingsPage title={t('Local loudness analysis')}><DockScrollView contentContainerStyle={settingsStyles.content}>
 <Text style={settingsStyles.sectionDescription}>{t('Use existing ReplayGain tags first. For music without tags, analyze downloaded or local audio and cache the result. No audio is uploaded or downloaded by this tool.')}</Text>
 <SettingsGroup><SelectList label={t('Normalize volume')} value={mode} options={[{value:'off',label:t('Off')},{value:'auto',label:t('Automatic')},{value:'track',label:t('By track')},{value:'album',label:t('By album')}]} onChange={setMode}/>
 <SelectList label={t('Analyze missing loudness while using the app')} value={state.analyzeMissing} options={[{value:false,label:t('Off')},{value:true,label:t('On')}]} onChange={value=>{const current=captureCustomizationOwner(scope,()=>alive.current);void setAutomaticLoudness(value).catch(error=>{if(current())setMessage(t(String(error)));});}}/>
 <SettingRow label={t('Analyze current track')} description={song?.title} onPress={!song||state.busy||!loudnessAnalysisAvailable?undefined:()=>{void run();}}/>
 <SettingRow label={t('Analyze the full current album')} onPress={!song?.albumId||state.busy||!loudnessAnalysisAvailable?undefined:()=>{void run(true);}}/>
 {state.busy?<SettingRow label={t('Cancel analysis')} onPress={cancelLoudnessWork}/>:null}
 <SettingRow label={t('Clear loudness analysis cache')} onPress={state.busy?undefined:()=>{void clearCache();}}/></SettingsGroup>
 {state.busy?<><ActivityIndicator/><Text style={settingsStyles.sectionDescription}>{state.progress}/{state.total}</Text></>:null}
 <Text style={settingsStyles.sectionDescription}>{t('Analysis pauses when the app leaves the foreground. Existing file tags and the current track volume are preserved.')}</Text>
 {message||state.error?<Text style={settingsStyles.sectionDescription}>{message||t(state.error)}</Text>:null}</DockScrollView></SettingsPage>;
}
