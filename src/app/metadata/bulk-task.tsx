import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SettingsPage } from '@/components/SettingsUI';
import { MetadataButton, metadataStyles } from '@/components/metadata/MetadataUI';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { loadBulkJob, readBulkJobItems, type BulkMetadataJob } from '@/lib/metadata/bulkJobs';
import { metadataOperation } from '@/lib/metadata/repository';
import { useAuthStore } from '@/store/auth';
import { useMetadataBulk } from '@/store/metadataBulk';
import { openMetadataTarget } from '@/store/metadataScraping';
import { spacing, useTheme } from '@/theme';

type Item = Awaited<ReturnType<typeof readBulkJobItems>>[number];
const PAGE = 25;
export default function BulkMetadataTaskScreen() {
  const params = useLocalSearchParams<{ id?: string }>(), id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <BulkMetadataTask key={id} id={id} />;
}
function BulkMetadataTask({ id }: { id?: string }) {
  const palette = useTheme(), t = useT(), bottom = useScreenBottomPadding(), onScroll = useLiquidDockScrollHandler();
  useAuthStore((s) => s.auth); useAuthStore((s) => s.offline); useAuthStore((s) => s.offlineSource); useAuthStore((s) => s.autoOffline);
  const [owner] = useState(() => metadataOperation()), state = useMetadataBulk(), active = owner.current();
  const [stored, setStored] = useState<BulkMetadataJob>(), [items, setItems] = useState<Item[]>([]), [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [resuming, setResuming] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const job = active ? state.jobs.find((entry) => entry.id === id) ?? stored : undefined, alive = useRef(true), busyRef = useRef(false), resumingRef = useRef(false);
  useEffect(() => { alive.current = true; void useMetadataBulk.getState().hydrate(); return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(), operation = metadataOperation(owner.scope, controller.signal, () => alive.current && owner.current());
    if (!id || !active) { setLoading(false); return; }
    setLoading(true);
    // Read only the current visible page. Worker publications never reload the entire queue.
    void Promise.all([loadBulkJob(id, operation), readBulkJobItems(id, page * PAGE, PAGE, operation)]).then(([value, rows]) => {
      if (!operation.current() || controller.signal.aborted) return; setStored(value); setItems(rows); setError('');
    }).catch(() => { if (operation.current() && !controller.signal.aborted) setError('Could not load this metadata task. Tap retry.'); })
      .finally(() => { if (operation.current() && !controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, active, page, revision, job?.updatedAt, owner]);
  async function run(action: () => Promise<void>) {
    if (busyRef.current || !alive.current || !owner.current()) return; busyRef.current = true; setBusy(true); setError('');
    try { await action(); if (owner.current() && alive.current) setRevision((value) => value + 1); }
    catch { if (owner.current() && alive.current) setError('Could not complete this action. Existing progress was kept.'); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => { if (job?.status === 'running') { resumingRef.current = false; setResuming(false); } }, [job?.status]);
  function resume(retryFailed = false) {
    if (!job || !alive.current || !owner.current() || busyRef.current || resumingRef.current) return;
    resumingRef.current = true; setResuming(true); setError('');
    void useMetadataBulk.getState().resume(job.id, retryFailed).catch(() => {
      if (alive.current && owner.current()) setError('Could not resume this task');
    }).finally(() => { resumingRef.current = false; if (alive.current) setResuming(false); });
  }
  const counts = job?.counts;
  return <SettingsPage title={t('Bulk metadata task')}>
    <FlatList<Item> data={active ? items : []} keyExtractor={(item) => item.song.id} onScroll={onScroll} scrollEventThrottle={16}
      initialNumToRender={10} maxToRenderPerBatch={8} windowSize={5} contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottom }}
      ListHeaderComponent={<View style={{ gap: spacing.sm }}>
        {!active ? <Text style={metadataStyles.note}>{t('The music source changed. Reopen this page to choose songs again.')}</Text> : !job || !counts ? <>
          {loading ? <ActivityIndicator color={palette.accent} /> : <Text style={metadataStyles.note}>{t('Metadata task not found')}</Text>}
        </> : <>
          <Text style={metadataStyles.title}>{job.title}</Text><Text style={metadataStyles.label}>{t(job.status)} · {t(job.enumerationDone ? 'Processing queued songs' : 'Reading music in pages')}</Text>
          <Text style={metadataStyles.note}>{t('Scanned {scanned} · Queued {queued} · Processed {processed}', { scanned: counts.scanned, queued: counts.queued, processed: counts.processed })}</Text>
          {!job.enumerationDone && job.status === 'running' ? <ActivityIndicator color={palette.accent} /> : null}
          {job.enumerationDone ? <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: Math.max(1, counts.queued), now: counts.processed }} style={{ height: 7, borderRadius: 4, backgroundColor: palette.surfaceHighlight }}>
            <View style={{ height: 7, borderRadius: 4, backgroundColor: palette.accent, width: `${100 * Math.min(1, counts.processed / Math.max(1, counts.queued))}%` }} />
          </View> : null}
          <Text style={metadataStyles.note}>{t('Saved {applied} · Needs review {review} · Failed {failed} · Skipped {skipped}', { applied: counts.applied, review: counts.needsReview, failed: counts.failed, skipped: counts.skipped })}</Text>
          {job.error ? <Text style={metadataStyles.warning}>{t(job.error)}</Text> : null}
          {job.status === 'running' ? <>
            <MetadataButton title={t('Pause task')} disabled={busy} onPress={() => { void run(() => useMetadataBulk.getState().stop(job.id)); }} />
            <MetadataButton title={t('Cancel task')} disabled={busy} onPress={() => { void run(() => useMetadataBulk.getState().stop(job.id, true)); }} />
          </> : <>
            {job.status === 'paused' ? <MetadataButton title={t('Resume task')} disabled={busy || resuming} onPress={() => resume()} /> : null}
            {counts.failed ? <MetadataButton title={t('Retry failed songs')} disabled={busy || resuming} onPress={() => resume(true)} /> : null}
          </>}
          <Text style={metadataStyles.small}>{t('Leaving this page keeps an active task running with background protection. Paused tasks resume only when you choose. Cancelling keeps completed changes.')}</Text>
        </>}
        {error ? <Text style={metadataStyles.warning}>{t(error)}</Text> : null}
        {error ? <MetadataButton title={t('Retry')} onPress={() => setRevision((value) => value + 1)} /> : null}
        {busy ? <ActivityIndicator color={palette.accent} /> : null}
      </View>}
      renderItem={({ item }) => <View style={{ paddingVertical: spacing.md, gap: spacing.xs, borderBottomWidth: 0.5, borderBottomColor: palette.border }}>
        <Text style={metadataStyles.label} numberOfLines={2}>{item.song.title}</Text><Text style={metadataStyles.note}>{item.song.artist} · {t(item.status)}</Text>
        {item.issue ? <Text style={metadataStyles.warning}>{t(item.issue)}</Text> : null}
        {item.status === 'review' || item.status === 'failed' ? <MetadataButton title={t('Review this song')} onPress={() => {
          if (!owner.current() || !alive.current) return; openMetadataTarget({ kind: 'song', id: item.song.id, title: item.song.title, songs: [item.song] }); router.push('/metadata/song');
        }} /> : null}
      </View>}
      ListFooterComponent={active && job ? <View style={metadataStyles.row}>
        <View style={{ flex: 1 }}><MetadataButton title={t('Previous page')} disabled={!page || busy} onPress={() => setPage(page - 1)} /></View>
        <Text style={metadataStyles.small}>{page + 1}/{Math.max(1, Math.ceil(job.counts.queued / PAGE))}</Text>
        <View style={{ flex: 1 }}><MetadataButton title={t('Next page')} disabled={(page + 1) * PAGE >= job.counts.queued || busy} onPress={() => setPage(page + 1)} /></View>
      </View> : null} />
  </SettingsPage>;
}
