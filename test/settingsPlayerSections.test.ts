import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { create as createStore } from 'zustand';
import ts from 'typescript';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function screenHarness(route: 'player' | 'lyrics' | 'playback') {
  const updates: [string, unknown][] = [], pushes: unknown[] = [];
  const initial = {
    playerPresentation: 'amll', showSystemVolume: true, showOutputDevice: false, playerArtworkPalette: true,
    showAudioQuality: true, showRating: true, showAlbumInfo: false, swapPlayerButtons: false, showPlayedInQueue: true,
    playerBackground: 'cover', fitCoverArt: false, animatedCoverBackground: true, blurMiniPlayer: true,
    miniPlayerButtons: 'favorite', showArtistCard: true, coverTapAction: 'none', coverDoubleTapAction: 'screen',
    marqueeTitles: true, seekButtonsSec: 10, previousButtonMode: 'restart', keepPausedOnSkip: true,
    lyricsSize: 24, lyricsWeight: '500', lyricsAlign: 'center', blurInactiveLyrics: true,
    lyricsBackground: 'cover', lyricsCardBackground: 'color', showLyricsCard: true, lyricsSource: 'local',
    maxBitRate: 0, maxBitRateCellular: 128, streamFormat: '', streamFormatCellular: 'opus', streamLosslessOnly: true,
    autoplaySimilar: false, syncQueueFromServer: true, crossfadeSec: 3, preloadUpcoming: true, preferDownloads: 'always',
    replayGain: 'off', replayGainPreampDb: 0, keepScreenAwake: false, batteryWarning: true,
  };
  const settings = createStore<Record<string, any>>(() => ({ ...initial }));
  settings.setState(Object.fromEntries(Object.keys(initial).map((key) => [
    `set${key[0].toUpperCase()}${key.slice(1)}`,
    (value: unknown) => { updates.push([key, value]); settings.setState({ [key]: value }); },
  ])));
  const auth = createStore<Record<string, any>>(() => ({ auth: { serverType: 'navidrome' }, offline: false }));
  const glass = createStore(() => ({ recipe: 'dock', setRecipe: async () => {}, hydrate: async () => {} }));
  const context = { local: false, params: {} as { setting?: string; settingVisit?: string } };
  const ui = Object.fromEntries(['SelectList', 'SettingRow', 'SettingsGroup', 'SettingsPage', 'SliderRow', 'SwitchList']
    .map((name) => [name, name]));
  const imports: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSX, 'react-native': { Platform: { OS: 'android' } },
    'expo-router': { useRouter: () => ({ push: (path: unknown) => pushes.push(path) }),
      useLocalSearchParams: () => context.params, Redirect: 'Redirect' },
    '@/components/DockScrollView': { DockScrollView: 'DockScrollView' },
    '@/components/BarBlur': { canBlurBars: true },
    '@/components/SettingsUI': { ...ui, settingsStyles: { content: {} } },
    '@/hooks/useLocalProfile': { useLocalProfile: () => context.local },
    '@/i18n': { useT: () => (key: string) => key },
    '@/store/settings': { useSettings: settings,
      BITRATE_OPTIONS: [{ value: 0, label: 'Original' }, { value: 128, label: '128 kbps' }],
      TRANSCODE_FORMATS: ['', 'opus'], LYRICS_SIZE_MIN: 14, LYRICS_SIZE_MAX: 48,
      REPLAY_GAIN_PREAMP_LIMIT: 12, clampReplayGainPreamp: (value: number) => value,
    },
    '@/store/auth': { useAuthStore: auth }, '@/store/playerGlass': { usePlayerGlass: glass },
    '@/store/toast': { useToast: (select: (state: unknown) => unknown) => select({ show: () => {} }) },
    '@/theme': { useTheme: () => ({}) },
  };
  const source = ts.transpileModule(readFileSync(new URL(`../src/app/settings/${route}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(source, { exports, require: (name: string) => { assert.ok(name in imports, name); return imports[name]; } });
  let renderer!: ReactTestRenderer;
  const rows = (type: string, label?: string) => renderer.root.findAll((node) => node.type === type as any
    && (label === undefined || node.props.label === label));
  const toggles = () => rows('SwitchList').flatMap((node) => node.props.options);
  return { updates, pushes, settings, auth, context, rows, toggles,
    mount: async () => { await act(async () => { renderer = create(React.createElement(exports.default)); }); },
    refresh: async () => { await act(async () => { renderer.update(React.createElement(exports.default)); }); },
    close: async () => { await act(async () => { renderer?.unmount(); }); },
  };
}

test('moved lyric controls preserve saved values and update the same settings without resetting player preferences', async () => {
  const h = screenHarness('lyrics');
  try {
    await h.mount();
    assert.deepEqual(h.updates, [], 'opening the reorganized page must never apply defaults');
    assert.equal(h.rows('SelectList', 'Lyrics source')[0].props.value, 'local');
    assert.equal(h.rows('SliderRow', 'Lyrics size')[0].props.value, 24);
    assert.equal(h.rows('SelectList', 'Lyrics weight')[0].props.value, '500');
    assert.equal(h.rows('SelectList', 'Lyrics alignment')[0].props.value, 'center');
    assert.equal(h.toggles().find((row) => row.label === 'Blur inactive lyrics').value, true);
    await act(async () => {
      h.rows('SliderRow', 'Lyrics size')[0].props.onChange(30);
      h.rows('SelectList', 'Lyrics source')[0].props.onChange('online');
      h.toggles().find((row) => row.label === 'Blur inactive lyrics').onChange(false);
    });
    assert.deepEqual(h.updates, [['lyricsSize', 30], ['lyricsSource', 'online'], ['blurInactiveLyrics', false]]);
    assert.equal(h.settings.getState().playerPresentation, 'amll');
    await act(async () => { h.rows('SettingRow', 'Lyric fonts')[0].props.onPress(); h.rows('SettingRow', 'Lyrics tools')[0].props.onPress(); });
    assert.deepEqual(h.pushes, ['/settings/lyric-fonts', '/settings/lyrics-tools']);
  } finally { await h.close(); }
});

test('player groups keep appearance and gesture controls, navigate to lyrics, and preserve account-specific controls', async () => {
  const h = screenHarness('player');
  try {
    await h.mount();
    assert.deepEqual(h.updates, []);
    assert.equal(h.rows('SelectList', 'On cover tap')[0].props.value, 'none');
    assert.equal(h.rows('SelectList', 'On cover double tap')[0].props.value, 'screen');
    assert.equal(h.rows('SelectList', 'Lyrics source').length, 0, 'lyrics editing has one dedicated destination');
    assert.ok(h.toggles().some((row) => row.label === 'Show rating'));
    await act(async () => { h.rows('SettingRow', 'Lyrics')[0].props.onPress(); h.rows('SelectList', 'Player background')[0].props.onChange('color'); });
    assert.deepEqual(h.pushes, ['/settings/lyrics']); assert.deepEqual(h.updates, [['playerBackground', 'color']]);
    h.context.local = true;
    await act(async () => { h.auth.setState({ auth: null }); });
    assert.ok(!h.toggles().some((row) => row.label === 'Show artist card' || row.label === 'Show rating'));
    assert.ok(h.toggles().some((row) => row.label === 'Show system volume'));
  } finally { await h.close(); }
});

test('existing search and external deep links to old player lyric anchors redirect to the exact moved control', async () => {
  const h = screenHarness('player');
  h.context.params = { setting: 'Blur inactive lyrics', settingVisit: 'saved-visit' };
  try {
    await h.mount();
    const href = h.rows('Redirect')[0].props.href;
    assert.equal(href.pathname, '/settings/lyrics');
    assert.equal(href.params.setting, 'Blur inactive lyrics');
    assert.equal(href.params.settingVisit, 'saved-visit');
    assert.deepEqual(h.updates, []);
  } finally { await h.close(); }
});

test('regrouped playback keeps sound available offline and retains disabled streaming policies without exposing them to local profiles', async () => {
  const h = screenHarness('playback');
  try {
    h.auth.setState({ offline: true });
    await h.mount();
    assert.equal(h.rows('SelectList', 'Streaming quality (Wi-Fi)')[0].props.disabled, true);
    assert.equal(h.rows('SelectList', 'Streaming quality (mobile data)')[0].props.disabled, true);
    await act(async () => { h.rows('SliderRow', 'Crossfade')[0].props.onChange(5); });
    assert.deepEqual(h.updates, [['crossfadeSec', 5]]);
    h.context.local = true; await h.refresh();
    assert.equal(h.rows('SelectList', 'Streaming quality (Wi-Fi)').length, 0);
    assert.ok(h.rows('SelectList', 'Normalize volume').length);
    assert.ok(!h.toggles().some((row) => row.label === 'Autoplay'));
    await act(async () => { h.rows('SettingRow', 'Linked songs in shuffle')[0].props.onPress(); });
    assert.deepEqual(h.pushes, ['/settings/shuffle-links']);
  } finally { await h.close(); }
});
