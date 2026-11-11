/** CUE imports keep their file-operation lease until native copy/cleanup settles. */
import { useEffect, useRef, useState } from 'react';
import { FlatList, Text, ActivityIndicator } from 'react-native';
import Animated from 'react-native-reanimated';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { SettingsPage, SettingRow, SettingsGroup, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import { parseCue, cueSongs, cueFileName, type CueTrack } from '@/lib/cue';
import { hashKey } from '@/lib/localLibrary';
import { decodeImportedText } from '@/lib/metadataScript';
import { customizationScope, captureCustomizationOwner, type CustomizationScope } from '@/lib/localCustomizations';
import { appendCueTracks, beginCueImport, clearCueTracks, cueImportDirectory, reserveCueImport } from '@/lib/cueLibrary';
import { readListeningExtra } from '@/lib/listeningExtras';
import { usePlayerStore } from '@/store/player';
import { useAuthStore } from '@/store/auth';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import type { Song } from '@/api/subsonic';
const List = Animated.createAnimatedComponent(FlatList<Song>);
export default function CueImportScreen() {
  useAuthStore((state) => state.auth); useAuthStore((state) => state.offlineSource);
  const scope = customizationScope();
  return <CueImport key={JSON.stringify(scope)} scope={scope} />;
}
function CueImport({ scope }: { scope: CustomizationScope }) {
  useTheme(); const t = useT(), onScroll = useLiquidDockScrollHandler();
  const [tracks, setTracks] = useState<CueTrack[]>([]), [songs, setSongs] = useState<Song[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), request = useRef(0);
  useEffect(() => {
    alive.current = true; const current = captureCustomizationOwner(scope, () => alive.current);
    void readListeningExtra<Song[]>('cue-catalog', scope, current).then((value) => { if (current()) setSongs(value ?? []); }, () => { if (current()) setError(t('CUE import failed')); });
    return () => { alive.current = false; };
    // The keyed child owns one source; translated labels do not restart IO.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.profile, scope.source]);
  async function run(work: (current: () => boolean) => Promise<void>) {
    if (busy) return; const token = ++request.current, current = captureCustomizationOwner(scope, () => alive.current);
    if (!current()) return; setBusy(true); setError('');
    try { await work(current); }
    catch (value) { if (current()) setError(t(value instanceof Error ? value.message : 'CUE import failed')); }
    finally { if (alive.current && token === request.current) setBusy(false); }
  }
  async function chooseSheet(current: () => boolean) {
    const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (picked.canceled || !current()) return; const asset = picked.assets[0];
    if (asset.size && asset.size > 1024 * 1024) throw new Error('CUE sheet is too large');
    const raw = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }); if (!current()) return;
    const text = await decodeImportedText(raw); if (current()) setTracks(parseCue(text));
  }
  async function importAudio(current: () => boolean) {
    const selected = await DocumentPicker.getDocumentAsync({ type: ['audio/*', 'application/octet-stream'], multiple: true, copyToCacheDirectory: false });
    if (selected.canceled || !current()) return;
    const map = new Map(selected.assets.map((asset) => [cueFileName(asset.name), asset]));
    if (map.size !== selected.assets.length) throw new Error('Choose audio files with distinct names');
    const required = [...new Set(tracks.map((track) => cueFileName(track.file)))];
    if (required.some((name) => !map.has(name))) throw new Error('Choose every audio file referenced by this sheet');
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, directory = `${cueImportDirectory(scope)}${id}/`;
    const lease = beginCueImport(scope), owns = () => current() && lease.current();
    const files: Record<string, { uri: string; id: string }> = {}; let committed = false;
    try {
      if (!owns()) throw new Error('CUE import canceled');
      await reserveCueImport(scope, owns, tracks.length);
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      for (const name of required) {
        if (!owns()) throw new Error('CUE import canceled');
        const asset = map.get(name)!, extension = asset.name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? '.audio', uri = directory + hashKey(name) + extension;
        await FileSystem.copyAsync({ from: asset.uri, to: uri }); if (!owns()) throw new Error('CUE import canceled');
        files[name] = { uri, id: hashKey(uri) };
      }
      const values = cueSongs(tracks, files, id); if (!owns()) throw new Error('CUE import canceled');
      const catalog = await appendCueTracks(values, scope, owns); committed = true; if (owns()) setSongs(catalog);
    } finally {
      try { if (!committed) await FileSystem.deleteAsync(directory, { idempotent: true }); }
      finally { lease.release(); }
    }
  }
  return <SettingsPage title={t('CUE virtual tracks')}><List data={songs} keyExtractor={(song) => song.id} contentContainerStyle={settingsStyles.content}
    initialNumToRender={12} maxToRenderPerBatch={12} onScroll={onScroll} scrollEventThrottle={16}
    ListHeaderComponent={<>
      <Text style={settingsStyles.sectionDescription}>{t('Choose a CUE sheet, then its audio files. Audio is copied into this app; the original file is not split or changed. UTF-8, UTF-16 and GB18030 sheets are supported.')}</Text>
      <SettingsGroup>
        <SettingRow label={t('Choose CUE sheet')} onPress={busy ? undefined : () => { void run(chooseSheet); }} />
        <SettingRow label={t('Select audio files and import')} onPress={busy || !tracks.length ? undefined : () => { void run(importAudio); }} />
        <SettingRow label={t('Clear imported CUE tracks')} onPress={busy || !songs.length ? undefined : () => { void run(async (current) => { await clearCueTracks(scope, current); if (current()) setSongs([]); }); }} />
      </SettingsGroup>
      {tracks.length ? <Text style={settingsStyles.sectionDescription}>{t('CUE tracks found')}: {tracks.length}</Text> : null}
      {busy ? <ActivityIndicator /> : null}{error ? <Text style={settingsStyles.sectionDescription}>{error}</Text> : null}
    </>}
    renderItem={({ item, index }) => <SettingRow label={`${item.track ?? index + 1}. ${item.title}`} description={item.artist} onPress={() => {
      const current = captureCustomizationOwner(scope, () => alive.current); if (current()) void usePlayerStore.getState().playQueue(songs, index, t('CUE virtual tracks'), '/cue-import', { ordered: true });
    }} />} /></SettingsPage>;
}
