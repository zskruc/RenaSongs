import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const screens = {
  'home-buttons': { field: 'homeButtons', set: 'setHomeButtons', toggle: 'setHomeButton', keys: ['settings', 'queue'] },
  'home-chips': { field: 'homeChips', set: 'setHomeChips', toggle: 'setHomeChip', keys: ['genres', 'albums', 'songs'] },
  'home-sections': { field: 'homeSections', set: 'setHomeSections', toggle: 'setHomeSection', keys: ['recentlyAdded', 'randomSongs'] },
  'library-chips': { field: 'libraryChips', set: 'setLibraryChips', toggle: 'setLibraryChip', keys: ['artists', 'albums'] },
  'navigation-bar': { field: 'bottomTabs', set: 'setBottomTabs', toggle: 'setBottomTab', keys: ['index', 'library'] },
  'player-buttons': { field: 'playerButtons', set: 'setPlayerButtons', toggle: 'setPlayerButton', keys: ['lyrics', 'queue'] },
  'explore-sections': { field: 'exploreSections', set: 'setExploreSections', toggle: 'setExploreSection', keys: ['albums', 'artists'] },
} as const;

function harness(name: keyof typeof screens, local = false) {
  const info = screens[name], writes: any[] = [], drags: any[] = [], preferenceWrites: any[] = [];
  const state: Record<string, any> = { [info.field]: info.keys.map((key) => ({ key, enabled: true })), homeChipIcons: true,
    playerButtonsLayout: 'centered', setChipIcons() {}, setHomeChipIcons() {}, setPlayerButtonsLayout() {} };
  state[info.set] = (value: any) => { writes.push(plain(value)); state[info.field] = value; };
  state[info.toggle] = (...values: unknown[]) => writes.push(values);
  let preferences = { shelves: { recentlyAdded: { layout: 'grid', size: 'small', limit: 13, rows: 3 }, randomSongs: { layout: 'default', size: 'default', limit: 9, rows: 2 } } };
  const preferenceListeners = new Set<() => void>();
  const colors = { text: '#fff', textSecondary: '#aaa', surface: '#222', surfaceHighlight: '#333', accent: '#0f0', control: '#555', knob: '#fff' };
  const dockHandler = { workletEventHandler: { eventNames: ['onScroll'] } };
  const dependencies: Record<string, any> = {
    'react/jsx-runtime': JSX,
    'react-native': { View: 'View', Pressable: 'Pressable', Text: 'Text' },
    'react-native-reorderable-list': { __esModule: true, default: (props: any) => React.createElement('ReorderList', props,
      props.data.map((item: any) => React.createElement(React.Fragment, { key: item.key }, props.renderItem({ item }))), props.ListFooterComponent),
      useReorderableDrag: () => () => drags.push('drag') },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
    '@/components/glass': { GlassSwitch: 'GlassSwitch', GlassPressable: 'GlassButton', GlassSurface() { throw new Error('Ordinary reorder panels should not allocate a glass renderer'); } },
    '@/components/SettingsUI': { SETTINGS_ROW_LAYOUT: { minHeight: 60, paddingVertical: 8 }, ScreenHeader: 'Header', SettingsSafeArea: 'Safe',
      SwitchList: 'SwitchList', SettingsGroup: 'Group', SelectList: 'Select', SliderRow: 'Slider' },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => dockHandler },
    '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 180 },
    '@/hooks/useScreenSize': { useScreenSize: () => ({ width: 400 }), centredPadding: () => 16 },
    '@/hooks/useAccent': { useAccent: () => colors.accent }, '@/hooks/useLocalProfile': { useLocalProfile: () => local },
    '@/i18n': { useT: () => (text: string, vars?: any) => text.replace(/\{([^}]+)\}/g, (_, key: string) => String(vars?.[key])) },
    '@/lib/haptics': { haptic: (value: any) => drags.push(value) },
    '@/lib/tabOrigin': { TABS: [{ segment: 'index', label: 'Home' }, { segment: 'library', label: 'Your library' }] },
    '@/lib/discoveryPreferences': { homeShelfPreset: (data: any) => data },
    '@/store/discoveryPreferences': { useDiscoveryPreferences: () => ({ data: React.useSyncExternalStore((listener) => {
      preferenceListeners.add(listener); return () => { preferenceListeners.delete(listener); };
    }, () => preferences), change: async (update: any) => { preferences = update(preferences); preferenceWrites.push(plain(preferences)); preferenceListeners.forEach((listener) => listener()); } }) },
    '@/store/settings': { useSettings: (select: (value: typeof state) => any) => select(state) },
    '@/store/auth': { useAuthStore: (select: (value: any) => any) => select({ offline: false }) }, '@/store/toast': { useToast: (select: (value: any) => any) => select({ show() {} }) },
    '@/theme': { colors, useTheme: () => colors, fontSize: { sm: 14, md: 16 }, radius: { lg: 16 }, spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, SCREEN_BOTTOM_PADDING: 180, themed: (factory: any) => factory(colors) },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/app/settings/${name}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(id: string) { assert.ok(Object.hasOwn(dependencies, id), `${name}: ${id}`); return dependencies[id]; } });
  return { Screen: exports.default, writes, drags, info, preferenceWrites, dockHandler };
}

test('all seven custom arrangement pages keep their actual reorder, toggle and native scroll contracts after visual normalization', async () => {
  for (const name of Object.keys(screens) as (keyof typeof screens)[]) {
    const h = harness(name); let root!: ReactTestRenderer;
    try {
      await act(async () => { root = create(React.createElement(h.Screen)); });
      assert.equal(h.writes.length, 0, `${name} must not change preferences on mount`);
      const list = root.root.findByType('ReorderList' as any);
      assert.equal(list.props.onScroll, h.dockHandler);
      await act(async () => list.props.onReorder({ from: 0, to: 1 }));
      assert.deepEqual(h.writes[0].map((item: any) => item.key), [h.info.keys[1], h.info.keys[0], ...h.info.keys.slice(2)]);
      const handle = root.root.findAllByType('Pressable' as any).find((node) => node.props.accessibilityLabel === 'Reorder')!;
      await act(async () => handle.props.onPressIn());
      assert.deepEqual(h.drags, ['medium', 'drag']);
      const toggle = root.root.findAllByType('GlassSwitch' as any)[0];
      assert.ok(toggle.props.accessibilityLabel, `${name} switch must announce what it changes`);
      await act(async () => toggle.props.onValueChange(false));
      assert.equal(h.writes[1][1], false);
    } finally { await act(async () => root?.unmount()); }
  }
});

test('home section layout selectors retain exact saved values and commit changes only after explicit input', async () => {
  const h = harness('home-sections'); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    const selects = root.root.findAllByType('Select' as any), slider = root.root.findAllByType('Slider' as any)[0];
    assert.deepEqual(selects.slice(0, 3).map((node) => node.props.value), ['grid', 'small', 3]);
    assert.equal(slider.props.value, 13, 'a custom old count must not be rounded to a preset');
    assert.equal(h.preferenceWrites.length, 0);
    await act(async () => slider.props.onChange(17));
    assert.equal(h.preferenceWrites.at(-1).shelves.recentlyAdded.limit, 17);
    assert.equal(h.preferenceWrites.at(-1).shelves.recentlyAdded.layout, 'grid');
    await act(async () => selects[0].props.onChange('rows'));
    assert.equal(h.preferenceWrites.at(-1).shelves.recentlyAdded.layout, 'rows');
    assert.equal(h.preferenceWrites.at(-1).shelves.recentlyAdded.size, 'small');
    assert.equal(h.preferenceWrites.at(-1).shelves.recentlyAdded.limit, 17);
  } finally { await act(async () => root?.unmount()); }
});

test('reordering locally visible home chips preserves the hidden server chip at its original position', async () => {
  const h = harness('home-chips', true); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    await act(async () => root.root.findByType('ReorderList' as any).props.onReorder({ from: 0, to: 1 }));
    assert.deepEqual(h.writes[0].map((item: any) => item.key), ['genres', 'songs', 'albums']);
  } finally { await act(async () => root?.unmount()); }
});
