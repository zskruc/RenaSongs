import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { DockScrollView } from '@/components/DockScrollView';
import { MetadataButton, metadataStyles } from '@/components/metadata/MetadataUI';
import { metadataOperation, readMetadataRecord, saveMetadataRecord } from '@/lib/metadata/repository';
import { metadataCheck } from '@/lib/metadata/models';
import { metadataJobSummary, validMetadataJob, type MetadataJob } from '@/lib/metadata/jobs';
import { undoMetadataCandidate } from '@/lib/metadata/apply';
import { useMetadataScraping, openMetadataTarget } from '@/store/metadataScraping';
import { useLocalMetadata } from '@/store/localMetadata';
import { getSong } from '@/api/data';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

export default function MetadataTaskPage() {
  const palette = useTheme(), t = useT(), { id } = useLocalSearchParams<{ id?: string }>(), state = useMetadataScraping();
  const job = state.jobs.find((entry) => entry.id === id), [older, setOlder] = useState<MetadataJob>(), [page, setPage] = useState(0), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const alive = useRef(true), [operation] = useState(() => metadataOperation());
  const shownJob = operation.current() ? job ?? older : undefined;
  useEffect(() => {
    if (id && /^scrape_[a-z0-9_]{1,100}$/.test(id)) void readMetadataRecord<MetadataJob>('job', id, operation).then((value) => {
      if (alive.current && operation.current() && validMetadataJob(value)) setOlder(value);
    }).catch(() => { if (alive.current) setMessage('Could not load this task'); });
    void state.hydrate(); return () => { alive.current = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (action: () => Promise<void>) => {
    if (busy || !operation.current()) return; setBusy(true); setMessage('');
    try { await action(); } catch { if (operation.current()) setMessage('Could not complete this action. Review the task and retry.'); }
    finally { if (alive.current) setBusy(false); }
  };
  const summary = shownJob ? metadataJobSummary(shownJob) : null;
  return <SettingsPage title={t('Metadata task')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    {!shownJob || !summary ? <Text style={metadataStyles.note}>{t('Metadata task not found')}</Text> : <>
      <Text style={metadataStyles.title}>{shownJob.title}</Text><Text style={metadataStyles.note}>{t(shownJob.status)} · {summary.completed}/{summary.total}</Text>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: summary.total, now: summary.completed }} style={{ height: 7, backgroundColor: palette.surfaceHighlight, borderRadius: 4, marginVertical: 14 }}>
        <View style={{ width: `${100 * summary.completed / Math.max(1, summary.total)}%`, height: 7, borderRadius: 4, backgroundColor: palette.accent }} /></View>
      <Text style={metadataStyles.note}>{t('{applied} applied, {failed} failed, {review} need review', { applied: summary.applied, failed: summary.failed, review: summary.review })}</Text>
      {shownJob.status === 'running' ? <>
        <MetadataButton title={t('Pause task')} disabled={busy} onPress={() => { void run(() => state.stop(shownJob.id)); }} />
        <MetadataButton title={t('Cancel remaining work')} disabled={busy} onPress={() => { void run(() => state.stop(shownJob.id, true)); }} />
      </> : <>
        {shownJob.items.some((item) => item.status === 'pending') ? <MetadataButton title={t('Resume task')} disabled={busy} onPress={() => { void state.resume(shownJob.id).catch(() => { if (alive.current) setMessage('Could not resume this task'); }); }} /> : null}
        {summary.failed ? <MetadataButton title={t('Retry failed songs')} disabled={busy} onPress={() => { void state.resume(shownJob.id, true).catch(() => { if (alive.current) setMessage('Could not resume this task'); }); }} /> : null}
        {shownJob.items.some((item) => item.candidate) ? <MetadataButton title={t('Undo applied tag and lyric changes')} disabled={busy} onPress={() => { void run(async () => {
          const owner = operation; let failed = 0; const items = shownJob.items.map((item) => ({ ...item }));
          for (const item of items) {
            if (!item.candidate) continue; metadataCheck(owner);
            try { const song = await getSong(item.song.id); metadataCheck(owner); if (!song) throw new Error('Song unavailable');
              await undoMetadataCandidate(song, item.intentId, owner); item.status = 'skipped'; }
            catch { metadataCheck(owner); failed++; }
          }
          const next = { ...shownJob, items, updatedAt: Date.now() }; await saveMetadataRecord('job', next.id, next, owner); metadataCheck(owner);
          await useLocalMetadata.getState().hydrate(owner.scope, true); await state.hydrate(true); metadataCheck(owner); setMessage(failed ? 'Some edits changed later and were kept for review.' : 'Metadata changes undone');
        }); }} /> : null}
      </>}
      <Text style={metadataStyles.note}>{t('Cancelling keeps completed changes. Undo refuses to overwrite a later manual edit. Local artwork can be restored from its artwork page.')}</Text>
      {shownJob.items.slice(page * 20, page * 20 + 20).map((item) => <View key={item.song.id} style={{ marginVertical: 10 }}>
        <Text style={metadataStyles.label}>{item.song.title}</Text><Text style={metadataStyles.note}>{item.song.artist} · {t(item.status)}{item.issue ? ` · ${t(item.issue)}` : ''}</Text>
        {item.status === 'review' || item.status === 'failed' ? <MetadataButton title={t('Review this song')} onPress={() => {
          openMetadataTarget({ songs: [item.song], kind: 'song', id: item.song.id, title: item.song.title }); router.push('/metadata/song');
        }} /> : null}
      </View>)}
      <View style={metadataStyles.row}><View style={{ flex: 1 }}><MetadataButton title={t('Previous page')} disabled={!page} onPress={() => setPage(page - 1)} /></View>
        <Text style={metadataStyles.note}>{page + 1}/{Math.max(1, Math.ceil(shownJob.items.length / 20))}</Text><View style={{ flex: 1 }}><MetadataButton title={t('Next page')} disabled={(page + 1) * 20 >= shownJob.items.length} onPress={() => setPage(page + 1)} /></View></View>
    </>}
    {busy ? <ActivityIndicator /> : null}{message ? <Text style={metadataStyles.note}>{t(message)}</Text> : null}
  </DockScrollView></SettingsPage>;
}
