import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function evaluate(source: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Date, Math, require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return exports;
}
function load(path: string, dependencies: Record<string, unknown>) { return evaluate(readFileSync(new URL(path, import.meta.url), 'utf8'), dependencies); }
function selectionStore() {
  let state = { auth: { username: 'A' } as { username: string } | null, offline: false, offlineSource: null as object | null, autoOffline: false };
  const subscriptions: ((next: typeof state, before: typeof state) => void)[] = [];
  let ownerEpoch = 0;
  const customization = { captureCustomizationOwner: () => { const token = ownerEpoch; return () => token === ownerEpoch; } };
  const auth = { useAuthStore: { getState: () => state, subscribe: (listener: (next: typeof state, before: typeof state) => void) => subscriptions.push(listener) } };
  const api = load('../src/store/metadataBulkSelection.ts', { '@/lib/localCustomizations': customization, './auth': auth });
  const change = (patch: Partial<typeof state>) => {
    const before = state; state = { ...state, ...patch }; ownerEpoch++;
    for (const listener of subscriptions) listener(state, before);
  };
  return { api, customization, change, invalidateOwner: () => { ownerEpoch++; }, subscriptions };
}

test('selected-song handoff retains all unique IDs above 1000, contains no Song payload, and protects its stored order', () => {
  const h = selectionStore();
  const songs = Array.from({ length: 12_345 }, (_, n) => ({ id: `s-${n}`, title: `Title ${n}`, url: 'private://credential', coverArt: 'file:///private' }));
  const key = h.api.createSelectedMetadataSongs([...songs, songs[10]]);
  const ids = h.api.readSelectedMetadataSongs(key);
  assert.equal(ids.length, 12_345); assert.deepEqual(plain(ids), songs.map((song) => song.id));
  ids.splice(0, 100); assert.equal(h.api.readSelectedMetadataSongs(key).length, 12_345);
  songs[0].id = 'changed-after-handoff'; assert.equal(h.api.readSelectedMetadataSongs(key)[0], 's-0');
  const next = h.api.createSelectedMetadataSongs([{ id: 'replacement' }]);
  assert.equal(h.api.readSelectedMetadataSongs(key), null); h.api.clearSelectedMetadataSongs(key);
  assert.deepEqual(plain(h.api.readSelectedMetadataSongs(next)), ['replacement']);
  h.api.clearSelectedMetadataSongs(next); assert.equal(h.api.readSelectedMetadataSongs(next), null);
  assert.equal(h.subscriptions.length, 1);
});

test('account ABA, offline and source changes permanently retire old selection keys', () => {
  for (const transition of [{ auth: { username: 'B' } }, { offline: true }, { offlineSource: { mode: 'device' } }, { autoOffline: true }]) {
    const h = selectionStore(), key = h.api.createSelectedMetadataSongs([{ id: 'a' }]);
    h.change(transition); h.change({ auth: { username: 'A' }, offline: false, offlineSource: null, autoOffline: false });
    assert.equal(h.api.readSelectedMetadataSongs(key), null);
  }
  const h = selectionStore(), key = h.api.createSelectedMetadataSongs([{ id: 'a' }]);
  h.invalidateOwner(); assert.equal(h.api.readSelectedMetadataSongs(key), null);
  assert.throws(() => h.api.createSelectedMetadataSongs([]), /Invalid metadata song selection/);
  assert.throws(() => h.api.createSelectedMetadataSongs([{ id: 'bad\nidentity' }]), /Invalid metadata song selection/);
});

function hookHarness() {
  const handoff = selectionStore();
  let focused = true, selected = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], menu: any, failNavigation = false;
  const routes: any[] = [], notices: string[] = []; let runs = 0;
  const router = { push: (route: unknown) => { if (failNavigation) throw new Error('route unavailable'); routes.push(route); } };
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSXRuntime, 'expo-router': { useRouter: () => router, useIsFocused: () => focused },
    '@/api/data': {}, '@/components/Dialog': { Dialog: () => null },
    '@/lib/downloadRemoval': {}, '@/store/auth': { useAuthStore: (select: (state: unknown) => unknown) => select({ offline: false, auth: {} }) },
    '@/i18n': { useT: () => (key: string) => key, songsLabel: (n: number) => `${n} songs` }, '@/lib/exportSong': {}, '@/lib/favoritesCache': {}, '@/lib/format': {}, '@/lib/localLibrary': {},
    '@/lib/localCustomizations': handoff.customization, '@/store/metadataBulkSelection': handoff.api,
    '@/store/downloads': { anyDownloads: () => false, useDownloads: (select: (state: unknown) => unknown) => select({ files: {} }) },
    '@/store/settings': { useSettings: (select: (state: unknown) => unknown) => select({ language: 'en' }) },
    '@/store/toast': { useToast: (select: (state: unknown) => unknown) => select({ show: (message: string) => notices.push(message) }) },
    './useFavoriteIds': { useFavoriteIds: () => new Set() },
  };
  const hook = load('../src/hooks/useSelectionMenu.tsx', dependencies).useSelectionMenu;
  function Screen() { menu = hook((callback: (songs: unknown[]) => void) => { runs++; callback(selected); }); return null; }
  return { handoff, Screen, routes, notices, action: () => menu.actions.find((action: any) => action.label === 'Scrape selected songs').onPress,
    runs: () => runs, setFocused: (value: boolean) => { focused = value; }, setSelected: (value: typeof selected) => { selected = value; }, failNavigation: (value: boolean) => { failNavigation = value; } };
}

test('shared multi-select action opens the chooser once using a scoped key and preserves the complete chosen IDs', async () => {
  const h = hookHarness(); let root!: ReactTestRenderer;
  try {
    h.setSelected(Array.from({ length: 1700 }, (_, n) => ({ id: `song-${n}`, title: 'Song' })));
    await act(async () => { root = create(React.createElement(h.Screen)); });
    const action = h.action(); await act(async () => { action(); action(); });
    assert.equal(h.routes.length, 1); assert.equal(h.runs(), 1);
    assert.deepEqual(Object.keys(h.routes[0].params).sort(), ['kind', 'selection']);
    assert.equal(h.routes[0].pathname, '/metadata/bulk'); assert.equal(h.routes[0].params.kind, 'selected');
    assert.equal(h.handoff.api.readSelectedMetadataSongs(h.routes[0].params.selection).length, 1700);
    await act(async () => { h.setFocused(false); root.update(React.createElement(h.Screen)); });
    await act(async () => { h.setFocused(true); h.setSelected([{ id: 'new', title: 'New' }]); root.update(React.createElement(h.Screen)); });
    await act(async () => { h.action()(); }); assert.equal(h.routes.length, 2);
    assert.equal(h.handoff.api.readSelectedMetadataSongs(h.routes[0].params.selection), null);
  } finally { await act(async () => root?.unmount()); }
});

test('leaving or unmounting a selection screen disables its queued metadata action', async () => {
  const h = hookHarness(); let root!: ReactTestRenderer;
  await act(async () => { root = create(React.createElement(h.Screen)); });
  const stale = h.action();
  await act(async () => { h.setFocused(false); root.update(React.createElement(h.Screen)); });
  await act(async () => { stale(); }); assert.equal(h.routes.length, 0);
  await act(async () => { root.unmount(); });
  await act(async () => { stale(); }); assert.equal(h.routes.length, 0);
});

test('empty selection, stale account callbacks and rejected navigation cannot create a leaked bulk handoff', async () => {
  const h = hookHarness(); let root!: ReactTestRenderer;
  try {
    h.setSelected([]); await act(async () => { root = create(React.createElement(h.Screen)); });
    await act(async () => { h.action()(); }); assert.equal(h.routes.length, 0);
    const stale = h.action(); h.handoff.change({ auth: { username: 'B' } });
    await act(async () => { stale(); }); assert.equal(h.routes.length, 0);
    await act(async () => { h.setSelected([{ id: 'new', title: 'New' }]); root.update(React.createElement(h.Screen)); });
    h.failNavigation(true); await act(async () => { h.action()(); }); assert.equal(h.notices.length, 1);
    h.failNavigation(false); await act(async () => { h.action()(); }); assert.equal(h.routes.length, 1);
  } finally { await act(async () => root?.unmount()); }
});

/** Compile each production menu entry unchanged, isolating only the native/page boundary. */
function entry(path: string, label: string, artist = false) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8'), file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let match: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (match) return;
    if (!artist && ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'Action'
      && node.attributes.getText(file).includes(`t('${label}')`)) match = node;
    if (artist && ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'Pressable'
      && node.getText(file).includes(`t('${label}')`)) match = node;
    if (!match) ts.forEachChild(node, visit);
  }
  visit(file); assert.ok(match, `${path} ${label}`);
  const source = `export function render(env) { const { metadataOwner, metadataOpening, metadataPage, id, album, playlist, item, name, data, styles, t, dismissAction, close, router, openMetadataTarget } = env;
    const Action = 'Action', Pressable = 'Pressable', Icon = 'Icon', Text = 'Text', colors = {}; return ${match.getText(file)}; }`;
  return evaluate(source, { 'react/jsx-runtime': JSXRuntime }).render;
}
function entryHarness() {
  let current = true;
  const after: (() => void)[] = [], routes: any[] = [], targets: any[] = [];
  const env = { metadataOwner: () => current, metadataOpening: { current: false }, metadataPage: { current: { id: 'artist', focused: true } }, id: 'artist',
    album: { id: 'album', name: 'Album' } as { id: string; name: string } | null, playlist: { id: 'playlist', name: 'Playlist' }, item: { kind: 'album' }, name: 'Album',
    data: { artist: { id: 'artist', name: 'Artist' } }, styles: {}, t: (key: string) => key,
    dismissAction: (callback: () => void) => after.push(callback), close: (callback: () => void) => after.push(callback),
    router: { push: (route: unknown) => routes.push(route) }, openMetadataTarget: (target: unknown) => targets.push(target) };
  return { env, after, routes, targets, changeOwner: () => { current = false; } };
}

test('album and playlist bulk menu entries route by entity immediately without fetching song payloads', () => {
  const render = entry('../src/components/MediaMenuSheet.tsx', 'Batch scrape metadata');
  for (const kind of ['album', 'playlist']) {
    const h = entryHarness(); h.env.item.kind = kind;
    if (kind === 'playlist') { h.env.album = null; h.env.name = 'Playlist'; }
    render(h.env).props.onPress(); assert.equal(h.routes.length, 0); h.after[0]();
    assert.deepEqual(plain(h.routes[0]), { pathname: '/metadata/bulk', params: { kind, id: kind, title: kind === 'album' ? 'Album' : 'Playlist' } });
    assert.equal(h.targets.length, 0);
  }
  const h = entryHarness(); render(h.env).props.onPress(); h.changeOwner(); h.after[0](); assert.equal(h.routes.length, 0);
});

test('artist bulk entry guards duplicate taps, changed pages and account changes during dismissal', () => {
  const render = entry('../src/app/artist/[id].tsx', 'Batch scrape metadata', true);
  const h = entryHarness(), action = render(h.env).props.onPress; action(); action(); assert.equal(h.after.length, 1);
  h.after[0](); assert.deepEqual(plain(h.routes[0]), { pathname: '/metadata/bulk', params: { kind: 'artist', id: 'artist', title: 'Artist' } });
  for (const change of ['account', 'id', 'background']) {
    const old = entryHarness(); render(old.env).props.onPress();
    if (change === 'account') old.changeOwner();
    else if (change === 'id') old.env.metadataPage.current.id = 'other';
    else old.env.metadataPage.current.focused = false;
    old.after[0](); assert.equal(old.routes.length, 0);
  }
});

test('existing album/artist artwork and biography menu entries stay available without preloading whole discographies', () => {
  for (const [path, artist] of [['../src/components/MediaMenuSheet.tsx', false], ['../src/app/artist/[id].tsx', true]] as const) {
    const h = entryHarness(); entry(path, 'Metadata and local artwork', artist)(h.env).props.onPress(); h.after[0]();
    assert.equal(h.routes[0], '/metadata');
    assert.deepEqual(plain(h.targets[0]), { kind: artist ? 'artist' : 'album', id: artist ? 'artist' : 'album', title: artist ? 'Artist' : 'Album', songs: [] });
  }
});
