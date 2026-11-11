import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { create as createStore } from 'zustand';
import ts from 'typescript';
import { SETTINGS_CATEGORY_PAGES, SETTINGS_HOME_GROUPS } from '../src/lib/settingsNavigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ui = Object.fromEntries(['SettingRow', 'SettingsGroup', 'SettingsIntro', 'SettingsPage', 'SelectList', 'SwitchList', 'Field', 'SettingsSafeArea', 'ScreenHeader'].map((name) => [name, name]));
const style = { content: {}, pane: {}, row: {}, rowLabelBox: {}, rowDescription: {} };
function load(relative: string, imports: Record<string, unknown>) {
  const source = ts.transpileModule(readFileSync(new URL(`../src/${relative}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(source, { exports, require: (name: string) => { assert.ok(name in imports, name); return imports[name]; } });
  return exports;
}
function harness(route: string) {
  const changes: [string, unknown][] = [], pushes: unknown[] = [], toasts: string[] = [], buzz: string[] = [], accountCalls: unknown[][] = [];
  const initial = { language: 'zh-CN', appFont: 'system', themeMode: 'system',
    uiStyle: 'appleMusic', albumStyle: 'minidisc', playlistStyle: 'artist', coverCorners: 'rounded',
    alwaysShowTabs: true, showTabLabels: false, blurBars: true, defaultTab: 'library', swipeAction: 'next', swipeLeftAction: 'favorite', hapticsEnabled: false,
    showPlayingElsewhere: true, libraryShowsPlaylists: true, showFolderBrowser: false };
  const settings = createStore<Record<string, any>>(() => ({ ...initial }));
  const imports: unknown[] = [], exports: string[] = [];
  let reset = 0;
  settings.setState({ ...Object.fromEntries(Object.keys(initial).map((key) => [`set${key[0].toUpperCase()}${key.slice(1)}`, (value: unknown) => { changes.push([key, value]); settings.setState({ [key]: value }); }])),
    importSettings: (data: unknown) => imports.push(data), resetToDefaults: () => { reset++; },
  });
  const auth = createStore<Record<string, any>>(() => ({ auth: { username: 'Music Lover', serverUrl: 'https://music.invalid', serverType: 'navidrome' }, offline: false,
    logout: () => accountCalls.push(['logout']), goOffline: async (local: boolean) => { accountCalls.push(['offline', local]); },
    goOnline: async () => { accountCalls.push(['online']); },
  }));
  const context = { params: {} as Record<string, string>, picked: null as Record<string, unknown> | null, pickFails: false, exportOk: true };
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSX, 'react-native': { Text: 'Text', View: 'View', Pressable: 'Pressable' },
    'expo-router': { useRouter: () => ({ push: (path: unknown) => pushes.push(path), replace: (path: unknown) => pushes.push(path) }),
      useLocalSearchParams: () => context.params, Redirect: 'Redirect' },
    '@/components/DockScrollView': { DockScrollView: 'DockScrollView' },
    '@/components/Dialog': { Dialog: 'Dialog' },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
    '@/components/BarBlur': { canBlurBars: true },
    '@/components/SettingsUI': { ...ui, settingsStyles: style },
    '@/hooks/useLocalProfile': { useLocalProfile: () => auth.getState().offline && !auth.getState().auth },
    '@/i18n': { useT: () => (key: string) => key },
    '@/lib/haptics': { haptic: (kind: string) => buzz.push(kind) },
    '@/lib/settingsFile': { shareSettingsFile: async () => { exports.push('export'); return context.exportOk; },
      pickSettingsFile: async () => { if (context.pickFails) throw new Error('Unreadable'); return context.picked; } },
    '@/lib/settingsNavigation': { SETTINGS_CATEGORY_PAGES, SETTINGS_HOME_GROUPS },
    '@/store/settings': { useSettings: settings, LANGUAGE_NAMES: { 'zh-CN': '简体中文' }, APP_FONT_LABELS: { system: 'System font' } },
    '@/store/auth': { useAuthStore: auth },
    '@/store/downloads': { useDownloads: (selector: (state: unknown) => unknown) => selector({ hydrated: true }), anyDownloads: () => true },
    '@/store/toast': { useToast: (selector: (state: unknown) => unknown) => selector({ show: (message: string) => toasts.push(message) }) },
    '@/theme': { fontSize: {}, radius: {}, useTheme: () => ({}), themed: (fn: (palette: unknown) => unknown) => fn({}) },
  };
  const category = load('components/SettingsCategoryPage', dependencies);
  dependencies['@/components/SettingsCategoryPage'] = category;
  const component = route === 'category' ? category.SettingsCategoryPage : load(`app/settings/${route}`, dependencies).default;
  let renderer!: ReactTestRenderer;
  const rows = (type: string, label?: string) => renderer.root.findAll((node) => node.type === type as any && (label === undefined || node.props.label === label));
  return { changes, pushes, auth, settings, context, imports, exports, toasts, buzz, accountCalls, rows,
    toggles: () => rows('SwitchList').flatMap((node) => node.props.options), reset: () => reset,
    mount: async (props?: object) => { await act(async () => { renderer = create(React.createElement(component, props)); }); },
    refresh: async (props?: object) => { await act(async () => { renderer.update(React.createElement(component, props)); }); },
    close: async () => { await act(async () => { renderer?.unmount(); }); },
  };
}

test('every new category destination exists and the grouped directory reaches all reorganized detail hubs', () => {
  const all = [...SETTINGS_HOME_GROUPS.flatMap((group) => group.rows),
    ...Object.values(SETTINGS_CATEGORY_PAGES).flatMap((page) => page.groups.flatMap((group) => group.rows))];
  for (const item of all) {
    assert.ok(existsSync(new URL(`../src/app${item.route}.tsx`, import.meta.url)) || existsSync(new URL(`../src/app${item.route}/index.tsx`, import.meta.url)), item.route);
  }
  assert.equal(new Set(SETTINGS_HOME_GROUPS.flatMap((group) => group.rows).map((row) => row.route)).size, 8);
});

test('category navigation keeps server-offline management visible and disabled, and local profiles keep only applicable destinations', async () => {
  const h = harness('category');
  try {
    h.auth.setState({ offline: true });
    await h.mount(SETTINGS_CATEGORY_PAGES.library);
    assert.equal(h.rows('SettingRow', 'Library')[0].props.disabled, true);
    assert.match(h.rows('SettingRow', 'Library')[0].props.description, /Connect to your server/);
    await act(async () => { h.auth.setState({ auth: null }); });
    assert.equal(h.rows('SettingRow', 'Local music')[0].props.disabled, false);
    await act(async () => { h.rows('SettingRow', 'Local music')[0].props.onPress(); });
    assert.deepEqual(h.pushes, ['/settings/library']);
    await h.refresh(SETTINGS_CATEGORY_PAGES.storage);
    assert.equal(h.rows('SettingRow', 'Downloads & offline').length, 0);
    assert.equal(h.rows('SettingRow', 'Download manager').length, 0);
    assert.ok(h.rows('SettingRow', 'Podcast storage').length);
    await act(async () => { h.rows('SettingRow', 'Cached songs')[0].props.onPress(); });
    assert.equal(h.pushes.at(-1), '/settings/cache');
  } finally { await h.close(); }
});

test('moved page-style settings retain exact saved choices and mutate only the selected preference', async () => {
  const h = harness('page-layouts');
  try {
    await h.mount(); assert.deepEqual(h.changes, []);
    for (const [label, value] of [['UI style', 'appleMusic'], ['Album page style', 'minidisc'], ['Playlist page style', 'artist'], ['Cover corners', 'rounded']]) {
      assert.equal(h.rows('SelectList', label)[0].props.value, value);
    }
    await act(async () => { h.rows('SelectList', 'Album page style')[0].props.onChange('primuse'); });
    assert.deepEqual(h.changes, [['albumStyle', 'primuse']]);
    assert.equal(h.settings.getState().uiStyle, 'appleMusic'); assert.equal(h.settings.getState().playlistStyle, 'artist');
    await act(async () => { h.rows('SettingRow', 'Song lists')[0].props.onPress(); });
    assert.deepEqual(h.pushes, ['/settings/song-lists']);
  } finally { await h.close(); }
});

test('navigation and gestures retain stored actions and haptics only occur when explicitly enabled', async () => {
  const h = harness('interface');
  try {
    await h.mount(); assert.deepEqual(h.changes, []); assert.deepEqual(h.buzz, []);
    assert.equal(h.rows('SelectList', 'Open the app on')[0].props.value, 'library');
    assert.equal(h.rows('SelectList', 'Swipe right')[0].props.value, 'next');
    assert.equal(h.rows('SelectList', 'Swipe left')[0].props.value, 'favorite');
    await act(async () => { h.rows('SelectList', 'Swipe left')[0].props.onChange('queue'); h.toggles().find((row) => row.label === 'Haptic feedback').onChange(true); });
    assert.deepEqual(h.changes, [['swipeLeftAction', 'queue'], ['hapticsEnabled', true]]); assert.deepEqual(h.buzz, ['medium']);
    await act(async () => { h.toggles().find((row) => row.label === 'Haptic feedback').onChange(false); });
    assert.deepEqual(h.buzz, ['medium']);
  } finally { await h.close(); }
});

test('moved home settings preserve folder-browser availability for Navidrome, Jellyfin and local profiles', async () => {
  const h = harness('home-layout');
  try {
    await h.mount(); assert.deepEqual(h.changes, []);
    assert.equal(h.toggles().find((row) => row.label === 'Folder browsing').value, false);
    await act(async () => { h.auth.setState({ auth: { serverType: 'jellyfin' } }); });
    assert.ok(!h.toggles().some((row) => row.label === 'Folder browsing'));
    await act(async () => { h.auth.setState({ offline: true }); });
    assert.equal(h.toggles().find((row) => row.label === 'Folder browsing').disabled, true);
    await act(async () => { h.auth.setState({ auth: null }); });
    assert.ok(!h.toggles().some((row) => row.label === 'Folder browsing'));
    await act(async () => { h.rows('SettingRow', 'Search result layout')[0].props.onPress(); });
    assert.deepEqual(h.pushes, ['/settings/discovery-layout']);
  } finally { await h.close(); }
});

test('settings import and reset remain explicit confirmations; opening, choosing or cancelling changes nothing', async () => {
  const h = harness('preferences-file');
  const dialog = (title: string) => h.rows('Dialog').find((node) => node.props.title === title)!;
  try {
    await h.mount(); assert.deepEqual(h.imports, []); assert.equal(h.reset(), 0);
    h.context.picked = { themeMode: 'dark', albumStyle: 'volta' };
    await act(async () => { h.rows('SettingRow', 'Import settings')[0].props.onPress(); });
    assert.equal(dialog('Import settings').props.visible, true); assert.deepEqual(h.imports, []);
    await act(async () => { dialog('Import settings').props.onCancel(); });
    assert.equal(dialog('Import settings').props.visible, false); assert.deepEqual(h.imports, []);
    await act(async () => { h.rows('SettingRow', 'Import settings')[0].props.onPress(); });
    await act(async () => { dialog('Import settings').props.onConfirm(); });
    assert.equal(h.imports.length, 1); assert.equal(h.imports[0], h.context.picked);
    assert.equal(dialog('Import settings').props.visible, false); assert.equal(h.toasts.at(-1), 'Settings imported');
    await act(async () => { h.rows('SettingRow', 'Restore default settings')[0].props.onPress(); });
    assert.equal(dialog('Restore default settings').props.visible, true); assert.equal(h.reset(), 0);
    await act(async () => { dialog('Restore default settings').props.onCancel(); }); assert.equal(h.reset(), 0);
    await act(async () => { h.rows('SettingRow', 'Restore default settings')[0].props.onPress(); });
    await act(async () => { dialog('Restore default settings').props.onConfirm(); }); assert.equal(h.reset(), 1);
    assert.equal(h.toasts.at(-1), 'Settings restored');
    h.context.picked = null;
    await act(async () => { h.rows('SettingRow', 'Import settings')[0].props.onPress(); });
    assert.equal(dialog('Import settings').props.visible, false); assert.equal(h.imports.length, 1);
    h.context.pickFails = true;
    await act(async () => { h.rows('SettingRow', 'Import settings')[0].props.onPress(); });
    assert.equal(h.toasts.at(-1), "Couldn't read this settings file"); assert.equal(h.imports.length, 1);
    h.context.exportOk = false;
    await act(async () => { h.rows('SettingRow', 'Export settings')[0].props.onPress(); });
    assert.equal(h.toasts.at(-1), "Couldn't export the settings"); assert.equal(h.exports.length, 1);
  } finally { await h.close(); }
});

test('the settings home preserves the current account and original offline/profile actions', async () => {
  const h = harness('index');
  try {
    await h.mount(); assert.equal(h.accountCalls.length, 0); assert.equal(h.changes.length, 0);
    await act(async () => { h.toggles().find((row) => row.label === 'Offline mode').onChange(true); });
    assert.deepEqual(h.accountCalls, [['offline', false]]); assert.equal(h.pushes.at(-1), '/(tabs)');
    await act(async () => { h.rows('SettingRow', 'Change profile')[0].props.onPress(); });
    assert.deepEqual(h.accountCalls.at(-1), ['logout']);
    await act(async () => { h.auth.setState({ offline: true, auth: null }); });
    assert.equal(h.rows('SettingRow', 'Network').length, 0); assert.equal(h.toggles().length, 0);
    await act(async () => { h.rows('SettingRow', 'Exit local mode')[0].props.onPress(); });
    assert.deepEqual(h.accountCalls.at(-1), ['logout']);
  } finally { await h.close(); }
});
