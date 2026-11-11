/** Local listening dashboard: recorded facts, calendar, trends and bounded rankings. */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { getSong } from '@/api/data';
import { DockScrollView } from '@/components/DockScrollView';
import Icon from '@/components/Icon';
import { SelectList, SettingRow, SettingsGroup, SettingsPage, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { ListeningDashboardHeader, ListeningSegments } from '@/components/stats/ListeningDashboard';
import { ListeningPodium, ListeningRankRow } from '@/components/stats/ListeningRankings';
import { useListeningReport } from '@/hooks/useListeningReport';
import { useT } from '@/i18n';
import type { ListeningContentKind } from '@/lib/contentKind';
import type { ListeningPeriod } from '@/lib/listeningMath';
import type { ListeningRankSort } from '@/lib/listeningDb';
import { listeningRankItems, type ListeningRankItem, type ListeningRankTab } from '@/lib/listeningPresentation';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { themed, useTheme } from '@/theme';

export default function ListeningStatsPage() {
  const theme = useTheme(), t = useT();
  const model = useListeningReport();
  const language = useSettings((state) => state.language);
  const playing = usePlayerStore(currentSong);
  const toast = useToast((state) => state.show);
  const latestOpen = useRef(0);
  const [tab, setTab] = useState<ListeningRankTab>('songs');
  const [expanded, setExpanded] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { setting } = useLocalSearchParams<{ setting?: string }>();
  const { setPeriod } = model;
  useEffect(() => { if (setting === 'Year') setPeriod('year'); }, [setting, setPeriod]);
  const rankTab = model.kind === 'music' ? tab : 'songs';
  const ranks = useMemo(() => listeningRankItems(model.report, rankTab, model.kind), [model.report, rankTab, model.kind]);
  const scope = `${model.profile}|${model.kind}|${model.range.from}|${model.range.until}|${model.sort}|${rankTab}`;
  const full = expanded === scope;
  const podium = ranks.length >= 3 ? ranks.slice(0, 3) : [];
  const visible = ranks.slice(podium.length, full ? ranks.length : 10);
  const peak = Math.max(1, ...ranks.map((item) => model.sort === 'plays' ? item.plays : item.seconds));
  const onOpen = useCallback(async (item: ListeningRankItem) => {
    if (!model.canAct() || !item.id) return;
    const token = ++latestOpen.current;
    const owns = () => latestOpen.current === token && model.canAct();
    if (item.kind === 'artists') { router.push({ pathname: '/artist/[id]', params: { id: item.id } }); return; }
    if (item.kind === 'albums') { router.push({ pathname: '/album/[id]', params: { id: item.id } }); return; }
    if (item.song.podcastChannelId) {
      router.push({ pathname: '/podcast-episode/[id]', params: { id: item.song.id, channelId: item.song.podcastChannelId } }); return;
    }
    try {
      const song = await getSong(item.song.id);
      if (!song) throw new Error('Song not found');
      if (owns()) await usePlayerStore.getState().playQueue([song], 0, 'listening-stats', '/settings/listening-stats');
    } catch { if (owns()) toast(t("Couldn't play")); }
  }, [model.canAct, toast, t]);

  const controls = <>
    <ListeningSegments<ListeningContentKind> label={t('Content statistics')} value={model.kind} onChange={model.setKind} options={[
      { value: 'music', label: t('Music') }, { value: 'podcast', label: t('Podcasts') }, { value: 'audiobook', label: t('Audiobooks') },
    ]} />
    <ListeningSegments<ListeningPeriod> label={t('Report period')} value={model.period} onChange={model.setPeriod} options={[
      { value: 'week', label: t('7 days') }, { value: 'month', label: t('30 days') }, { value: 'year', label: t('Year') }, { value: 'all', label: t('All time') },
    ]} />
    {model.period === 'year' ? <SelectList label={t('Year')} value={model.year} onChange={model.setYear} options={model.years} /> : null}
  </>;
  const rankingControls = <>
    {model.kind === 'music' ? <ListeningSegments<ListeningRankTab> label={t('Ranking category')} value={rankTab} onChange={setTab} options={[
      { value: 'songs', label: t('Songs') }, { value: 'artists', label: t('Artists') }, { value: 'albums', label: t('Albums') },
    ]} /> : <Text style={styles.rankSubtitle}>{t(model.kind === 'podcast' ? 'Most listened episodes' : 'Most listened chapters')}</Text>}
    <ListeningSegments<ListeningRankSort> label={t('Ranking order')} value={model.sort} onChange={model.setSort} options={[
      { value: 'seconds', label: t('By listening time') }, { value: 'plays', label: t('By play count') },
    ]} />
    <Text style={styles.rankNote}>{t('Showing top {n} of {total}', { n: ranks.length, total: rankTab === 'artists' ? model.report?.artistCount ?? 0 : rankTab === 'albums' ? model.report?.albumCount ?? 0 : model.report?.songs ?? 0 })}</Text>
  </>;
  return <SettingsPage title={t('Listening statistics')}>
    <DockScrollView contentContainerStyle={[settingsStyles.content, styles.content]}>
      <ListeningDashboardHeader report={model.report} period={model.period} year={model.year} at={model.at} range={model.range}
        language={language} kind={model.kind} pending={model.initialLoading} refreshing={model.refreshing} error={model.error}
        controls={controls} rankingControls={rankingControls} onRefresh={model.refresh}
        podium={podium.length ? <ListeningPodium items={podium} sort={model.sort} language={language} onOpen={onOpen} /> : null} />
      {model.report && (model.report.seconds > 0 || model.report.plays > 0) ? <View style={styles.rankingPanel}>
        {visible.map((item, index) => <ListeningRankRow key={item.key} item={item} position={index + podium.length + 1} language={language}
          sort={model.sort} peak={peak} current={item.kind === 'songs' && playing?.id === item.id} onOpen={onOpen} />)}
        {!ranks.length ? <Text style={styles.note}>{t('No items available for this ranking')}</Text> : null}
        {ranks.length > 10 ? <Pressable accessibilityRole="button" onPress={() => setExpanded(full ? '' : scope)} style={styles.more}>
          <Text style={styles.moreText}>{full ? t('Show less') : t('Show all {n}', { n: ranks.length })}</Text><Icon name={full ? 'chevron-up' : 'chevron-down'} size={16} color={theme.accent} />
        </Pressable> : null}
      </View> : null}
      <View style={styles.footer}>
        {model.kind === 'music' ? <SettingsGroup><SettingRow icon="stats-chart-outline" label={t('All-time most played')}
          description={t('Uses the existing server or local play counter.')} chevron onPress={() => { if (model.canAct()) router.push('/browse/songs?sort=frequent'); }} /></SettingsGroup> : null}
        <SettingsGroup title={t('Recording & privacy')}>
          <SwitchList options={[{ label: t('Record listening on this device'), description: t('Only actual advancing playback is counted. Seeking and buffering are excluded.'),
            value: model.recordingEnabled, disabled: model.recordingDisabled, onChange: model.toggleRecording }]} />
        </SettingsGroup>
        <Text style={styles.note}>{model.startedAt ? t('Recording since {date}. Older listening time is not reconstructed.', { date: new Date(model.startedAt).toLocaleDateString(language) })
          : t('Reports start when music plays in this version. No past listening time is invented.')}</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen(!detailsOpen)} style={styles.notesToggle}><Text style={styles.notesTitle}>{t('How listening is counted')}</Text><Icon name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={theme.textSecondary} /></Pressable>
        {detailsOpen ? <>
        <Text style={styles.note}>{t('A session counts after 30 seconds, or half of a shorter song.')}</Text>
        <Text style={styles.note}>{t('Seeking does not add a session. Continuous repeats of the same song count as one session.')}</Text>
        <Text style={styles.note}>{t('Music, podcasts and audiobooks are recorded separately from this version. Earlier totals are preserved without guessing their content type.')}</Text>
        </> : null}
        {model.error && model.report ? <Text accessibilityRole="alert" style={styles.error}>{t('Could not refresh the report. Your saved statistics are kept.')}</Text> : null}
      </View>
    </DockScrollView>
  </SettingsPage>;
}
const styles = themed((c) => ({
  content: { gap: 0 },
  rankingPanel: { backgroundColor: c.surface, borderRadius: 18, overflow: 'hidden', marginTop: 10 },
  rankSubtitle: { color: c.textSecondary, fontSize: 14, lineHeight: 21 },
  rankNote: { color: c.textSecondary, fontSize: 12, lineHeight: 19, marginLeft: 4 },
  more: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderTopWidth: 0.5, borderTopColor: c.border },
  moreText: { color: c.accent, fontSize: 14, fontWeight: '600' },
  footer: { gap: 8, marginTop: 26 },
  note: { color: c.textSecondary, fontSize: 12, lineHeight: 20, paddingHorizontal: 4 },
  notesToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  notesTitle: { color: c.textSecondary, fontSize: 13, lineHeight: 20, fontWeight: '500' },
  error: { color: c.danger, fontSize: 13, lineHeight: 20, paddingHorizontal: 4 },
}));
