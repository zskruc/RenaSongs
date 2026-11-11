import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import type { Song } from '@/api/subsonic';
import Icon from '@/components/Icon';
import { SettingsGroup, SettingsPage, SelectList, SettingRow, SwitchList } from '@/components/SettingsUI';
import { FIELD_LABELS, MetadataButton, MetadataFields, MetadataInput, metadataStyles } from '@/components/metadata/MetadataUI';
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useT } from '@/i18n';
import { listMetadataContainers, readMetadataCatalogPage, type BulkMetadataScope } from '@/lib/metadata/catalog';
import { metadataOperation } from '@/lib/metadata/repository';
import { isMetadataCancelled, type ScrapeField } from '@/lib/metadata/models';
import { useAuthStore } from '@/store/auth';
import { useMetadataBulk } from '@/store/metadataBulk';
import { clearSelectedMetadataSongs, readSelectedMetadataSongs } from '@/store/metadataBulkSelection';
import { fontSize, spacing, themed, useTheme } from '@/theme';

type Mode = 'all' | 'missing' | 'manual' | 'album' | 'artist' | 'playlist';
type Container = { id: string; name: string; subtitle?: string; coverArt?: string };
type Row = { kind: 'song'; song: Song } | { kind: 'container'; item: Container };
// The dock returns a Reanimated event handler, which a plain FlatList cannot dispatch.
const AnimatedList = Animated.createAnimatedComponent(FlatList<Row>);
const DEFAULT_FIELDS: ScrapeField[] = ['title', 'artist', 'albumArtist', 'album', 'year', 'genres', 'track', 'discNumber'];
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default function BulkMetadataScreen() {
  const params = useLocalSearchParams<{ kind?: string; id?: string; title?: string; selection?: string }>();
  const kind = first(params.kind), id = first(params.id), title = first(params.title), selection = first(params.selection);
  return <BulkMetadataSetup key={JSON.stringify([kind, id, selection])} initialKind={kind} initialId={id} initialTitle={title} selectionKey={selection} />;
}

function BulkMetadataSetup({ initialKind, initialId, initialTitle, selectionKey }: { initialKind?: string; initialId?: string; initialTitle?: string; selectionKey?: string }) {
  const palette = useTheme(), t = useT(), bottom = useScreenBottomPadding(), onScroll = useLiquidDockScrollHandler();
  useAuthStore((s) => s.auth); useAuthStore((s) => s.offline); useAuthStore((s) => s.offlineSource); useAuthStore((s) => s.autoOffline);
  const [owner] = useState(() => metadataOperation()), active = owner.current();
  const incoming = useMemo(() => selectionKey ? readSelectedMetadataSongs(selectionKey) : null, [selectionKey]);
  const [mode, setMode] = useState<Mode>(() => initialKind === 'selected' ? 'manual' : ['album', 'artist', 'playlist', 'missing'].includes(initialKind ?? '') ? initialKind as Mode : 'all');
  const [container, setContainer] = useState<Container | undefined>(() => initialId ? { id: initialId, name: initialTitle ?? initialId } : undefined);
  const [fields, setFields] = useState<ScrapeField[]>(DEFAULT_FIELDS), [showFields, setShowFields] = useState(false), [overwrite, setOverwrite] = useState(false);
  const [selected, setSelected] = useState(() => new Set(incoming ?? []));
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false), [done, setDone] = useState(false), [error, setError] = useState(''), [starting, setStarting] = useState(false);
  const cursor = useRef<string | undefined>(undefined), offset = useRef(0), generation = useRef(0), request = useRef<AbortController | undefined>(undefined), loadingRef = useRef(false), startingRef = useRef(false);
  const selectContainer = (mode === 'album' || mode === 'artist' || mode === 'playlist') && !container;
  const scope: BulkMetadataScope = container && (mode === 'album' || mode === 'artist' || mode === 'playlist') ? { kind: mode, id: container.id, title: container.name }
    : mode === 'missing' ? { kind: 'missing' } : { kind: 'all' };
  const browseKey = JSON.stringify([mode, container?.id, query, mode === 'missing' ? fields : []]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { void useMetadataBulk.getState().hydrate(); }, []);

  async function loadPage(reset: boolean) {
    if (!active || starting || !reset && (loadingRef.current || done)) return;
    if (reset) { request.current?.abort(); generation.current++; cursor.current = undefined; offset.current = 0; setRows([]); setDone(false); }
    const token = generation.current, controller = new AbortController(); request.current = controller; loadingRef.current = true; setLoading(true); setError('');
    const operation = metadataOperation(owner.scope, controller.signal, () => alive.current && owner.current() && generation.current === token);
    try {
      let found: Row[], complete: boolean, nextCursor: string | undefined, nextOffset: number | undefined;
      if (selectContainer) {
        const page = await listMetadataContainers(mode as 'album' | 'artist' | 'playlist', query, offset.current, operation);
        found = page.items.map((item) => ({ kind: 'container', item })); complete = page.nextOffset === undefined;
        nextOffset = page.nextOffset;
      } else {
        const page = await readMetadataCatalogPage(scope, cursor.current, operation, { search: mode === 'manual' ? query : undefined, fields });
        found = page.songs.map((song) => ({ kind: 'song', song })); complete = page.done; nextCursor = page.nextCursor;
      }
      if (!operation.current() || controller.signal.aborted) return;
      cursor.current = nextCursor;
      if (nextOffset !== undefined) offset.current = nextOffset;
      setRows((previous) => {
        const combined = reset ? found : [...previous, ...found], seen = new Set<string>();
        return combined.filter((row) => { const id = row.kind === 'song' ? row.song.id : row.item.id; if (seen.has(id)) return false; seen.add(id); return true; });
      });
      setDone(complete);
    } catch (reason) { if (operation.current() && !controller.signal.aborted && !isMetadataCancelled(reason)) setError('Could not read this music range. Retry without changing your selection.'); }
    finally { if (generation.current === token && alive.current) { loadingRef.current = false; setLoading(false); } }
  }
  // A range/query change retires in-flight pages; selection changes do not refetch the catalogue.
  useEffect(() => { void loadPage(true); return () => { request.current?.abort(); generation.current++; loadingRef.current = false; }; }, [browseKey, active]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeMode(next: Mode) { setMode(next); setContainer(undefined); setSearch(''); setError(''); }
  const toggle = (id: string) => setSelected((before) => { const next = new Set(before); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const canStart = active && !starting && fields.length > 0 && !selectContainer && (mode !== 'manual' || selected.size > 0);
  async function start() {
    if (!canStart || !owner.current() || !alive.current || startingRef.current) return;
    startingRef.current = true; setStarting(true); setError(''); request.current?.abort();
    try {
      const chosen: BulkMetadataScope = mode === 'manual' ? { kind: 'selected', songIds: [...selected] } : scope;
      const title = container?.name ?? t(mode === 'manual' ? 'Selected songs' : mode === 'missing' ? 'Songs with missing metadata' : 'All music');
      const id = await useMetadataBulk.getState().start(chosen, title, fields, mode === 'missing' ? false : overwrite);
      if (!owner.current() || !alive.current) return;
      if (selectionKey) clearSelectedMetadataSongs(selectionKey);
      router.push({ pathname: '/metadata/bulk-task', params: { id } });
    } catch { if (owner.current() && alive.current) setError('Could not start this metadata task. Your selection has been kept.'); }
    finally { startingRef.current = false; if (alive.current) setStarting(false); }
  }
  const visible = mode === 'manual' || selectContainer ? rows : rows.slice(0, 7);
  const startButton = <MetadataButton title={starting ? t('Preparing metadata task…') : mode === 'manual' ? t('Scrape {n} selected songs', { n: selected.size }) : t('Start scraping')} disabled={!canStart} onPress={() => { void start(); }} />;
  return <SettingsPage title={t('Batch scrape metadata')}>
    <AnimatedList data={active ? visible : []} keyExtractor={(row) => row.kind === 'song' ? row.song.id : row.item.id}
      onScroll={onScroll} scrollEventThrottle={16} initialNumToRender={10} maxToRenderPerBatch={8} windowSize={5} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottom + spacing.lg }}
      onEndReached={() => { if (mode === 'manual' || selectContainer) void loadPage(false); }} onEndReachedThreshold={0.4}
      ListHeaderComponent={<View style={styles.header}>
        {!active ? <Text style={metadataStyles.note}>{t('The music source changed. Reopen this page to choose songs again.')}</Text> : <>
          <Text style={metadataStyles.note}>{t('Choose a range once. The task reads and processes music in pages, including libraries larger than 1,000 songs.')}</Text>
          <SelectList label={t('Music range')} value={mode} onChange={changeMode} disabled={starting} options={[
            { value: 'all', label: t('All music') }, { value: 'missing', label: t('Songs with missing metadata') }, { value: 'manual', label: t('Select songs manually') },
            { value: 'album', label: t('Choose an album') }, { value: 'artist', label: t('Choose an artist') }, { value: 'playlist', label: t('Choose a playlist') },
          ]} />
          {container ? <SettingRow label={container.name} description={t('Change selection')} chevron onPress={starting ? undefined : () => setContainer(undefined)} /> : null}
          <MetadataButton title={t(showFields ? 'Hide metadata fields' : 'Choose metadata fields')} onPress={() => setShowFields(!showFields)} />
          <Text style={metadataStyles.small}>{fields.map((field) => t(FIELD_LABELS[field])).join(' · ') || t('Choose at least one metadata field')}</Text>
          {showFields ? <SettingsGroup><MetadataFields fields={fields} onChange={setFields} /></SettingsGroup> : null}
          {mode !== 'missing' ? <SettingsGroup><SwitchList options={[{ label: t('Replace selected existing fields'), description: t('Off: only fill missing fields and keep existing artwork and lyrics.'), value: overwrite, onChange: setOverwrite }]} /></SettingsGroup>
            : <Text style={metadataStyles.note}>{t('Only songs missing the selected fields enter the queue. Existing fields, artwork and lyrics are kept.')}</Text>}
          <Text style={metadataStyles.note}>{t('Confident matches are saved inside this app. Ambiguous recordings wait for review. NAS metadata and audio files are unchanged.')}</Text>
          {startButton}
          {mode === 'manual' || selectContainer ? <MetadataInput label={t(selectContainer ? 'Find an album, artist or playlist' : 'Find songs to select')} value={search} onChangeText={setSearch} editable={!starting} /> : null}
          {mode === 'manual' ? <>
            <Text style={metadataStyles.label}>{t('{n} songs selected', { n: selected.size })}</Text>
            {initialKind === 'selected' && !incoming ? <Text style={metadataStyles.warning}>{t('The previous selection expired. Select songs again.')}</Text> : null}
            <View style={metadataStyles.row}>
              <View style={styles.grow}><MetadataButton title={t('Select loaded songs')} onPress={() => setSelected((previous) => new Set([...previous, ...rows.flatMap((row) => row.kind === 'song' ? [row.song.id] : [])]))} /></View>
              <View style={styles.grow}><MetadataButton title={t('Clear selection')} disabled={!selected.size} onPress={() => setSelected(new Set())} /></View>
            </View>
          </> : !selectContainer ? <><Text style={metadataStyles.label}>{t('Range preview')}</Text><Text style={metadataStyles.small}>{t('Showing up to seven songs. Starting processes the full chosen range; scrolling is not required.')}</Text></> : null}
        </>}
      </View>}
      renderItem={({ item }) => item.kind === 'container' ? <Pressable accessibilityRole="button" accessibilityLabel={item.item.name} onPress={() => { setContainer(item.item); setSearch(''); }} style={styles.row}>
        <View style={styles.grow}><Text style={metadataStyles.label}>{item.item.name}</Text>{item.item.subtitle ? <Text style={metadataStyles.note}>{item.item.subtitle}</Text> : null}</View>
        <Icon name="chevron-forward" size={20} color={palette.textSecondary} />
      </Pressable> : <Pressable accessibilityRole={mode === 'manual' ? 'checkbox' : 'text'} accessibilityState={mode === 'manual' ? { checked: selected.has(item.song.id) } : undefined}
        accessibilityLabel={[item.song.title, item.song.artist].filter(Boolean).join(' · ')} disabled={mode !== 'manual' || starting} onPress={() => toggle(item.song.id)} style={styles.row}>
        {mode === 'manual' ? <Icon name={selected.has(item.song.id) ? 'checkbox' : 'square-outline'} size={24} color={selected.has(item.song.id) ? palette.accent : palette.textSecondary} /> : null}
        <View style={styles.grow}><Text style={metadataStyles.label} numberOfLines={1}>{item.song.title}</Text><Text style={metadataStyles.note} numberOfLines={1}>{[item.song.artist, item.song.album].filter(Boolean).join(' · ')}</Text></View>
      </Pressable>}
      ListFooterComponent={<View style={styles.footer}>
        {loading ? <ActivityIndicator color={palette.accent} /> : null}
        {error ? <><Text style={metadataStyles.warning}>{t(error)}</Text><MetadataButton title={t('Retry')} onPress={() => { void loadPage(false); }} /></> : null}
        {!loading && !done && active ? <MetadataButton title={t('Load more')} onPress={() => { void loadPage(false); }} /> : null}
        {!loading && !rows.length && !error && active ? <Text style={metadataStyles.note}>{t(done ? 'No matching music in this range' : 'No matches on this page. Continue loading or start the full task.')}</Text> : null}
        {mode === 'manual' && rows.length ? startButton : null}
      </View>} />
  </SettingsPage>;
}
const styles = themed((palette) => ({ header: { gap: spacing.sm, paddingTop: spacing.md }, footer: { gap: spacing.sm, paddingVertical: spacing.md },
  grow: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 0.5, borderBottomColor: palette.border, minHeight: 64 },
  count: { color: palette.textSecondary, fontSize: fontSize.sm },
}));
