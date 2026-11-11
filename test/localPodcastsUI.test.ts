import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { create as createState } from 'zustand';
import ts from 'typescript';
import { songAddedAt } from '../src/lib/smartRules';
import { songContentKind, isLocalPodcastSong } from '../src/lib/contentKind';
const require = createRequire(import.meta.url);
function load(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Date, setTimeout, require: (key: string) => { assert.ok(Object.hasOwn(imports, key), key); return imports[key]; } }); return exports;
}
test('actual local podcast page groups files, queues the current sort from a memoized row and seeks to the latest saved position', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let epoch = 0, hold: Promise<void> | undefined; const calls: any[] = [];
  const song = (id: string, track: number) => ({ id, title: id.toUpperCase(), album: 'Program', albumId: 'album', artist: 'Author', track, mediaKind: 'podcast', duration: 100 });
  const songs = [song('a', 2), song('b', 1), song('c', 3)], catalog = { catalog: { songs }, scope: 'A', loading: false, error: false, refresh() {} };
  const metadata = createState<any>(() => ({ ready: true, scope: 'A|server', revision: 1, songs: {}, aliases: [], hydrate: async () => {} }));
  const progress = createState<any>(() => ({ scope: JSON.stringify(['A', 'server']), ready: true, progress: {}, error: false }));
  const owned = () => { const version = epoch; return () => version === epoch; };
  const model = load('lib/localPodcasts.ts', { './contentKind': { songContentKind, isLocalPodcastSong }, './localLibrary': { hashKey: (v: string) => v }, './smartRules': { songAddedAt } });
  const FlatList = (props: any) => React.createElement('List', props, props.ListHeaderComponent, ...props.data.map((item: any, index: number) => React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item, index }))));
  const Row = React.memo((props: any) => React.createElement('Track', props), (a, b) => a.song === b.song);
  const state: any = { queue: [], index: 0, playQueue: async (queue: any[], index: number) => { calls.push({ kind: 'play', ids: queue.map((s) => s.id), index }); state.queue = queue; state.index = index; if (hold) await hold; }, seekTo: (position: number) => calls.push({ kind: 'seek', position }) };
  const page = load('app/local-podcasts.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { ActivityIndicator: 'Spinner', FlatList, Text: 'Text', View: 'View' }, 'react-native-reanimated': { __esModule: true, default: { createAnimatedComponent: (c: any) => c } },
    'expo-router': { router: { push() {} } }, '@/api/data': { COVER: { thumb: 64 }, songCoverUrl: () => undefined }, '@/components/Cover': { Cover: 'Cover' }, '@/components/glass': { GlassPressable: 'Button' },
    '@/components/SettingsUI': { SettingsPage: 'Page', SelectList: 'Select', settingsStyles: {} }, '@/components/TrackRow': { TrackRow: Row },
    '@/hooks/useMusicToolsCatalog': { useMusicToolsCatalog: () => catalog }, '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => () => {} }, '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 10 }, '@/i18n': { useT: () => (s: string) => s },
    '@/lib/currentContentKind': { currentContentClassifier: () => songContentKind }, '@/lib/localMetadata': { applySongDisplay: (song: any) => song },
    '@/lib/localCustomizations': { captureCustomizationOwner: owned, customizationScope: () => ({ profile: 'A', source: 'server' }) }, '@/lib/localPodcasts': model,
    '@/store/localPodcasts': { useLocalPodcasts: progress, loadLocalPodcastProgress: async () => progress.getState().progress, localPodcastProgressScope: () => JSON.stringify(['A', 'server']), markLocalPodcastPlayed: async (id: string, played: boolean) => calls.push({ kind: 'mark', id, played }) },
    '@/store/localMetadata': { useLocalMetadata: metadata }, '@/store/player': { usePlayerStore: { getState: () => state } }, '@/store/toast': { useToast: (select: any) => select({ show() {} }) },
    '@/theme': { useTheme() {}, themed: () => ({}), colors: {}, fontSize: {}, radius: {}, spacing: {} },
  });
  let view!: ReturnType<typeof create>; await act(async () => { view = create(React.createElement(page.default)); await new Promise((yes) => setTimeout(yes, 5)); });
  for (let i = 0; i < 3 && !view.root.findAllByType('Button' as any).some((b) => b.findAllByType('Cover' as any).length); i++) await act(async () => { await new Promise((yes) => setTimeout(yes, 5)); });
  await act(async () => { view.root.findAllByType('Button' as any).find((b) => b.findAllByType('Cover' as any).length)!.props.onPress(); });
  const unchangedRow = view.root.findAllByType('Track' as any).find((row) => row.props.song.id === 'c')!;
  await act(async () => { view.root.findAllByType('Select' as any).find((row) => row.props.label === 'Sort by')!.props.onChange('title'); progress.setState({ progress: { c: { positionSec: 55, durationSec: 100, played: false } } }); });
  await act(async () => { unchangedRow.props.onPress(); });
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { kind: 'play', ids: ['a', 'b', 'c'], index: 2 }); assert.deepEqual(calls[1], { kind: 'seek', position: 45 });
  let release!: () => void; hold = new Promise<void>((yes) => { release = yes; }); await act(async () => { unchangedRow.props.onPress(); }); epoch++; release(); await act(async () => { await Promise.resolve(); });
  assert.equal(calls.filter((call) => call.kind === 'seek').length, 1, 'source handover during native load cannot seek another source');
  await act(async () => { view.unmount(); });
});
