import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SettingsPage, SettingsGroup, SwitchList, SelectList, settingsStyles } from '@/components/SettingsUI';
import { DockScrollView } from '@/components/DockScrollView';
import { MetadataButton, MetadataInput, MetadataFields, metadataStyles } from '@/components/metadata/MetadataUI';
import { useMetadataTarget } from '@/lib/metadata/hooks';
import { metadataOperation } from '@/lib/metadata/repository';
import { metadataReleaseTracks, searchMetadataReleases } from '@/lib/metadata/providers';
import { matchReleaseTracks } from '@/lib/metadata/matching';
import { metadataCheck, isMetadataCancelled, type ScrapeCandidate, type ScrapeField, type ScrapeRelease } from '@/lib/metadata/models';
import { useMetadataScraping } from '@/store/metadataScraping';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

export default function BatchMetadataReview() {
  useTheme(); const t = useT(), target = useMetadataTarget(), state = useMetadataScraping();
  const [mode, setMode] = useState<'search' | 'release' | 'edit'>('search'), [overwrite, setOverwrite] = useState(!state.settings.onlyMissing);
  const [fields, setFields] = useState<ScrapeField[]>(['title', 'artist', 'albumArtist', 'album', 'year', 'genres', 'track', 'discNumber']);
  const [title, setTitle] = useState(target?.kind === 'album' ? target.title ?? target.songs[0]?.album ?? '' : ''), [artist, setArtist] = useState(target?.songs[0]?.artist ?? '');
  const [provider, setProvider] = useState<'itunes' | 'musicbrainz'>('itunes'), [releases, setReleases] = useState<ScrapeRelease[]>([]), [release, setRelease] = useState<ScrapeRelease>();
  const [tracks, setTracks] = useState<ScrapeCandidate[]>([]), [assignments, setAssignments] = useState<Map<string, ScrapeCandidate>>(new Map());
  const [page, setPage] = useState(0), [choosing, setChoosing] = useState<string>(), [trackQuery, setTrackQuery] = useState('');
  const [albumArtist, setAlbumArtist] = useState(''), [album, setAlbum] = useState(''), [genres, setGenres] = useState(''), [year, setYear] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirmed, setConfirmed] = useState(false);
  const alive = useRef(true), controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => { void state.hydrate(); return () => { alive.current = false; controller.current?.abort(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (action: (operation: ReturnType<typeof metadataOperation>) => Promise<void>) => {
    if (!target || busy) return; const next = new AbortController(); controller.current = next;
    const operation = metadataOperation(target.scope, next.signal, () => alive.current && (!target.current || target.current())); setBusy(true); setMessage('');
    try { await action(operation); } catch (error) { if (!isMetadataCancelled(error) && operation.current()) setMessage('Could not complete this request. Existing data was kept.'); }
    finally { if (alive.current) setBusy(false); }
  };
  const songs = target?.songs ?? [], shown = songs.slice(page * 20, page * 20 + 20);
  const commonFields: ScrapeField[] = [...(albumArtist.trim() ? ['albumArtist' as const] : []), ...(album.trim() ? ['album' as const] : []), ...(genres.trim() ? ['genres' as const] : []), ...(year.trim() ? ['year' as const] : [])];
  const yearValid = !year || /^\d{4}$/.test(year) && Number(year) >= 1000 && Number(year) <= 3000;
  return <SettingsPage title={t('Batch metadata review')}><DockScrollView contentContainerStyle={settingsStyles.content} keyboardShouldPersistTaps="handled">
    <Text style={metadataStyles.note}>{t('{n} songs selected', { n: songs.length })}</Text>
    <Text style={metadataStyles.note}>{t('Only these selected songs are processed. Nothing is written to NAS or audio files.')}</Text>
    <SelectList label={t('Batch action')} value={mode} onChange={(value) => { setMode(value); setConfirmed(false); }} options={[
      { value: 'search', label: t('Find matching metadata for each song') }, { value: 'release', label: t('Match a specific album release') }, { value: 'edit', label: t('Apply shared tag corrections') },
    ]} />
    {mode === 'release' ? <>
      <MetadataInput label={t('Album title')} value={title} onChangeText={setTitle} editable={!busy} />
      <MetadataInput label={t('Artist')} value={artist} onChangeText={setArtist} editable={!busy} />
      <SelectList label={t('Source')} value={provider} onChange={setProvider} options={[{ value: 'itunes', label: 'iTunes' }, { value: 'musicbrainz', label: 'MusicBrainz' }]} />
      <MetadataButton title={t('Search album releases')} disabled={busy || !title.trim()} onPress={() => { void run(async (operation) => {
        const found = await searchMetadataReleases(title.trim(), artist.trim(), provider, operation); metadataCheck(operation); setReleases(found); setRelease(undefined); setAssignments(new Map());
      }); }} />
      {releases.slice(0, 25).map((entry) => <MetadataButton key={entry.id} title={[entry.title, entry.artist, entry.year, entry.edition, entry.count ? `${entry.count}` : ''].filter(Boolean).join(' · ')} disabled={busy} onPress={() => { void run(async (operation) => {
        const rows = await metadataReleaseTracks(entry, operation); metadataCheck(operation); setTracks(rows); setRelease(entry); setAssignments(matchReleaseTracks(songs, rows)); setConfirmed(false);
      }); }} />)}
      {release ? <><Text style={metadataStyles.title}>{release.title}</Text><Text style={metadataStyles.note}>{t('{n} of {total} tracks matched', { n: assignments.size, total: songs.length })}</Text>
        <Text style={metadataStyles.note}>{t('Unmatched or ambiguous tracks wait for review. A release track cannot be assigned twice.')}</Text>
        {shown.map((song) => <MetadataButton key={song.id} title={`${song.track ?? '—'} · ${song.title} → ${assignments.get(song.id)?.fields.title ?? t('Needs review')}`} onPress={() => { setChoosing(song.id); setTrackQuery(''); }} />)}
        <View style={metadataStyles.row}><View style={{ flex: 1 }}><MetadataButton title={t('Previous page')} disabled={!page} onPress={() => setPage(page - 1)} /></View><View style={{ flex: 1 }}><MetadataButton title={t('Next page')} disabled={(page + 1) * 20 >= songs.length} onPress={() => setPage(page + 1)} /></View></View>
      </> : null}
      {choosing ? <><Text style={metadataStyles.title}>{t('Choose a release track')}</Text><MetadataInput label={t('Filter release tracks')} value={trackQuery} onChangeText={setTrackQuery} />
        <MetadataButton title={t('Leave this song for review')} onPress={() => { setAssignments((current) => { const next = new Map(current); next.delete(choosing); return next; }); setChoosing(undefined); }} />
        {tracks.filter((entry) => !trackQuery.trim() || `${entry.fields.title} ${entry.fields.track}`.toLocaleLowerCase().includes(trackQuery.toLocaleLowerCase())).slice(0, 30).map((entry) => <MetadataButton key={entry.id}
          title={`${entry.fields.discNumber ?? 1}.${entry.fields.track ?? '—'} ${entry.fields.title}`} disabled={[...assignments].some(([id, value]) => id !== choosing && value.id === entry.id)}
          onPress={() => { setAssignments((current) => new Map(current).set(choosing, entry)); setChoosing(undefined); }} />)}
      </> : null}
    </> : null}
    {mode === 'edit' ? <>
      <MetadataInput label={t('Album artist')} value={albumArtist} onChangeText={setAlbumArtist} editable={!busy} />
      <MetadataInput label={t('Album')} value={album} onChangeText={setAlbum} editable={!busy} />
      <MetadataInput label={t('Genres separated by semicolons')} value={genres} onChangeText={setGenres} editable={!busy} />
      <MetadataInput label={t('Year')} value={year} onChangeText={setYear} editable={!busy} />
      <Text style={metadataStyles.note}>{t('Blank fields are left unchanged. Shared corrections do not rename files or merge artist IDs.')}</Text>
      {!yearValid ? <Text style={metadataStyles.warning}>{t('Enter a four-digit year')}</Text> : null}
    </> : <MetadataFields fields={fields} onChange={setFields} />}
    <SettingsGroup><SwitchList options={[{ label: t('Replace selected existing fields'), value: overwrite, onChange: setOverwrite },
      { label: t('I reviewed this batch'), value: confirmed, onChange: setConfirmed }]} /></SettingsGroup>
    {busy ? <><ActivityIndicator /><MetadataButton title={t('Cancel request')} onPress={() => controller.current?.abort()} /></> : null}
    {message ? <Text style={metadataStyles.note}>{t(message)}</Text> : null}
    <MetadataButton title={t('Start metadata task')} disabled={busy || !confirmed || !songs.length || (mode === 'edit' ? !commonFields.length || !yearValid : !fields.length) || mode === 'release' && !assignments.size}
      onPress={() => { void run(async (operation) => {
        let selected = mode === 'release' ? assignments : undefined;
        if (mode === 'edit') selected = new Map(songs.map((song) => [song.id, { id: `manual:${song.id}`, externalId: song.id, provider: 'manual', confident: true,
          fields: { ...(albumArtist.trim() ? { albumArtist: albumArtist.trim() } : {}), ...(album.trim() ? { album: album.trim() } : {}),
            ...(genres.trim() ? { genres: [...new Set(genres.split(';').map((entry) => entry.trim()).filter(Boolean))].slice(0, 30).map((name) => ({ name })) } : {}), ...(year ? { year: Number(year) } : {}) } }]));
        metadataCheck(operation); const id = await state.start(songs, target?.title ?? t('Metadata task'), mode === 'edit' ? commonFields : fields, overwrite, selected);
        metadataCheck(operation); router.push({ pathname: '/metadata/task', params: { id } });
      }); }} />
  </DockScrollView></SettingsPage>;
}
