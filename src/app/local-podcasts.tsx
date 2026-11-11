/* eslint-disable react-hooks/set-state-in-effect -- Source-owned async snapshots are reset before loading another library. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router } from 'expo-router';
import type { Song } from '@/api/subsonic';
import { COVER, songCoverUrl } from '@/api/data';
import { Cover } from '@/components/Cover';
import { GlassPressable } from '@/components/glass';
import { SelectList, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { TrackRow } from '@/components/TrackRow';
import { useMusicToolsCatalog } from '@/hooks/useMusicToolsCatalog';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { currentContentClassifier } from '@/lib/currentContentKind';
import { applySongDisplay } from '@/lib/localMetadata';
import { captureCustomizationOwner, customizationScope } from '@/lib/localCustomizations';
import { groupLocalPodcasts, orderLocalPodcastSongs, type LocalPodcastOrder, type LocalPodcastShow, type LocalPodcastProgressMap } from '@/lib/localPodcasts';
import { loadLocalPodcastProgress, localPodcastProgressScope, markLocalPodcastPlayed, useLocalPodcasts } from '@/store/localPodcasts';
import { useLocalMetadata } from '@/store/localMetadata';
import { usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';
const List = Animated.createAnimatedComponent(FlatList<Song | LocalPodcastShow>);
type Filter = 'all' | 'continue' | 'unplayed' | 'played';
const EMPTY_PROGRESS: LocalPodcastProgressMap = Object.freeze({});
export default function LocalPodcastsPage() {
  useTheme(); const t = useT(), catalog = useMusicToolsCatalog(), bottom = useScreenBottomPadding(), onScroll = useLiquidDockScrollHandler();
  const metadata = useLocalMetadata(), progressState = useLocalPodcasts(), toast = useToast((s) => s.show);
  const [grouped, setGrouped] = useState<{ scope: string; shows: LocalPodcastShow[] }>({ scope: '', shows: [] }), [selected, setSelected] = useState<string>(), [grouping, setGrouping] = useState(false);
  const [filter, setFilter] = useState<Filter>('all'), [order, setOrder] = useState<LocalPodcastOrder>('track'), [busy, setBusy] = useState(false);
  const scope = localPodcastProgressScope(), [error, setError] = useState(false), request = useRef(0);
  const progress = progressState.scope === scope && progressState.ready ? progressState.progress : EMPTY_PROGRESS;
  const invalidateRequest = useCallback(() => { request.current++; }, []);
  useEffect(() => {
    let active = true; const owns = captureCustomizationOwner(customizationScope()); setGrouped({ scope: '', shows: [] }); setSelected(undefined); setError(false); setBusy(false);
    void Promise.all([useLocalMetadata.getState().hydrate(), loadLocalPodcastProgress()]).catch(() => { if (active && owns()) setError(true); });
    return () => { active = false; invalidateRequest(); };
  }, [scope, catalog.scope, invalidateRequest]);
  useEffect(() => {
    let active = true; const owns = captureCustomizationOwner(customizationScope()); setGrouping(true);
    if (!catalog.catalog || !metadata.ready || metadata.scope !== `${customizationScope().profile}|${customizationScope().source}`) { setGrouped({ scope: '', shows: [] }); setGrouping(false); return; }
    void groupLocalPodcasts(catalog.catalog.songs, currentContentClassifier(), () => active && owns(), (song) => applySongDisplay(song, metadata.songs, metadata.aliases)).then((items) => { if (active && owns()) { setGrouped({ scope, shows: items }); setError(false); setGrouping(false); } }, () => { if (active && owns()) { setError(true); setGrouping(false); } });
    return () => { active = false; };
  }, [catalog.catalog, metadata.ready, metadata.scope, metadata.revision, metadata.songs, metadata.aliases, scope]);
  const shows = grouped.scope === scope && catalog.catalog ? grouped.shows : [];
  const selectedShow = shows.find((show) => show.id === selected);
  const matches = (song: Song) => filter === 'all' || filter === 'played' && progress[song.id]?.played || filter === 'unplayed' && !progress[song.id]?.played
    || filter === 'continue' && !progress[song.id]?.played && (progress[song.id]?.positionSec ?? 0) > 0;
  const songs = useMemo(() => selectedShow ? orderLocalPodcastSongs(selectedShow.songs, order).filter((song) => filter === 'all' || filter === 'played' && progress[song.id]?.played || filter === 'unplayed' && !progress[song.id]?.played || filter === 'continue' && !progress[song.id]?.played && (progress[song.id]?.positionSec ?? 0) > 0) : [], [selectedShow, order, filter, progress]);
  const rows: (Song | LocalPodcastShow)[] = selectedShow ? songs : shows.filter((show) => show.songs.some(matches));
  const latest = useRef({ songs, title: selectedShow?.title, progress, current: captureCustomizationOwner(customizationScope()) });
  useLayoutEffect(() => { latest.current = { songs, title: selectedShow?.title, progress, current: captureCustomizationOwner(customizationScope()) }; });
  async function play(id: string, resume = true) {
    const value = latest.current, at = value.songs.findIndex((song) => song.id === id), token = ++request.current;
    if (at < 0 || !value.current()) return; setBusy(true);
    const saved = value.progress[id];
    try {
      await usePlayerStore.getState().playQueue(value.songs, at, value.title ?? t('Local podcasts'), '/local-podcasts', { ordered: true });
      if (token !== request.current || !value.current()) return;
      const state = usePlayerStore.getState();
      if (resume && saved && !saved.played && state.queue[state.index]?.id === id) state.seekTo(Math.max(0, saved.positionSec - 10));
    } catch { if (value.current()) toast(t("Couldn't play")); }
    finally { if (token === request.current) setBusy(false); }
  }
  async function mark(song: Song) {
    const owns = latest.current.current; if (!owns()) return;
    const played = !progress[song.id]?.played, duration = progress[song.id]?.durationSec || song.duration || 0;
    try { await markLocalPodcastPlayed(song.id, played, duration); }
    catch { if (owns()) toast(t('Could not save listening progress')); }
  }
  return <SettingsPage title={selectedShow ? selectedShow.title || t('Untitled podcast') : t('Local podcasts')}>
    <List data={rows} keyExtractor={(item) => item.id} onScroll={onScroll} scrollEventThrottle={16} initialNumToRender={8} maxToRenderPerBatch={6} windowSize={5}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottom }} ListHeaderComponent={<>
        <Text style={settingsStyles.sectionDescription}>{t('Group library files marked as podcasts by album and author. Original files, IDs and server tags are unchanged; this is separate from RSS subscriptions.')}</Text>
        {selectedShow ? <GlassPressable style={styles.button} onPress={() => setSelected(undefined)}><Text style={styles.action}>{t('Back to shows')}</Text></GlassPressable> : null}
        <SelectList<Filter> label={t('Episodes')} value={filter} onChange={setFilter} options={[{ value: 'all', label: t('All') }, { value: 'continue', label: t('Continue listening') }, { value: 'unplayed', label: t('Unplayed') }, { value: 'played', label: t('Played') }]} />
        {selectedShow ? <>
          <SelectList<LocalPodcastOrder> label={t('Sort by')} value={order} onChange={setOrder} options={[{ value: 'track', label: t('Track order') }, { value: 'newest', label: t('Recently added') }, { value: 'oldest', label: t('Oldest added first') }, { value: 'title', label: t('Title') }]} />
          <GlassPressable style={styles.button} disabled={busy || !songs.length} onPress={() => { const next = [...songs].filter((song) => !progress[song.id]?.played).sort((a, b) => (progress[b.id]?.updatedAt ?? 0) - (progress[a.id]?.updatedAt ?? 0))[0] ?? songs[0]; if (next) void play(next.id); }}><Text style={styles.action}>{t('Continue listening')}</Text></GlassPressable>
        </> : null}
        <View style={styles.actions}>
          <GlassPressable style={styles.button} onPress={() => { catalog.refresh(); const owns = captureCustomizationOwner(customizationScope()); void Promise.all([useLocalMetadata.getState().hydrate(undefined, true), loadLocalPodcastProgress()]).catch(() => { if (owns()) toast(t('Could not save listening progress')); }); }}><Text style={styles.action}>{t('Refresh library')}</Text></GlassPressable>
          <GlassPressable style={styles.button} onPress={() => router.push('/metadata')}><Text style={styles.action}>{t('Metadata centre')}</Text></GlassPressable>
        </View>
        {catalog.loading || grouping ? <ActivityIndicator color={colors.accent} /> : null}
        {error || progressState.error || catalog.error || metadata.error ? <Text style={styles.danger}>{t('Could not read local podcasts. Refresh the library to retry.')}</Text> : null}
      </>} ListEmptyComponent={!catalog.loading && !grouping ? <Text style={styles.muted}>{t('No matching local podcast files. Set their content type to Podcast in local metadata editing.')}</Text> : null}
      renderItem={({ item }) => 'songs' in item ? <GlassPressable style={styles.show} onPress={() => setSelected(item.id)}>
        <Cover uri={songCoverUrl(item.songs[0], COVER.thumb)} size={64} /><View style={{ flex: 1 }}><Text style={styles.title}>{item.title || t('Untitled podcast')}</Text><Text style={styles.muted}>{item.author} · {t('{n} episodes', { n: item.songs.length })}</Text></View>
      </GlassPressable> : <View>
        <TrackRow song={item} onPress={() => { void play(item.id); }} />
        <View style={styles.progressRow}><Text style={styles.muted}>{progress[item.id]?.played ? t('Played') : (progress[item.id]?.positionSec ?? 0) > 0 ? t('{n} minutes remaining', { n: Math.ceil(Math.max(0, (progress[item.id]?.durationSec || item.duration || 0) - (progress[item.id]?.positionSec ?? 0)) / 60) }) : t('Unplayed')}</Text>
          <GlassPressable style={styles.button} onPress={() => { void mark(item); }}><Text style={styles.action}>{t(progress[item.id]?.played ? 'Mark as unplayed' : 'Mark as played')}</Text></GlassPressable>
        </View>
      </View>} />
  </SettingsPage>;
}
const styles = themed((theme) => ({
  title: { color: theme.text, fontSize: fontSize.md, fontWeight: '600' }, muted: { color: theme.textSecondary, fontSize: fontSize.sm }, danger: { color: theme.danger },
  show: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, minHeight: 80 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { minHeight: 44, backgroundColor: theme.surface, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginVertical: spacing.sm, justifyContent: 'center' }, action: { color: theme.accent, fontWeight: '600' },
  progressRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', justifyContent: 'space-between' },
}));
