import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text, ActivityIndicator, Pressable } from 'react-native';
import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useLyricToolTarget } from '@/store/lyricToolTarget';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { currentSong, usePlayerStore } from '@/store/player';
import { captureCustomizationOwner } from '@/lib/localCustomizations';
import { publisherTranscript } from '@/lib/publisherTranscript';
import { useT } from '@/i18n';
import { useTheme, colors } from '@/theme';
import type { SongLyrics } from '@/api/subsonic';
/** Publisher text is device cached; only a currently playing episode can be sought. */
export default function PublisherTranscript() {
  useTheme(); const t = useT(), target = useLyricToolTarget();
  useAuthStore(state=>state.auth); useAuthStore(state=>state.offlineSource); useAuthStore(state=>state.offline);
  const latest = useRef(target.session); latest.current=target.session;
  const admitted = useMemo(()=>captureCustomizationOwner(undefined,()=>latest.current===target.session && target.profile===profileScopeId()),[target.session,target.profile]);
  const [lyrics,setLyrics] = useState<SongLyrics | null>(null), [busy,setBusy] = useState(true), [error,setError] = useState(false);
  useEffect(() => { let alive = true; const valid = ()=>alive && admitted();
    setLyrics(null); setBusy(true); setError(false);
    if (!target.song?.podcastChannelId || !valid()) { setBusy(false); return; }
    void publisherTranscript(target.song,valid).then(value=>{if(valid())setLyrics(value);}).catch(()=>{if(valid())setError(true);}).finally(()=>{if(valid())setBusy(false);});
    return () => { alive=false; };
  },[target.song,target.profile,target.session,admitted]);
  return <SettingsPage title={t('Publisher transcript')}><FlatList data={admitted() ? lyrics?.lines ?? [] : []} keyExtractor={(_,i)=>String(i)} initialNumToRender={20} windowSize={5} contentContainerStyle={settingsStyles.content}
    ListHeaderComponent={<Text style={[settingsStyles.sectionDescription,{color:colors.textSecondary}]}>{admitted() ? target.song?.title : t('Library changed. Reopen this page.')}</Text>}
    ListEmptyComponent={!admitted() ? <Text style={settingsStyles.sectionDescription}>{t('Library changed. Reopen this page.')}</Text> : busy?<ActivityIndicator/>:<Text style={settingsStyles.sectionDescription}>{t(error?'Could not load publisher transcript':'No publisher transcript available')}</Text>}
    renderItem={({item})=><Pressable onPress={()=>{const state=usePlayerStore.getState(),song=currentSong(state); if(admitted() && song?.id===target.song?.id && song?.podcastChannelId===target.song?.podcastChannelId && typeof item.start==='number')state.seekTo(item.start/1000);}}
      style={{paddingVertical:10}}><Text style={{color:colors.text,fontSize:18,lineHeight:28}}>{item.value}</Text></Pressable>}/></SettingsPage>;
}
