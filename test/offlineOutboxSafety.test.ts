import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import { remapOutbox } from '../src/lib/navidromeRemap';
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function load(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, require: (key: string) => { assert.ok(Object.hasOwn(imports, key), key); return imports[key]; } }); return exports;
}
function harness() {
  const a = { username: 'A', serverUrl: 'https://server.test' }, b = { username: 'B', serverUrl: 'https://server.test' };
  const auth = createStore<any>(() => ({ auth: a, offline: false, offlineSource: null, autoOffline: false }));
  const authModule = { useAuthStore: auth, profileScopeId: () => auth.getState().auth.username };
  const files = new Map<string, string>(), writes: string[] = []; let holdRead: Promise<void> | undefined, failRead = false, failWrite = false;
  const api = load('store/offlineQueue.ts', { zustand: { create: createStore }, './auth': authModule,
    '@/lib/localLibrary': { hashKey: (s: string) => s.replace(/[^a-z0-9]/gi, '_') }, '@/lib/navidromeRemap': { remapOutbox }, '@/lib/serverUrls': { primaryUrl: (a: any) => a.serverUrl },
    'expo-file-system/legacy': { documentDirectory: 'file:///test/', getInfoAsync: async (file: string) => ({ exists: files.has(file) }), makeDirectoryAsync: async () => {},
      readAsStringAsync: async (file: string) => { const text = files.get(file); const held = holdRead; holdRead = undefined; if (held) await held; if (failRead) throw new Error('Locked'); return text; },
      writeAsStringAsync: async (file: string, text: string) => { if (failWrite) throw new Error('Full'); writes.push(file); files.set(file, text); } } });
  const owner = load('lib/lyricOwner.ts', { '@/store/auth': authModule });
  return { api, q: () => api.useOfflineQueue.getState(), auth, authModule, owner, a, b, files, writes,
    disk: (a: any) => JSON.parse(files.get(api.outboxFileFor(a)) ?? '{}'), seed: (a: any, value: unknown) => files.set(api.outboxFileFor(a), JSON.stringify(value)),
    holdRead: (p: Promise<void>) => { holdRead = p; }, failRead: (value: boolean) => { failRead = value; }, failWrite: (value: boolean) => { failWrite = value; } };
}
test('an immediate listen and edits before hydration merge with durable pending work; unrelated account never receives it', async () => {
  const h = harness(), gate = deferred(); h.seed(h.a, { plays: [{ id: 'old', at: 1 }], ratings: { old: 4 }, playlists: { p: { name: 'Old' } } }); h.holdRead(gate.promise);
  h.q().addPlay('new', 2); h.q().setPlaylist('p', { name: 'Edited' }); await tick();
  h.auth.setState({ auth: h.b }); h.q().addPlay('b', 3); gate.resolve(); await h.q().flushPersistence();
  assert.deepEqual(h.disk(h.a), { plays: [{ id: 'old', at: 1 }, { id: 'new', at: 2 }], ratings: { old: 4 }, playlists: { p: { name: 'Edited' } } });
  assert.deepEqual(h.disk(h.b).plays, [{ id: 'b', at: 3 }]); assert.equal(h.q().data.ratings, undefined);
});
test('read/parse failures never overwrite durable outbox with a partial session; explicit retry recovers', async () => {
  const h = harness(); h.seed(h.a, { plays: [{ id: 'old', at: 1 }] }); h.failRead(true); h.q().addPlay('new', 2);
  await assert.rejects(h.q().flushPersistence(), /Locked/); assert.equal(h.writes.length, 0);
  h.failRead(false); await h.q().flushPersistence(); assert.deepEqual(h.disk(h.a).plays.map((x: any) => x.id), ['old', 'new']);
});
test('created playlist real-ID checkpoint is durable and acknowledgements do not erase concurrent edits', async () => {
  const h = harness(); h.q().setPlaylist('tmp_p', { created: true, name: 'List', songIds: ['a'] }); await h.q().flushPersistence();
  const initial = h.q().data.playlists.tmp_p; const expected = await h.q().checkpointPlaylistCreated('tmp_p', 'real', initial);
  assert.equal(h.disk(h.a).playlists.tmp_p, undefined); assert.equal(h.disk(h.a).playlists.real.created, false);
  h.q().setPlaylist('real', { name: 'Changed during upload' }); h.q().acknowledgePlaylist('real', expected); await h.q().flushPersistence();
  assert.equal(h.disk(h.a).playlists.real.name, 'Changed during upload');
});
function flushHarness() {
  const h = harness(); let repairFailure = false, creates = 0, reorders = 0, ratingCalls = 0;
  let ids: string[] = [], failFill = true; let afterCreate = async () => {};
  class RequestError extends Error { code: number; network: boolean; constructor(code: number, network = false) { super('Server error'); this.code = code; this.network = network; } }
  const tree = ts.createSourceFile('data.ts', readFileSync(new URL('../src/api/data.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = ['flushOutbox', 'createFreshServerPlaylist'].map((name) => tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)!.getText(tree)).join('\n');
  const context: Record<string, any> = { exports: {}, useAuthStore: h.auth, profileScopeId: h.authModule.profileScopeId,
    captureLyricOwner: h.owner.captureLyricOwner, useOfflineQueue: h.api.useOfflineQueue, outboxFileFor: h.api.outboxFileFor, bump() {},
    Subsonic: { SubsonicRequestError: RequestError, getPlaylists: async () => [],
      createPlaylist: async () => { creates++; await afterCreate(); return 'real'; }, getPlaylist: async () => ({ playlist: { id: 'real', name: 'List', owner: 'A', songCount: ids.length }, songs: ids.map((id) => ({ id, title: id })) }),
      reorderPlaylist: async (_a: unknown, _p: string, value: string[]) => { reorders++; if (failFill) throw new Error('Disconnected'); ids = [...value]; },
      updatePlaylist: async () => {}, setRating: async () => { ratingCalls++; throw new RequestError(70); },
      star: async () => { throw new RequestError(70); } },
    require: (key: string) => { assert.equal(key, '@/lib/navidromeRepair'); return { repairIfMigrated: async () => { if (repairFailure) throw new Error('Repair unverified'); } }; } };
  runInNewContext(ts.transpileModule(functions + '\nexports.flush=flushOutbox', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { ...h, flush: () => context.exports.flush(h.a, h.api.outboxFileFor(h.a)), counts: () => ({ creates, reorders, ratingCalls }), repairFailure: () => { repairFailure = true; }, allowFill: () => { failFill = false; }, onCreate: (fn: () => Promise<void>) => { afterCreate = fn; } };
}
test('actual reconnect flush never recreates the playlist when its first fill fails, and retains code70 intents durably', async () => {
  const h = flushHarness(); h.q().setPlaylist('tmp_p', { created: true, name: 'List', songIds: ['a', 'a'] }); h.q().setRating('gone', 4); h.q().setFav('gone', 'song', true); await h.flush();
  assert.equal(h.counts().creates, 1); assert.deepEqual(h.disk(h.a).playlists.real.songIds, ['a', 'a']);
  assert.equal(h.disk(h.a).blockedRatings.gone, 4); assert.equal(h.disk(h.a).blockedFavs.gone.starred, true);
  h.allowFill(); await h.flush(); assert.equal(h.counts().creates, 1); assert.equal(h.counts().reorders, 2); assert.deepEqual(h.disk(h.a).playlists, {});
  assert.equal(h.counts().ratingCalls, 1, 'confirmed missing rows do not retry forever');
});
test('a code70 response after an unverified ID repair remains retryable rather than losing the original intention', async () => {
  const h = flushHarness(); h.repairFailure(); h.q().setRating('old-id', 5); await h.flush();
  assert.equal(h.disk(h.a).ratings['old-id'], 5); assert.equal(h.disk(h.a).blockedRatings['old-id'], undefined);
});
test('profile deletion fences an already queued outbox read and cannot recreate the removed file', async () => {
  const h = harness(), gate = deferred(); h.seed(h.a, { plays: [{ id: 'old', at: 1 }] }); h.holdRead(gate.promise); h.q().addPlay('new', 2); await tick();
  const stop = h.api.stopOfflineQueueProfile(h.a); gate.resolve(); await stop; assert.equal(h.writes.length, 0);
  assert.throws(() => h.q().addPlay('later', 3), /deleted/);
});

test('a create response after account handover checkpoints only its original file before stopping all remote writes', async () => {
  const h = flushHarness(); h.q().setPlaylist('tmp_p', { created: true, name: 'List', songIds: ['a'] });
  h.onCreate(async () => { h.auth.setState({ auth: h.b }); });
  await h.flush();
  assert.equal(h.disk(h.a).playlists.real.created, false); assert.equal(h.disk(h.b).playlists, undefined);
  assert.equal(h.counts().reorders, 0);
  h.auth.setState({ auth: h.a }); h.allowFill(); await h.flush();
  assert.equal(h.counts().creates, 1); assert.deepEqual(h.disk(h.a).playlists, {});
});
