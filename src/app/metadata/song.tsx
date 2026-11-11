import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingsGroup, SettingsPage, SettingRow, SwitchList, SelectList, settingsStyles } from '@/components/SettingsUI';
import { MetadataButton, MetadataCandidateCard, MetadataInput, FIELD_LABELS, metadataStyles } from '@/components/metadata/MetadataUI';
import { useMetadataTarget } from '@/lib/metadata/hooks';
import { metadataOperation } from '@/lib/metadata/repository';
import { detailMetadata, searchMetadata } from '@/lib/metadata/providers';
import { metadataCheck, isMetadataCancelled, SCRAPE_FIELDS, type ScrapeCandidate, type ScrapeField } from '@/lib/metadata/models';
import { applyMetadataCandidate, undoMetadataCandidate } from '@/lib/metadata/apply';
import { fetchMetadataArtwork } from '@/lib/metadata/artwork';
import { useMetadataScraping } from '@/store/metadataScraping';
import { useLocalMetadata } from '@/store/localMetadata';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

export default function SongMetadataReview() {
  useTheme(); const t = useT(), target = useMetadataTarget(), song = target?.songs[0], state = useMetadataScraping();
  const [title, setTitle] = useState(song?.title ?? ''), [artist, setArtist] = useState(song?.artist ?? '');
  const [candidates, setCandidates] = useState<ScrapeCandidate[]>([]), [candidate, setCandidate] = useState<ScrapeCandidate>();
  const [fields, setFields] = useState<ScrapeField[]>([...SCRAPE_FIELDS]), [overwrite, setOverwrite] = useState(!state.settings.onlyMissing);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [undo, setUndo] = useState<string>(); const alive = useRef(true), request = useRef<AbortController | undefined>(undefined);
  const local = useLocalMetadata();
  useEffect(() => { void state.hydrate(); return () => { alive.current = false; request.current?.abort(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (action: (operation: ReturnType<typeof metadataOperation>) => Promise<void>) => {
    if (!song || !target || busy) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const operation = metadataOperation(target.scope, controller.signal, () => alive.current && (!target.current || target.current())); setBusy(true); setMessage('');
    try { await action(operation); } catch (error) { if (!isMetadataCancelled(error) && operation.current()) setMessage('Could not complete this request. Existing data was kept.'); }
    finally { if (alive.current) setBusy(false); }
  };
  const available = candidate ? SCRAPE_FIELDS.filter((field) => field === 'cover' ? !!candidate.coverUrl : field === 'lyrics' ? !!candidate.lyrics : candidate.fields[field] !== undefined) : [];
  return <SettingsPage title={t('Review song metadata')}><DockScrollView contentContainerStyle={settingsStyles.content} keyboardShouldPersistTaps="handled">
    {!song ? <Text style={metadataStyles.note}>{t('Choose a song first.')}</Text> : <>
      <Text style={metadataStyles.label}>{song.title}</Text><Text style={metadataStyles.note}>{song.artist}</Text>
      <SelectList label={t('Media classification')} value={local.songs[song.id]?.patch.mediaKind ?? song.mediaKind ?? 'music'}
        options={[{ value: 'music', label: t('Music') }, { value: 'podcast', label: t('Podcast') }, { value: 'audiobook', label: t('Audiobook') }]}
        onChange={(value) => { void run(async (operation) => { const id = `edit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; setUndo(id);
          await applyMetadataCandidate(song, { id: 'manual:kind', provider: 'manual', externalId: song.id, fields: { mediaKind: value } }, ['mediaKind'], true, operation, id);
          metadataCheck(operation); setUndo(id); await useLocalMetadata.getState().hydrate(operation.scope, true); setMessage('Metadata saved inside this app'); }); }} />
      <MetadataInput label={t('Search title')} value={title} onChangeText={setTitle} editable={!busy} />
      <MetadataInput label={t('Search artist')} value={artist} onChangeText={setArtist} editable={!busy} />
      <MetadataButton title={t('Search metadata and lyrics')} disabled={busy || !title.trim()} onPress={() => { void run(async (operation) => {
        const result = await searchMetadata({ ...song, title: title.trim(), artist: artist.trim() }, state.settings, state.profiles, operation);
        metadataCheck(operation); setCandidates(result.candidates); setCandidate(undefined); setConfirmed(false);
        setMessage(result.issues.length ? 'Some sources were unavailable. Other results are shown.' : !result.candidates.length ? 'No matching candidates found' : '');
      }); }} />
      {busy ? <><ActivityIndicator /><MetadataButton title={t('Cancel request')} onPress={() => request.current?.abort()} /></> : null}
      {message ? <Text style={metadataStyles.note}>{t(message)}</Text> : null}
      {candidates.slice(0, 40).map((entry) => <MetadataCandidateCard key={entry.id} candidate={entry} selected={entry.id === candidate?.id} onPress={() => { void run(async (operation) => {
        const detail = await detailMetadata(entry, state.profiles, operation); metadataCheck(operation); setCandidate({ ...detail, confident: entry.confident, reasons: entry.reasons }); setConfirmed(false);
      }); }} />)}
      {candidate ? <>
        <Text style={metadataStyles.title}>{t('Compare before applying')}</Text>
        <Text style={metadataStyles.note}>{t('Only selected fields are saved locally. Audio files and server metadata are not written.')}</Text>
        {available.map((field) => <View key={field} style={{ marginVertical: 6 }}><Text style={metadataStyles.label}>{t(FIELD_LABELS[field])}</Text>
          <Text style={metadataStyles.note}>{field === 'lyrics' ? candidate.lyrics?.lines.slice(0, 6).map((line) => line.value).join('\n') : field === 'cover' ? t('High-resolution artwork')
            : `${field === 'genres' ? (song.genres ?? []).map((genre) => genre.name).join(' / ') : song[field] ?? '—'} → ${field === 'genres' ? candidate.fields.genres?.map((genre) => genre.name).join(' / ') : candidate.fields[field] ?? '—'}`}</Text></View>)}
        <SettingsGroup><SwitchList options={[{ label: t('Replace selected existing fields'), value: overwrite, onChange: setOverwrite },
          ...(!candidate.confident ? [{ label: t('I checked this recording and version'), value: confirmed, onChange: setConfirmed }] : [])]} /></SettingsGroup>
        <MetadataFieldsInline fields={fields} available={available} onChange={setFields} />
        <MetadataButton title={t('Apply selected fields locally')} disabled={busy || !fields.some((field) => available.includes(field)) || !candidate.confident && !confirmed} onPress={() => { void run(async (operation) => {
          const chosen = fields.filter((field) => available.includes(field));
          const id = `edit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; setUndo(id);
          await applyMetadataCandidate(song, candidate, chosen, overwrite, operation, id); metadataCheck(operation);
          if (chosen.includes('cover') && candidate.coverUrl) await fetchMetadataArtwork(candidate.coverUrl, 'song', song.id, operation);
          await useLocalMetadata.getState().hydrate(operation.scope, true); await state.hydrate(true); metadataCheck(operation); setMessage('Metadata saved inside this app');
        }); }} />
      </> : null}
      {undo ? <MetadataButton title={t('Undo these changes')} disabled={busy} onPress={() => { void run(async (operation) => {
        await undoMetadataCandidate(song, undo, operation); await useLocalMetadata.getState().hydrate(operation.scope, true); metadataCheck(operation); setUndo(undefined); setMessage('Metadata changes undone');
      }); }} /> : null}
      <SettingRow label={t('Choose local artwork')} chevron onPress={() => router.push('/metadata/artwork')} />
      <Text style={metadataStyles.note}>{t('Lyrics sources remain available in the existing lyrics tools. A manual lyric edit keeps priority until you restore its source.')}</Text>
    </>}
  </DockScrollView></SettingsPage>;
}
function MetadataFieldsInline({ fields, available, onChange }: { fields: ScrapeField[]; available: ScrapeField[]; onChange: (fields: ScrapeField[]) => void }) {
  const t = useT(); return <SettingsGroup><SwitchList options={available.map((field) => ({ label: t(FIELD_LABELS[field]), value: fields.includes(field),
    onChange: (value) => onChange(value ? [...fields, field] : fields.filter((entry) => entry !== field)) }))} /></SettingsGroup>;
}
