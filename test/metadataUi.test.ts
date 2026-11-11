import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import * as models from '../src/lib/metadata/models';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Date, Math, AbortController, require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } }); return exports;
}
const palette = { text: '#fff', textSecondary: '#ccc', textMuted: '#aaa', surface: '#222', surfaceHighlight: '#333', accent: '#f05', border: '#555' };
const shared = { react: React, 'react/jsx-runtime': JSXRuntime, 'react-native': { Text: 'Text', TextInput: 'Input', View: 'View', ActivityIndicator: 'Spinner' },
  'expo-image': { Image: 'Image' }, 'expo-router': { router: { push() {} } }, '@/components/DockScrollView': { DockScrollView: 'Scroll' }, '@/components/glass': { GlassPressable: 'Button' },
  '@/components/SettingsUI': { SettingsPage: 'Page', SettingsGroup: 'Group', SettingRow: 'Row', SelectList: 'Select', SwitchList: 'Switches', settingsStyles: { content: {} } },
  '@/theme': { useTheme: () => palette, themed: (fn: any) => fn(palette), fontSize: { sm: 12, md: 16, lg: 20, xs: 10 }, spacing: { sm: 4, md: 8 } },
  '@/i18n': { useT: () => (key: string) => key } };
function harness() {
  const UI = load('../src/components/metadata/MetadataUI.tsx', shared);
  let epoch = 0, gate: Promise<void> | undefined;
  const song = { id: 'song', title: 'Original title', artist: 'Artist', album: 'Album', duration: 200 };
  const target = { kind: 'song', id: song.id, songs: [song], scope: { profile: 'A', source: 'server' }, current: () => epoch === 0 };
  const candidate = { id: 'itunes:1', provider: 'itunes', externalId: '1', fields: { title: 'Corrected title', artist: 'Artist', album: 'Album' }, confident: true };
  const writes: any[] = [], undos: any[] = [], queries: any[] = [];
  const state = { settings: models.DEFAULT_METADATA_SETTINGS, profiles: [], hydrate: async () => {} };
  const local = Object.assign(() => ({ songs: {} }), { getState: () => ({ hydrate: async () => {} }) });
  const Screen = load('../src/app/metadata/song.tsx', { ...shared, '@/components/metadata/MetadataUI': UI,
    '@/lib/metadata/hooks': { useMetadataTarget: () => epoch === 0 ? target : null }, '@/store/metadataScraping': { useMetadataScraping: () => state },
    '@/store/localMetadata': { useLocalMetadata: local }, '@/lib/metadata/models': models,
    '@/lib/metadata/repository': { metadataOperation: (scope: any, signal: AbortSignal, extra: () => boolean) => { const token = epoch; return { scope, signal, current: () => token === epoch && extra() }; } },
    '@/lib/metadata/providers': { searchMetadata: async (...args: any[]) => { models.metadataCheck(args[3]); queries.push(args); if (gate) await gate; models.metadataCheck(args[3]); return { candidates: [candidate], issues: [] }; },
      detailMetadata: async (value: unknown, _profiles: unknown, operation: any) => { models.metadataCheck(operation); return value; } },
    '@/lib/metadata/artwork': { fetchMetadataArtwork: async () => {} },
    '@/lib/metadata/apply': { applyMetadataCandidate: async (...args: any[]) => { models.metadataCheck(args[4]); writes.push(args); return args[5]; },
      undoMetadataCandidate: async (...args: any[]) => { models.metadataCheck(args[2]); undos.push(args); } },
  }).default;
  return { Screen, song, writes, undos, queries, changeOwner: () => { epoch++; }, hold: (promise: Promise<void>) => { gate = promise; } };
}
const button = (root: ReactTestRenderer, label: string) => root.root.findAllByType('Button' as any).find((node) => node.props.accessibilityLabel === label)!;
const input = (root: ReactTestRenderer, label: string) => root.root.findAllByType('Text' as any).find((node) => node.props.children === label)!.parent!.findByType('Input' as any);

test('actual metadata review keeps input identity, previews field choices and applies/undoes only after explicit actions', async () => {
  const h = harness(); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    const initial = input(root, 'Search title');
    for (const value of ['New', 'New title', 'New title typed']) {
      await act(async () => { input(root, 'Search title').props.onChangeText(value); });
      assert.equal(input(root, 'Search title'), initial);
    }
    assert.equal(root.root.findByType('Scroll' as any).props.keyboardShouldPersistTaps, 'handled'); assert.equal(h.writes.length, 0);
    await act(async () => { button(root, 'Search metadata and lyrics').props.onPress(); });
    assert.equal(h.queries[0][0].title, 'New title typed');
    await act(async () => { root.root.findAllByType('Button' as any).find((node) => node.props.accessibilityState)?.props.onPress(); });
    assert.ok(button(root, 'Apply selected fields locally'));
    await act(async () => { button(root, 'Apply selected fields locally').props.onPress(); });
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0][0].id, h.song.id); assert.ok(h.writes[0][2].includes('title')); assert.equal(h.writes[0][3], false);
    await act(async () => { button(root, 'Undo these changes').props.onPress(); }); assert.equal(h.undos.length, 1);
  } finally { await act(async () => root?.unmount()); }
});
test('a captured metadata action cannot write or publish results after account ABA invalidates its target', async () => {
  const h = harness(); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    await act(async () => { button(root, 'Search metadata and lyrics').props.onPress(); });
    await act(async () => { root.root.findAllByType('Button' as any).find((node) => node.props.accessibilityState)?.props.onPress(); });
    const old = button(root, 'Apply selected fields locally').props.onPress;
    h.changeOwner(); await act(async () => { root.update(React.createElement(h.Screen)); old(); });
    assert.equal(h.writes.length, 0); assert.equal(root.root.findAllByType('Input' as any).length, 0);
  } finally { await act(async () => root?.unmount()); }
});
test('late search completion is not shown after leaving its account', async () => {
  const h = harness(); let root!: ReactTestRenderer, release!: () => void;
  try {
    h.hold(new Promise<void>((resolve) => { release = resolve; }));
    await act(async () => { root = create(React.createElement(h.Screen)); });
    await act(async () => { button(root, 'Search metadata and lyrics').props.onPress(); });
    h.changeOwner(); await act(async () => { root.update(React.createElement(h.Screen)); release(); });
    assert.equal(root.root.findAllByType('Button' as any).filter((node) => node.props.accessibilityState).length, 0); assert.equal(h.writes.length, 0);
  } finally { await act(async () => root?.unmount()); }
});
