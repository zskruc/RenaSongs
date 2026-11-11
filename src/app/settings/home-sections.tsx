/**
 * Settings › Home sections: draggable list (same engine as the queue and
 * playlists) to show/hide and reorder the album rows on Home. Changes are
 * applied and saved immediately.
 */
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { GlassSwitch, GlassPressable } from '@/components/glass';
import { useDiscoveryPreferences } from '@/store/discoveryPreferences';
import { homeShelfPreset, type ShelfLayout, type ShelfPreference } from '@/lib/discoveryPreferences';
import Icon from '@/components/Icon';
import { Pressable, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';

import { SETTINGS_ROW_LAYOUT, ScreenHeader, SelectList, SettingsGroup, SettingsSafeArea, SliderRow } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { useSettings, type HomeSection, type HomeSectionKey } from '@/store/settings';
import {
  colors,
  fontSize,
  spacing,
  SCREEN_BOTTOM_PADDING,
  themed,
  useTheme,
} from '@/theme';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';

/** Label (i18n key) of each section. */
const LABEL: Record<HomeSectionKey, string> = {
  dailyRecommendations: 'Made for you',
  recentlyAdded: 'Recently added',
  newReleases: 'New releases',
  recentlyPlayed: 'Recently played',
  mostPlayed: 'Most played albums',
  mostPlayedSongs: 'Most played songs',
  randomSongs: 'Random songs',
  discover: 'Discover',
  playlists: 'Playlists',
  podcasts: 'Recent episodes',
  randomAlbums: 'Random albums',
  randomArtists: 'Random artists',
};

function SectionRow({ section }: { section: HomeSection }) {
  const t = useT();
  const drag = useReorderableDrag();
  const prefs = useDiscoveryPreferences();
  const preference: ShelfPreference = prefs.data.shelves[section.key] ?? { layout: 'default' as ShelfLayout, size: 'default' as const, limit: 20 };
  const change = (patch: Partial<typeof preference>) => void prefs.change((data) => ({ ...data, shelves: { ...data.shelves, [section.key]: { ...preference, ...patch } } }));
  const setHomeSection = useSettings((s) => s.setHomeSection);
  // From the store, not `colors.accent`: without subscription the switch would
  // keep the previous accent while the screen stays mounted.
  const { accent } = useTheme();
  return (
    <View style={styles.section}>
    <SettingsGroup>
    <View style={styles.row}>
      <Pressable
        hitSlop={10}
        onPressIn={() => {
          haptic('medium');
          drag();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('Reorder')}
      >
        <Icon name="reorder-two" size={24} color={colors.textSecondary} />
      </Pressable>
      <Text style={styles.label}>{t(LABEL[section.key])}</Text>
      <GlassSwitch
        accessibilityLabel={t(LABEL[section.key])}
        value={section.enabled}
        onValueChange={(v) => setHomeSection(section.key, v)}
        trackColor={{ false: colors.control, true: accent }}
        thumbColor={colors.knob}
      />
    </View>
    {section.key !== 'dailyRecommendations' ? <>
      {!['mostPlayedSongs', 'randomSongs'].includes(section.key) ? <SelectList
        label={t('Layout')}
        value={preference.layout}
        options={(['default', 'cards', 'rows', 'grid'] as const).map((layout) => ({ value: layout, label: t(layout === 'default' ? 'Default layout' : layout === 'cards' ? 'Cards' : layout === 'grid' ? 'Grid' : 'Rows') }))}
        onChange={(layout) => change({ layout })}
      /> : null}
      {!['mostPlayedSongs', 'randomSongs'].includes(section.key) && !['rows', 'compact'].includes(preference.layout) ? <SelectList
        label={t('Cover size')}
        value={preference.size}
        options={(['small', 'default', 'large'] as const).map((size) => ({ value: size, label: t(size === 'small' ? 'Small covers' : size === 'large' ? 'Large covers' : 'Default size') }))}
        onChange={(size) => change({ size })}
      /> : null}
      {preference.layout === 'grid' || ['mostPlayedSongs', 'randomSongs'].includes(section.key) ? <SelectList
        label={t('Rows per column')}
        value={preference.rows ?? (['mostPlayedSongs', 'randomSongs'].includes(section.key) ? 3 : 2)}
        options={([1, 2, 3] as const).map((rows) => ({ value: rows, label: t('{n} rows', { n: rows }) }))}
        onChange={(rows) => change({ rows })}
      /> : null}
      <SliderRow label={t('Items per section')} value={preference.limit} min={3} max={50}
        formatValue={String} onChange={(limit) => change({ limit })} />
    </> : null}
    </SettingsGroup>
    </View>
  );
}

/** Sections that don't exist locally: their row here would promise something
 *  Home never renders (same criteria as folder browsing in Appearance). */
const SERVER_ONLY: HomeSectionKey[] = ['discover'];

export default function HomeSectionsSettings() {
  const dockScroll = useLiquidDockScrollHandler();
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const t = useT();
  const offline = useAuthStore((s) => s.offline);
  const homeSections = useSettings((s) => s.homeSections);
  const setHomeSections = useSettings((s) => s.setHomeSections);
  const prefs = useDiscoveryPreferences();
  const visible = offline
    ? homeSections.filter((s) => !SERVER_ONLY.includes(s.key))
    : homeSections;

  return (
    <SettingsSafeArea>
      <ScreenHeader title={t('Home sections')} />
      <Text style={[styles.hint, { paddingHorizontal: centredPadding(width, spacing.lg) }]}>{t('Drag to reorder, toggle to show or hide.')}</Text>
      <View style={[styles.presets, { paddingHorizontal: centredPadding(width, spacing.lg) }]}>{(['default', 'compact', 'covers'] as const).map((preset) => <GlassPressable key={preset} onPress={() => void prefs.change((data) => homeShelfPreset(data, homeSections.map((row) => row.key), preset))} style={styles.presetButton}><Text style={styles.presetLabel}>{t(preset === 'default' ? 'Default layout' : preset === 'compact' ? 'Compact shelves' : 'Cover focus')}</Text></GlassPressable>)}</View>
      <ReorderableList
        onScroll={dockScroll}
        data={visible}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <SectionRow section={item} />}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const nextVisible = visible.slice();
          const [moved] = nextVisible.splice(from, 1);
          nextVisible.splice(to, 0, moved);
          // Hidden ones go back to their absolute position: reordering locally
          // must not lose or reposition the config of server-only rows.
          let vi = 0;
          const next = homeSections.map((s) =>
            offline && SERVER_ONLY.includes(s.key) ? s : nextVisible[vi++],
          );
          setHomeSections(next);
        }}
        contentContainerStyle={[
          styles.list,
          // Centred once the screen is wider than a list wants to be, like
          // every other settings screen (#131).
          { paddingBottom: bottomPad, paddingHorizontal: centredPadding(width, spacing.lg) },
        ]}
      />
    </SettingsSafeArea>
  );
}

const styles = themed((colors) => ({
  hint: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
  section: { marginBottom: spacing.sm },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  presetButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44, justifyContent: 'center', borderRadius: 14, backgroundColor: colors.surfaceHighlight },
  presetLabel: { color: colors.text, fontSize: fontSize.sm, lineHeight: 20, fontWeight: '500' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...SETTINGS_ROW_LAYOUT,
    paddingHorizontal: spacing.lg,
  },
  label: { flex: 1, color: colors.text, fontSize: fontSize.md, lineHeight: 22, fontWeight: '500' },
}));
