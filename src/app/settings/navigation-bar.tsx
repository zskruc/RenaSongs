/**
 * Settings › Navigation bar: which tabs are at the bottom, and in what order.
 *
 * The same draggable list the Home chips and the Home sections use, with
 * one rule they do not have: **Home has no switch**. Every other list here can
 * be emptied and the thing it feeds simply disappears; empty this one and the
 * app has no way out of wherever you happen to be standing.
 *
 * A tab that is off is still a route — anything already pointing at it still
 * opens it, and the back arrow still knows where it came from. What goes is
 * the way in from the bar.
 */
import { useLiquidDockScrollHandler } from '@/hooks/useLiquidDock';
import { GlassSwitch } from '@/components/glass';
import Icon from '@/components/Icon';
import { Pressable, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { SETTINGS_ROW_LAYOUT, ScreenHeader, SettingsSafeArea } from '@/components/SettingsUI';
import { useAccent } from '@/hooks/useAccent';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { TABS } from '@/lib/tabOrigin';
import { useSettings, type BottomTab } from '@/store/settings';
import {
  colors,
  fontSize,
  radius,
  spacing,
  SCREEN_BOTTOM_PADDING,
  themed,
  useTheme,
} from '@/theme';

function TabRow({ tab }: { tab: BottomTab }) {
  const t = useT();
  const drag = useReorderableDrag();
  const setBottomTab = useSettings((s) => s.setBottomTab);
  const accent = useAccent();
  const label = TABS.find((x) => x.segment === tab.key)?.label ?? tab.key;
  // Home stays. Its row is still draggable, because where it sits is a
  // preference like any other; whether it is there at all is not.
  const fixed = tab.key === 'index';
  return (
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
      <Text style={styles.label}>{t(label)}</Text>
      {fixed ? (
        <Text style={styles.fixed}>{t('Always shown')}</Text>
      ) : (
        <GlassSwitch
          accessibilityLabel={t(label)}
          value={tab.enabled}
          onValueChange={(v) => setBottomTab(tab.key, v)}
          trackColor={{ false: colors.control, true: accent }}
          thumbColor={colors.knob}
        />
      )}
    </View>
  );
}

export default function NavigationBarSettings() {
  const dockScroll = useLiquidDockScrollHandler();
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const t = useT();
  const bottomTabs = useSettings((s) => s.bottomTabs);
  const setBottomTabs = useSettings((s) => s.setBottomTabs);
  return (
    <SettingsSafeArea>
      <ScreenHeader title={t('Navigation bar')} />
      <Text style={[styles.hint, { paddingHorizontal: centredPadding(width, spacing.lg) }]}>{t('Drag to reorder, toggle to show or hide.')}</Text>
      <ReorderableList
        onScroll={dockScroll}
        data={bottomTabs}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <TabRow tab={item} />}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const next = bottomTabs.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          setBottomTabs(next);
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...SETTINGS_ROW_LAYOUT,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  label: { flex: 1, flexShrink: 1, color: colors.text, fontSize: fontSize.md, lineHeight: 22, fontWeight: '500' },
  // Where the switch would be, in the voice of something that is not a
  // control: it is an answer to "why can I not turn this one off".
  fixed: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 20, flexShrink: 1, textAlign: 'right' },
}));
