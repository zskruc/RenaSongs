import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { COVER, coverArtUrl, songCoverUrl } from '@/api/data';
import { Cover } from '@/components/Cover';
import Icon from '@/components/Icon';
import { useT } from '@/i18n';
import { useDisplaySong } from '@/hooks/useLocalMetadata';
import { listeningDurationParts, type ListeningRankItem } from '@/lib/listeningPresentation';
import type { ListeningRankSort } from '@/lib/listeningDb';
import { fontSize, themed, useTheme } from '@/theme';

function Artwork({ item, size }: { item: ListeningRankItem; size: number }) {
  const uri = item.kind === 'artists' ? coverArtUrl(item.id, COVER.thumb) : songCoverUrl(item.song, COVER.thumb);
  return <Cover uri={uri} size={size} rounded={item.kind === 'artists'} transition={0} placeholderIcon={item.kind === 'artists' ? 'person' : 'musical-note'} />;
}
function PodiumItem({ item, index, language, sort, onOpen }: { item: ListeningRankItem; index: number; language: string; sort: ListeningRankSort; onOpen: (item: ListeningRankItem) => void }) {
  const theme = useTheme(), t = useT(), displayed = useDisplaySong(item.song);
  const title = item.kind === 'songs' ? displayed.title : item.kind === 'albums' ? displayed.album ?? item.title : displayed.artist ?? item.title;
  const winner = index === 0, size = winner ? 78 : 62;
  const duration = listeningDurationParts(item.seconds, language);
  const time = `${duration.value} ${t(duration.unit)}`, count = t('{n} plays', { n: item.plays });
  return <Pressable disabled={!item.id} accessibilityRole={item.id ? 'button' : undefined}
    accessibilityLabel={t('Rank {n}: {title}', { n: index + 1, title })}
    onPress={() => onOpen(item)} style={({ pressed }) => [styles.podiumColumn, pressed && { opacity: 0.65 }]}>
    <View style={[styles.podiumArtwork, { height: winner ? 96 : 78 }]}>
      {winner ? <Icon name="trophy" size={17} color={theme.accent} style={{ marginBottom: 6 }} /> : null}
      <Artwork item={item} size={size} />
    </View>
    <Text style={styles.podiumTitle} numberOfLines={2}>{title || t(item.kind === 'albums' ? 'Unknown album' : 'Unknown artist')}</Text>
    <View style={styles.podiumValues}><Text style={styles.podiumPrimary}>{sort === 'plays' ? count : time}</Text><Text style={styles.podiumTime}>{sort === 'plays' ? time : count}</Text></View>
    <View style={[styles.podiumStep, { height: winner ? 42 : index === 1 ? 30 : 24, backgroundColor: theme.surfaceHighlight }]}>
      <Text style={[styles.podiumNumber, winner && { color: theme.accent }]}>{String(index + 1).padStart(2, '0')}</Text>
    </View>
  </Pressable>;
}
export function ListeningPodium({ items, language, sort = 'seconds', onOpen }: { items: ListeningRankItem[]; language: string; sort?: ListeningRankSort; onOpen: (item: ListeningRankItem) => void }) {
  useTheme();
  if (items.length < 3) return null;
  return <View style={styles.podium}>{[1, 0, 2].map((index) => <PodiumItem key={items[index].key} item={items[index]} index={index} language={language} sort={sort} onOpen={onOpen} />)}</View>;
}
export const ListeningRankRow = memo(function ListeningRankRow({ item, position, language, sort, peak, current, onOpen }: {
  item: ListeningRankItem; position: number; language: string; sort: ListeningRankSort; peak: number; current: boolean; onOpen: (item: ListeningRankItem) => void;
}) {
  const theme = useTheme(), t = useT(), displayed = useDisplaySong(item.song), duration = listeningDurationParts(item.seconds, language);
  const title = item.kind === 'songs' ? displayed.title : item.kind === 'albums' ? displayed.album ?? item.title : displayed.artist ?? item.title;
  const subtitle = item.kind === 'songs' ? displayed.artist : item.subtitle;
  const value = sort === 'plays' ? item.plays : item.seconds;
  return <Pressable disabled={!item.id} accessibilityRole={item.id ? 'button' : undefined}
    accessibilityLabel={t('Rank {n}: {title}', { n: position, title })}
    onPress={() => onOpen(item)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surfaceHighlight }]}>
    <Text numberOfLines={1} style={styles.rank}>{position}</Text>
    <Artwork item={item} size={42} />
    <View style={styles.info}>
      <Text style={[styles.title, current && { color: theme.accent }]} numberOfLines={1}>{title || t(item.kind === 'albums' ? 'Unknown album' : 'Unknown artist')}</Text>
      {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(0, Math.min(1, value / Math.max(1, peak))) * 100}%`, backgroundColor: theme.accent }]} /></View>
    </View>
    <View style={styles.values}>
      <Text style={styles.count}>{t('{n} plays', { n: item.plays })}</Text>
      <Text style={styles.time}>{duration.value} {t(duration.unit)}</Text>
    </View>
  </Pressable>;
});
const styles = themed((c) => ({
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingTop: 16, paddingHorizontal: 12 },
  podiumColumn: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'flex-end' },
  podiumArtwork: { alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 },
  podiumTitle: { color: c.text, fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center', minHeight: 36 },
  podiumValues: { minHeight: 44, paddingTop: 5, paddingBottom: 10, alignItems: 'center', justifyContent: 'flex-start', gap: 3 },
  podiumPrimary: { color: c.text, fontSize: 12, lineHeight: 17, fontWeight: '500', textAlign: 'center' },
  podiumTime: { color: c.textSecondary, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  podiumStep: { width: '100%', borderTopLeftRadius: 10, borderTopRightRadius: 10, alignItems: 'center', justifyContent: 'center' },
  podiumNumber: { color: c.textSecondary, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 76, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: c.surface },
  rank: { color: c.textSecondary, width: 30, textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] },
  info: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: c.text, fontSize: fontSize.sm, lineHeight: 20, fontWeight: '600' },
  subtitle: { color: c.textSecondary, fontSize: 12, lineHeight: 17 },
  values: { alignItems: 'flex-end', gap: 4, flexShrink: 1, maxWidth: '28%' },
  count: { color: c.text, fontSize: 12, lineHeight: 17, fontWeight: '500', fontVariant: ['tabular-nums'] },
  time: { color: c.textSecondary, fontSize: 11, lineHeight: 16, fontVariant: ['tabular-nums'] },
  track: { height: 3, borderRadius: 2, backgroundColor: c.surfaceHighlight, marginTop: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
}));
