import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import { songContentKind, isLocalPodcastSong } from '../src/lib/contentKind';
import { songAddedAt } from '../src/lib/smartRules';
function load(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, setTimeout, require: (key: string) => { assert.ok(Object.hasOwn(imports, key), key); return imports[key]; } }); return exports;
}
function harness() {
  const auth = createStore<any>(() => ({ auth: { username: 'A' }, offline: false, autoOffline: false, offlineSource: 'device' })); let epoch = 0;
  auth.subscribe(() => { epoch++; }); const scope = () => ({ profile: auth.getState().auth.username, source: auth.getState().offlineSource });
  const capture = (_scope = scope(), extra = () => true) => { const token = epoch; return () => token === epoch && extra(); };
  const owner = { customizationScope: scope, captureCustomizationOwner: capture }, dbs = new Map<string, DatabaseSync>(), adapters = new Map<string, any>();
  let failRead = false, failWrite = false, heldRead: Promise<void> | undefined;
  const extras = load('lib/listeningExtras.ts', { './localCustomizations': owner, './localLibrary': { hashKey: (v: string) => v }, './mediaCacheDb': { mediaCacheDatabase: async (profile: string) => {
    if (!adapters.has(profile)) { const db = new DatabaseSync(':memory:'); dbs.set(profile, db); const params = (args: any[]) => args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
      const adapter = { execAsync: async (sql: string) => db.exec(sql), runAsync: async (sql: string, ...args: any[]) => { if (failWrite) throw new Error('Disk full'); return db.prepare(sql).run(...params(args)); },
        getFirstAsync: async (sql: string, ...args: any[]) => { if (heldRead) { const gate = heldRead; heldRead = undefined; await gate; } if (failRead) throw new Error('Locked'); return db.prepare(sql).get(...params(args)); },
        withTransactionAsync: async (work: () => Promise<void>) => { db.exec('BEGIN'); try { await work(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
      adapters.set(profile, adapter); } return adapters.get(profile);
  } } });
  const model = load('lib/localPodcasts.ts', { './contentKind': { songContentKind, isLocalPodcastSong }, './localLibrary': { hashKey: (v: string) => v }, './smartRules': { songAddedAt } });
  const api = load('store/localPodcasts.ts', { zustand: { create: createStore }, '@/lib/listeningExtras': extras, '@/lib/localCustomizations': owner, '@/lib/localPodcasts': model, './auth': { useAuthStore: auth } });
  return { api, model, dbs, auth, extras, owner, switch: (name: string) => auth.setState({ auth: { username: name } }), failRead: (v: boolean) => { failRead = v; }, failWrite: (v: boolean) => { failWrite = v; }, hold: (p: Promise<void>) => { heldRead = p; } };
}
const progress = (position: number) => ({ positionSec: position, durationSec: 100, played: false, updatedAt: 1000 + position });
test('real source-owned SQL progress merges concurrent episodes, retains failure data and never writes an account ABA', async () => {
  const h = harness(); await Promise.all([h.api.saveLocalPodcastProgress('a', progress(10)), h.api.saveLocalPodcastProgress('b', progress(20))]);
  assert.deepEqual(Object.keys(await h.api.loadLocalPodcastProgress()).sort(), ['a', 'b']);
  h.failWrite(true); await assert.rejects(h.api.saveLocalPodcastProgress('c', progress(30)), /Disk full/); h.failWrite(false);
  assert.deepEqual(Object.keys(await h.api.loadLocalPodcastProgress()).sort(), ['a', 'b']);
  h.switch('B'); assert.deepEqual(Object.keys(await h.api.loadLocalPodcastProgress()), []); h.switch('A');
  let release!: () => void; const gate = new Promise<void>((yes) => { release = yes; }); h.hold(gate);
  const work = h.api.saveLocalPodcastProgress('late', progress(40)); for (let i = 0; i < 15; i++) await Promise.resolve(); h.switch('B'); h.switch('A'); release();
  await assert.rejects(work, /changed/); assert.deepEqual(Object.keys(await h.api.loadLocalPodcastProgress()).sort(), ['a', 'b']);
  assert.equal(h.dbs.get('B')!.prepare('SELECT COUNT(*) n FROM listening_extras').get()!.n, 0);
});
test('a failed progress read cannot save an empty replacement and the original file IDs remain intact', async () => {
  const h = harness(); await h.api.saveLocalPodcastProgress('original-local-id', progress(17)); h.switch('B'); h.switch('A'); h.failRead(true);
  await assert.rejects(h.api.saveLocalPodcastProgress('new', progress(25)), /Locked/);
  h.failRead(false); assert.deepEqual(Object.keys(await h.api.loadLocalPodcastProgress()), ['original-local-id']);
});
test('metadata grouping excludes RSS/music, deduplicates IDs and sorts real track/date tags without inventing dates', async () => {
  const h = harness(), songs = [
    { id: 'z', title: 'Z', albumId: 'show', album: 'Show', artist: 'Author', track: 2, mediaKind: 'podcast', addedAt: 100 },
    { id: 'a', title: 'A', albumId: 'show', album: 'Show', artist: 'Author', track: 1, mediaKind: 'podcast' },
    { id: 'rss', title: 'RSS', podcastChannelId: 'rss', mediaKind: 'podcast' }, { id: 'music', title: 'Music' },
  ];
  const shows = await h.model.groupLocalPodcasts([...songs, songs[0]]); assert.equal(shows.length, 1); assert.equal(shows[0].id, 'album:show');
  assert.deepEqual(Array.from(h.model.orderLocalPodcastSongs(shows[0].songs, 'track'), (s: any) => s.id), ['a', 'z']);
  assert.deepEqual(Array.from(h.model.orderLocalPodcastSongs(shows[0].songs, 'oldest'), (s: any) => s.id), ['z', 'a'], 'unknown dates remain last in either direction');
  assert.equal(shows[0].songs[0], songs[0]); await assert.rejects(h.model.groupLocalPodcasts(songs, songContentKind, () => false), /changed/);
});

test('actual local podcast backup drains accepted writes, sanitizes metadata and restores only the same source without clobbering newer progress', async () => {
  const h = harness(), profileOwner = () => { const current = h.owner.captureCustomizationOwner(); return { profile: 'A', current, check: () => { if (!current()) throw Error('Owner changed'); } }; };
  const backup = load('lib/localPodcastBackup.ts', { '@/store/playlistRecovery': { personalOwner: profileOwner }, '@/store/localPodcasts': h.api, './localCustomizations': h.owner, './listeningExtras': h.extras, './localPodcasts': h.model });
  const pending = h.api.saveLocalPodcastProgress('one', progress(20)); const exported = await backup.exportLocalPodcastBackup(); await pending;
  assert.equal(exported.progress.one.positionSec, 20); assert.equal(exported.source, 'device');
  await h.api.saveLocalPodcastProgress('one', { ...progress(5), updatedAt: 5000 });
  const value = { ...exported, progress: { ...exported.progress, two: { ...progress(70), localUri: 'file:///private/audio.flac' } } };
  await backup.restoreLocalPodcastBackup(value); await backup.restoreLocalPodcastBackup(value);
  const result = await h.api.loadLocalPodcastProgress(); assert.equal(result.one.positionSec, 5); assert.equal(result.two.positionSec, 70); assert.equal(Object.keys(result).length, 2);
  assert.equal(JSON.stringify(await backup.exportLocalPodcastBackup()).includes('private'), false);
  assert.throws(() => backup.validateLocalPodcastBackup({ version: 1, source: 'device', progress: { 'https://private.test/audio?token=x': progress(1) } }), /Audio URLs/);
  h.auth.setState({ offlineSource: 'folder:abc' }); await assert.rejects(backup.restoreLocalPodcastBackup(exported), /same library source/);
  assert.equal(Object.keys(await h.api.loadLocalPodcastProgress()).length, 0);
});
