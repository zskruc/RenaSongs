import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import * as localPaths from '../src/lib/localPaths';
import { createLocalRefreshScheduler } from '../src/lib/localRefreshScheduler';
const turn = () => new Promise<void>((r) => setImmediate(r));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
function harness() {
  const source = { mode: 'folder', uris: ['file:///Music'] };
  const auth = createStore<any>(() => ({ auth: null, offline: true, offlineSource: source }));
  const storage = new Map<string, string>(), files = new Map([['file:///Music/A/list.m3u', '01.mp3'], ['file:///Music/B/list.m3u', '01.mp3']]);
  const songs = [{ id: 'a', title: 'A', uri: 'file:///Music/A/01.mp3', localUri: 'file:///Music/A/01.mp3' }, { id: 'b', title: 'B', uri: 'file:///Music/B/01.mp3', localUri: 'file:///Music/B/01.mp3' }];
  let gate: Promise<void> | undefined, entered = false;
  const hashKey = (text: string) => Array.from(text).reduce((value, c) => Math.imul(value ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(36);
  const mocks: Record<string, any> = {
    'expo-file-system/legacy': { documentDirectory: 'file:///app/', readAsStringAsync: async (uri: string) => { entered = true; await gate; return files.get(uri) ?? ''; } },
    '@/i18n': { tg: (text: string) => text }, '@/store/auth': { useAuthStore: auth, profileScopeId: () => auth.getState().auth?.username ?? 'local' },
    '@/store/playCounts': {}, '@/store/playHistory': {}, '@/lib/query': { queryClient: { invalidateQueries: async () => {} } },
    '@/lib/storage': { getItem: async (key: string) => storage.get(key) ?? null, setItem: async (key: string, value: string) => { storage.set(key, value); }, setItemStrict: async (key: string, value: string) => { storage.set(key, value); } },
    '@/store/downloads': {}, './downloadsDb': {},
    './localDb': { songUris: async () => songs, songsByIds: async (_src: unknown, ids: string[]) => new Map(songs.filter((s) => ids.includes(s.id)).map((s) => [s.id, s])) },
    './localLibrary': { hashKey, folderSetKey: (uris: string[]) => uris.join('|'), ensureScanned: async () => ({ src: { name: 'music' }, scanned: false }),
      refreshSource: async () => false, localPlaylistFiles: () => [...files.keys()],
      writeTextToFolder: async (dir: string, name: string, _mime: string, text: string) => { const uri = dir + '/' + name; files.set(uri, text); return uri; } },
    './localPaths': localPaths, './localRefreshScheduler': { createLocalRefreshScheduler },
  };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/localQueries.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { assert.ok(name in mocks, `Unexpected ${name}`); return mocks[name]; }, setTimeout, clearTimeout });
  return { api: exports, auth, storage, files, songs, hashKey, entered: () => entered, block: (value?: Promise<void>) => { gate = value; } };
}

test('identical relative M3U bodies from different folders resolve independently', async () => {
  const h = harness(); await h.api.refreshLocal(true);
  const lists: Map<string, string[]> = await h.api.playlistTracklists();
  assert.equal(lists.size, 2); assert.deepEqual([...lists.values()].map((ids) => [...ids]).sort(), [['a'], ['b']]);
  await h.api.refreshLocal(true); assert.equal((await h.api.playlistTracklists()).size, 2);
});

test('automatic M3U import and concurrent user changes share a persistence queue without losing unrelated edits', async () => {
  const h = harness(), playlist = await h.api.createPlaylist('Manual'); await h.api.addToPlaylist(playlist, 'a');
  const gate = deferred(); h.block(gate.promise);
  const importing = h.api.refreshLocal(true); while (!h.entered()) await turn();
  const adding = h.api.addToPlaylist(playlist, 'b'), creating = h.api.createPlaylist('New');
  gate.resolve(); await Promise.all([importing, adding, creating]);
  const lists: Map<string, string[]> = await h.api.playlistTracklists();
  assert.equal(lists.size, 4); assert.deepEqual([...lists.get(playlist)!], ['a', 'b']);
});

test('local to server transition during M3U reading cannot create playlists in either replacement profile or old cache', async () => {
  const h = harness(), gate = deferred(); h.block(gate.promise);
  const importing = h.api.refreshLocal(true); while (!h.entered()) await turn();
  h.auth.setState({ auth: { username: 'server' }, offline: false }); gate.resolve();
  assert.equal(await importing, false);
  assert.equal([...h.storage.keys()].some((key) => key.startsWith('resonus.localPlaylists')), false);
  h.auth.setState({ auth: null, offline: true }); h.block();
  await h.api.refreshLocal(true); assert.equal((await h.api.playlistTracklists()).size, 2);
});

test('an exported local playlist is remembered so a later folder check does not create an automatic duplicate', async () => {
  const h = harness(); h.files.clear(); const id = await h.api.createPlaylist('Manual'); await h.api.addToPlaylist(id, 'a');
  await h.api.exportPlaylistFile(id, 'file:///Music/Exports'); await h.api.refreshLocal(true);
  assert.equal((await h.api.playlistTracklists()).size, 1);
});
