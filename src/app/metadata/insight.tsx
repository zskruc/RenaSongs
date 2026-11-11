import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Text } from 'react-native';
import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { DockScrollView } from '@/components/DockScrollView';
import { MetadataButton, MetadataInput, metadataStyles } from '@/components/metadata/MetadataUI';
import { useMetadataInsight, useMetadataTarget } from '@/lib/metadata/hooks';
import { metadataOperation, saveMetadataRecord } from '@/lib/metadata/repository';
import { findMetadataInsightCandidates, loadMetadataInsight } from '@/lib/metadata/insight';
import { metadataCheck, isMetadataCancelled } from '@/lib/metadata/models';
import { useMetadataScraping } from '@/store/metadataScraping';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import { useSettings } from '@/store/settings';

export default function MetadataInsightPage() {
  useTheme(); const t = useT(), target = useMetadataTarget(), state = useMetadataScraping(), language = useSettings((settings) => settings.language);
  const kind = target?.kind === 'album' ? 'album' : 'artist', id = target?.id;
  const insight = useMetadataInsight(kind, id), [name, setName] = useState(target?.title ?? ''), [artist, setArtist] = useState(target?.songs[0]?.artist ?? '');
  const [candidates, setCandidates] = useState<{ id: string; title: string; detail: string }[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const alive = useRef(true), request = useRef<AbortController | undefined>(undefined);
  useEffect(() => { void state.hydrate(); return () => { alive.current = false; request.current?.abort(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (action: (operation: ReturnType<typeof metadataOperation>) => Promise<void>) => {
    if (!target || !id || busy) return; const controller = new AbortController(); request.current = controller;
    const operation = metadataOperation(target.scope, controller.signal, () => alive.current && (!target.current || target.current())); setBusy(true); setMessage('');
    try { await action(operation); } catch (error) { if (!isMetadataCancelled(error) && operation.current()) setMessage('No sourced biography is available. Your existing information was kept.'); }
    finally { if (alive.current) setBusy(false); }
  };
  return <SettingsPage title={t('Sourced biography')}><DockScrollView contentContainerStyle={settingsStyles.content} keyboardShouldPersistTaps="handled">
    <Text style={metadataStyles.note}>{t('Choose the exact MusicBrainz artist or release. Its linked Wikipedia summary is saved with attribution; unrelated same-name biographies are never applied automatically.')}</Text>
    <MetadataInput label={t(kind === 'album' ? 'Album title' : 'Artist')} value={name} onChangeText={setName} editable={!busy} />
    {kind === 'album' ? <MetadataInput label={t('Artist')} value={artist} onChangeText={setArtist} editable={!busy} /> : null}
    <MetadataButton title={t('Find biography candidates')} disabled={busy || !id || !name.trim()} onPress={() => { void run(async (operation) => {
      const found = await findMetadataInsightCandidates(kind, name.trim(), artist.trim(), operation); metadataCheck(operation); setCandidates(found); if (!found.length) setMessage('No sourced biography is available. Your existing information was kept.');
    }); }} />
    {candidates.map((entry) => <MetadataButton key={entry.id} title={[entry.title, entry.detail].filter(Boolean).join(' · ')} disabled={busy} onPress={() => { void run(async (operation) => {
      await loadMetadataInsight(kind, id!, entry.id, language, operation); await state.hydrate(true); metadataCheck(operation);
    }); }} />)}
    {insight ? <><Text style={metadataStyles.title}>{insight.source}</Text><Text style={metadataStyles.note}>{insight.text}</Text>
      <MetadataButton title={t('Open original source')} onPress={() => { if (/^https:\/\/[a-z-]+\.wikipedia\.org\/wiki\//.test(insight.url)) void Linking.openURL(insight.url); }} />
      <MetadataButton title={t('Remove local biography')} disabled={busy} onPress={() => { void run(async (operation) => { await saveMetadataRecord('insight', `${kind}:${id}`, undefined, operation); await state.hydrate(true); }); }} /></> : null}
    {busy ? <><ActivityIndicator /><MetadataButton title={t('Cancel request')} onPress={() => request.current?.abort()} /></> : null}
    {message ? <Text style={metadataStyles.note}>{t(message)}</Text> : null}
  </DockScrollView></SettingsPage>;
}
