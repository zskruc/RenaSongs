import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { create as createStore } from 'zustand';
import ts from 'typescript';
import * as customizationModels from '../src/lib/localCustomizationModels';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function load(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name: string) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return exports;
}

test('the actual publisher transcript route retires old text and seek callbacks across account ABA, and accepts a fresh handoff', async () => {
  const first = { username: 'A' }, auth = createStore(() => ({ auth: first, offline: false, offlineSource: null }));
  const authModule = { useAuthStore: auth, profileScopeId: () => auth.getState().auth.username };
  const lyricOwner = load('../src/lib/lyricOwner.ts', { '@/store/auth': authModule });
  const customizations = load('../src/lib/localCustomizations.ts', {
    '@/store/auth': authModule, './lyricOwner': lyricOwner, './localCustomizationModels': customizationModels,
    './mediaCacheDb': {}, './localLibrary': { hashKey: (value: string) => value, folderSetKey: (values: string[]) => values.join('|') },
  });
  const target = load('../src/store/lyricToolTarget.ts', { zustand: { create: createStore }, './auth': authModule }).useLyricToolTarget;
  const song = { id: 'episode', title: 'Episode', podcastChannelId: 'show' }, seeks: number[] = [];
  const player = createStore(() => ({ queue: [song], index: 0, seekTo: (seconds: number) => seeks.push(seconds) }));
  let requests = 0;
  const FlatList = ({ data, renderItem, ListHeaderComponent, ListEmptyComponent }: any) => React.createElement('List', {},
    ListHeaderComponent, ...(data.length ? data.map((item: unknown, index: number) => React.createElement(React.Fragment, { key: index }, renderItem({ item, index }))) : [ListEmptyComponent]));
  const Screen = load('../src/app/publisher-transcript.tsx', {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'react-native': { FlatList, Text: 'Text', ActivityIndicator: 'Spinner', Pressable: 'RowPress' },
    '@/components/SettingsUI': { SettingsPage: 'Page', settingsStyles: { content: {}, sectionDescription: {} } },
    '@/store/lyricToolTarget': { useLyricToolTarget: target }, '@/store/auth': authModule,
    '@/store/player': { usePlayerStore: player, currentSong: (state: any) => state.queue[state.index] },
    '@/lib/localCustomizations': customizations,
    '@/lib/publisherTranscript': { publisherTranscript: async (_song: unknown, current: () => boolean) => {
      assert.equal(current(), true); requests++;
      return { synced: true, lines: [{ start: requests === 1 ? 1000 : 2000, value: requests === 1 ? 'Old A transcript' : 'Fresh A transcript' }] };
    } },
    '@/i18n': { useT: () => (key: string) => key }, '@/theme': { useTheme() {}, colors: { text: '#fff', textSecondary: '#aaa' } },
  }).default;
  let root!: ReactTestRenderer;
  try {
    target.getState().open(song);
    await act(async () => { root = create(React.createElement(Screen)); });
    assert.match(JSON.stringify(root.toJSON()), /Old A transcript/);
    const oldPress = root.root.findByType('RowPress' as any).props.onPress;
    await act(async () => { auth.setState({ auth: { username: 'B' } }); });
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Old A transcript/);
    await act(async () => { auth.setState({ auth: first }); oldPress(); });
    assert.doesNotMatch(JSON.stringify(root.toJSON()), /Old A transcript/);
    assert.match(JSON.stringify(root.toJSON()), /Library changed/); assert.deepEqual(seeks, []);
    await act(async () => { target.getState().open(song); });
    assert.match(JSON.stringify(root.toJSON()), /Fresh A transcript/); assert.equal(requests, 2);
    await act(async () => { oldPress(); root.root.findByType('RowPress' as any).props.onPress(); });
    assert.deepEqual(seeks, [2]);
  } finally { await act(async () => root?.unmount()); }
});
