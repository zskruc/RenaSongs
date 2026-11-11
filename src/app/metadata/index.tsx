import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { SettingsGroup, SettingsPage, SettingRow, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { DockScrollView } from '@/components/DockScrollView';
import { MetadataButton, metadataStyles } from '@/components/metadata/MetadataUI';
import { useMetadataScraping, metadataTargetIsCurrent } from '@/store/metadataScraping';
import { useMetadataBulk } from '@/store/metadataBulk';
import { metadataJobSummary } from '@/lib/metadata/jobs';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

const TITLES: Record<string, string> = { itunes: 'iTunes', musicbrainz: 'MusicBrainz', lrclib: 'LRCLIB', amll: 'AMLL TTML' };
export default function MetadataCentre() {
  useTheme(); const t = useT(), state = useMetadataScraping(), [busy, setBusy] = useState(false);
  const bulkJobs = useMetadataBulk((s) => s.jobs);
  useEffect(() => { void useMetadataScraping.getState().hydrate(true); void useMetadataBulk.getState().hydrate(true); }, []);
  const save = async (enabled: string[], order = state.settings.order, onlyMissing = state.settings.onlyMissing) => {
    if (busy) return; setBusy(true);
    try { await state.saveSettings({ version: 1, enabled, order, onlyMissing }); }
    catch { useToast.getState().show(t('Could not save metadata settings')); } finally { setBusy(false); }
  };
  const providers = [...new Set([...state.settings.order, ...state.profiles.map((profile) => profile.id)])];
  return <SettingsPage title={t('Metadata centre')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <Text style={metadataStyles.note}>{t('Changes stay inside this app. NAS files, server tags, playback IDs and your glass settings are unchanged.')}</Text>
    {!state.ready ? <ActivityIndicator /> : null}
    {state.error ? <MetadataButton title={t('Retry')} onPress={() => { void state.hydrate(true); }} /> : null}
    <SettingsGroup><SettingRow label={t('Batch scrape metadata')} description={t('All music, missing fields, selected songs, albums, artists and playlists')} chevron onPress={() => router.push('/metadata/bulk')} /></SettingsGroup>
    {metadataTargetIsCurrent(state.target) ? <SettingsGroup>
      {state.target.songs.length ? <SettingRow label={t(state.target.songs.length === 1 ? 'Find metadata for this song' : 'Batch metadata review')} description={state.target.title ?? state.target.songs[0].title}
        chevron onPress={() => router.push(state.target!.songs.length === 1 ? '/metadata/song' : '/metadata/batch')} /> : null}
      {state.target.id ? <SettingRow label={t('Choose local artwork')} chevron onPress={() => router.push('/metadata/artwork')} /> : null}
      {state.target.kind !== 'song' && state.target.id ? <SettingRow label={t('Find a sourced biography')} chevron onPress={() => router.push('/metadata/insight')} /> : null}
    </SettingsGroup> : <Text style={metadataStyles.note}>{t('Open a song, album or artist menu to choose what to edit.')}</Text>}
    <Text style={settingsStyles.sectionTitle}>{t('Apply policy')}</Text>
    <SettingsGroup><SwitchList options={[{ label: t('Only fill missing tag fields'), description: t('Existing tag fields and manual corrections are kept. Turn off to review replacements.'),
      value: state.settings.onlyMissing, onChange: (value) => { void save(state.settings.enabled, state.settings.order, value); } }]} /></SettingsGroup>
    <Text style={settingsStyles.sectionTitle}>{t('Sources in priority order')}</Text>
    {providers.map((id, index) => <View key={id}><SettingsGroup><SwitchList options={[{ label: TITLES[id] ?? state.profiles.find((profile) => profile.id === id)?.name ?? id,
      value: state.settings.enabled.includes(id), onChange: (value) => { void save(value ? [...state.settings.enabled, id] : state.settings.enabled.filter((entry) => entry !== id)); } }]} /></SettingsGroup>
      <View style={metadataStyles.row}><View style={{ flex: 1 }}><MetadataButton title={t('Move up')} disabled={busy || !index} onPress={() => { const order = [...providers]; [order[index - 1], order[index]] = [order[index], order[index - 1]]; void save(state.settings.enabled, order); }} /></View>
        <View style={{ flex: 1 }}><MetadataButton title={t('Move down')} disabled={busy || index === providers.length - 1} onPress={() => { const order = [...providers]; [order[index + 1], order[index]] = [order[index], order[index + 1]]; void save(state.settings.enabled, order); }} /></View></View>
    </View>)}
    <SettingRow label={t('Custom scraping sources')} description={t('Import a JSON file or HTTPS configuration. Review domains and capabilities before enabling.')} chevron onPress={() => router.push('/metadata/sources')} />
    <Text style={settingsStyles.sectionTitle}>{t('Metadata tasks')}</Text>
    <Text style={metadataStyles.note}>{t('Tasks start only after your action. Interrupted work can be resumed; paused tasks never restart automatically.')}</Text>
    {bulkJobs.map((job) => <SettingRow key={job.id} label={job.title} description={`${t(job.status)} · ${job.counts.processed}/${job.counts.queued}${job.enumerationDone ? '' : '+'} · ${t('{n} need review', { n: job.counts.needsReview })}`}
      chevron onPress={() => router.push({ pathname: '/metadata/bulk-task', params: { id: job.id } })} />)}
    {state.jobs.map((job) => { const summary = metadataJobSummary(job); return <SettingRow key={job.id} label={job.title} description={`${t(job.status)} · ${summary.completed}/${summary.total} · ${t('{n} need review', { n: summary.review })}`}
      chevron onPress={() => router.push({ pathname: '/metadata/task', params: { id: job.id } })} />; })}
  </DockScrollView></SettingsPage>;
}
