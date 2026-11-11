import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { MetadataButton, MetadataInput, metadataStyles } from '@/components/metadata/MetadataUI';
import { useMetadataTarget, useMetadataArtwork } from '@/lib/metadata/hooks';
import { metadataOperation } from '@/lib/metadata/repository';
import { fetchMetadataArtwork, restoreMetadataArtwork, savePickedMetadataArtwork } from '@/lib/metadata/artwork';
import { metadataCheck, isMetadataCancelled } from '@/lib/metadata/models';
import { useMetadataScraping } from '@/store/metadataScraping';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

export default function MetadataArtworkPage() {
  useTheme(); const t = useT(), target = useMetadataTarget(), state = useMetadataScraping();
  const id = target?.id ?? target?.songs[0]?.id, kind = target?.kind ?? 'song';
  const image = useMetadataArtwork(kind, id), [address, setAddress] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const alive = useRef(true), request = useRef<AbortController | undefined>(undefined);
  useEffect(() => { void state.hydrate(); return () => { alive.current = false; request.current?.abort(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (action: (operation: ReturnType<typeof metadataOperation>) => Promise<void>) => {
    if (!target || !id || busy) return; const controller = new AbortController(); request.current = controller;
    const operation = metadataOperation(target.scope, controller.signal, () => alive.current && (!target.current || target.current())); setBusy(true); setMessage('');
    try { await action(operation); await state.hydrate(true); metadataCheck(operation); setMessage('Artwork saved inside this app'); }
    catch (error) { if (!isMetadataCancelled(error) && operation.current()) setMessage('Could not save this image. Use JPEG, PNG, GIF or WebP under 20 MiB.'); }
    finally { if (alive.current) setBusy(false); }
  };
  return <SettingsPage title={t('Local artwork')}><DockScrollView contentContainerStyle={settingsStyles.content} keyboardShouldPersistTaps="handled">
    <Text style={metadataStyles.label}>{target?.title ?? target?.songs[0]?.title}</Text>
    <Text style={metadataStyles.note}>{t('The original image is copied without JPEG conversion. GIF and WebP animation is preserved. Removing the local choice restores the existing artwork policy.')}</Text>
    {image ? <Image source={{ uri: image }} style={{ width: 240, height: 240, borderRadius: kind === 'artist' ? 120 : 18, alignSelf: 'center', marginVertical: 20 }} contentFit="cover" /> : null}
    <MetadataButton title={t('Choose an image from this device')} disabled={busy || !id} onPress={() => { void run(async (operation) => {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 }); metadataCheck(operation);
      if (!result.canceled && result.assets?.[0]) await savePickedMetadataArtwork(result.assets[0].uri, kind, id!, operation);
    }); }} />
    <MetadataInput label={t('Artwork HTTPS URL')} value={address} onChangeText={setAddress} editable={!busy} />
    <MetadataButton title={t('Download this artwork')} disabled={busy || !id || !/^https:\/\//i.test(address.trim())} onPress={() => { void run(async (operation) => { await fetchMetadataArtwork(address.trim(), kind, id!, operation); }); }} />
    <MetadataButton title={t('Restore original artwork')} disabled={busy || !image || !id} onPress={() => { void run(async (operation) => { await restoreMetadataArtwork(kind, id!, operation); }); }} />
    {busy ? <><ActivityIndicator /><MetadataButton title={t('Cancel request')} onPress={() => request.current?.abort()} /></> : null}
    {message ? <Text style={metadataStyles.note}>{t(message)}</Text> : null}
  </DockScrollView></SettingsPage>;
}
