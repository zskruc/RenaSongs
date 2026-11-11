import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingsPage, SettingsGroup, SettingRow, settingsStyles } from '@/components/SettingsUI';
import { currentSong, usePlayerStore, setPlaybackRepeatSection, playbackRepeatPosition } from '@/store/player';
import { useRepeatSection, playbackClock } from '@/store/repeatRange';
import { useT } from '@/i18n';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { colors, useTheme } from '@/theme';
export default function PlaybackRange(){useTheme();const t=useT(),song=usePlayerStore(state=>currentSong(state)),section=useRepeatSection(state=>state.section),[a,setA]=useState('0'),[b,setB]=useState(''),[error,setError]=useState('');
 const auth=useAuthStore(value=>value.auth),source=useAuthStore(value=>value.offlineSource),identity=JSON.stringify([profileScopeId(),song?.id,song?.cueStartSec,song?.cueEndSec]);
 // A new source must not reuse another track's draft repeat boundaries.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{setA('0');setB('');setError('');},[identity,auth,source]);
 const apply=()=>{try{const start=playbackClock(a),end=playbackClock(b);if(start===undefined||end===undefined)throw new Error(t('Use seconds or minutes:seconds'));setPlaybackRepeatSection(start,end);setError('');}catch(e){setError(e instanceof Error?e.message:t('Could not set A-B repeat'));}};
 return <SettingsPage title={t('A-B repeat')}><DockScrollView contentContainerStyle={settingsStyles.content}><Text style={settingsStyles.sectionTitle}>{song?.title??t('Nothing playing')}</Text><Text style={settingsStyles.sectionDescription}>{t('Set two positions to repeat a section. Seeking outside this section turns A-B repeat off. Minimum length: one second.')}</Text>
 <View><Text style={settingsStyles.sectionDescription}>{t('A: start')}</Text><TextInput value={a} onChangeText={setA} keyboardType="decimal-pad" style={{color:colors.text,padding:16,borderRadius:16,backgroundColor:colors.surface}}/><Text style={settingsStyles.sectionDescription}>{t('B: end')}</Text><TextInput value={b} onChangeText={setB} keyboardType="decimal-pad" style={{color:colors.text,padding:16,borderRadius:16,backgroundColor:colors.surface}}/></View>
 <SettingsGroup><SettingRow label={t('Mark A at current position')} onPress={song?()=>setA(playbackRepeatPosition().toFixed(2)):undefined}/><SettingRow label={t('Mark B at current position')} onPress={song?()=>setB(playbackRepeatPosition().toFixed(2)):undefined}/><SettingRow label={t('Start A-B repeat')} onPress={song?apply:undefined}/><SettingRow label={t('Turn off A-B repeat')} onPress={section?()=>{try{setPlaybackRepeatSection();setError('');}catch(e){setError(String(e));}}:undefined}/></SettingsGroup>
 {section&&section.songId===song?.id?<Text style={settingsStyles.sectionDescription}>{t('Repeating section')}: {section.start.toFixed(2)}–{section.end.toFixed(2)} s</Text>:null}{error?<Text style={settingsStyles.sectionDescription}>{error}</Text>:null}</DockScrollView></SettingsPage>;}
