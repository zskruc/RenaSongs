import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { normalizeSmartRule, EMPTY_RULE } from '../src/lib/smartRules';
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
function harness() {
  let profile = 'A', epoch = 0, gate: (() => Promise<void>) | undefined;
  const databases = new Map<string, DatabaseSync>(), adapters = new Map<string, any>();
  const owner = () => { const token = epoch, p = profile; return { profile: p, source: 'server', library: p, current: () => token === epoch && p === profile,
    check: () => { if (token !== epoch || p !== profile) throw new Error('Owner changed'); } }; };
  let creates = 0, failFill = true, ids: string[] = [], failDb = false;
  const api = { createPlaylistFromSongs: async (_name: string, songs: any[], recovery: { onCreated(id: string): Promise<void> }) => {
    creates++; await recovery.onCreated('restored'); if (failFill) throw new Error('Connection lost'); ids = songs.map((s) => s.id); return 'restored';
  }, getPlaylist: async () => ({ playlist: { id: 'restored', name: 'List (Restored)' }, songs: ids.map((id) => ({ id, title: id })) }),
    reorderPlaylist: async (_id: string, values: string[]) => { ids = [...values]; }, updatePlaylist: async () => {} };
  const imports = { './mediaCacheDb': { mediaCacheDatabase: async (p: string) => {
    if (!adapters.has(p)) {
      const db = new DatabaseSync(':memory:'); databases.set(p, db);
      const adapter = { execAsync: async (sql: string) => db.exec(sql), getFirstAsync: async (sql: string, ...args: any[]) => db.prepare(sql).get(...args),
        getAllAsync: async (sql: string, ...args: any[]) => db.prepare(sql).all(...args), runAsync: async (sql: string, ...args: any[]) => {
          if (gate && sql.startsWith('INSERT')) { const callback = gate; gate = undefined; await callback(); }
          if (failDb) throw new Error('Disk full'); return db.prepare(sql).run(...args);
        }, withExclusiveTransactionAsync: async (fn: (tx: any) => Promise<void>) => { db.exec('BEGIN'); try { await fn(adapter); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
      adapters.set(p, adapter);
    } return adapters.get(p);
  } }, './localLibrary': { hashKey: (v: string) => v }, './smartRules': { normalizeSmartRule }, '@/store/playlistRecovery': { personalOwner: owner },
    '@/store/recentlyDeleted': { notifyRecentlyDeleted() {} }, './lyricOwner': { captureLyricOwner: () => owner().current },
    './metadata/config': { validateScraperProfile: (value: unknown) => value, safeScraperProfile: (value: unknown) => value }, '@/api/data': api,
    './listeningDb': { saveSmartRule: async () => {} }, './metadata/repository': { restoreScraperProfile: async () => 'new-config' } };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/recentlyDeleted.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, require: (key: string) => { assert.ok(Object.hasOwn(imports, key), key); return imports[key as keyof typeof imports]; } });
  return { api: exports, databases, creates: () => creates, ids: () => ids, allowFill: () => { failFill = false; }, failDb: (value: boolean) => { failDb = value; },
    switchTo: (id: string) => { profile = id; epoch++; }, hold: (callback: () => Promise<void>) => { gate = callback; } };
}
function snapshot(h: ReturnType<typeof harness>) { return h.api.deletedPlaylistSnapshot({ id: 'old', name: 'List', songCount: 3 }, [
  { id: 'a', title: 'A', url: 'https://private.test/audio?token=secret', localUri: 'file:///private', coverArt: 'https://private.test/art', comment: 'private' },
  { id: 'b', title: 'B' }, { id: 'a', title: 'A' },
]); }
test('durable deletion snapshots retain duplicates but never audio URLs/credentials; pending operation stays recoverable after interruption', async () => {
  const h = harness(); const payload = snapshot(h);
  assert.equal(JSON.stringify(payload).includes('private'), false);
  const ticket = await h.api.prepareRecentlyDeleted({ kind: 'playlist', title: 'List', payload });
  let rows = await h.api.listRecentlyDeleted(); assert.equal(rows[0].confirmed, false); assert.deepEqual(plain(rows[0].payload.songs.map((s: any) => s.id)), ['a', 'b', 'a']);
  await h.api.commitRecentlyDeleted(ticket); rows = await h.api.listRecentlyDeleted(); assert.equal(rows[0].confirmed, true);
  h.switchTo('B'); assert.deepEqual(plain(await h.api.listRecentlyDeleted()), []);
  h.switchTo('A'); assert.equal((await h.api.listRecentlyDeleted()).length, 1);
  await h.api.permanentlyDeleteRecentlyDeleted(ticket.id); assert.equal((await h.api.listRecentlyDeleted()).length, 0);
});
test('restore checkpoints a newly allocated playlist before fill, keeps failed recovery and never creates it twice', async () => {
  const h = harness(); const ticket = await h.api.prepareRecentlyDeleted({ kind: 'playlist', title: 'List', payload: snapshot(h) }); await h.api.commitRecentlyDeleted(ticket);
  await assert.rejects(h.api.restoreRecentlyDeleted(ticket.id), /Connection lost/);
  assert.equal(h.creates(), 1); assert.equal((await h.api.listRecentlyDeleted())[0].restoredId, 'restored');
  h.allowFill(); assert.equal(await h.api.restoreRecentlyDeleted(ticket.id), 'restored'); assert.equal(h.creates(), 1);
  assert.deepEqual(plain(h.ids()), ['a', 'b', 'a']); assert.equal((await h.api.listRecentlyDeleted()).length, 0);
});
test('deletion journal must commit before source deletion; SQL failure or an account ABA rolls back instead of touching another profile', async () => {
  const h = harness(); h.failDb(true); await assert.rejects(h.api.prepareRecentlyDeleted({ kind: 'playlist', title: 'List', payload: snapshot(h) }), /Disk full/);
  h.failDb(false); let release!: () => void; const pending = new Promise<void>((yes) => { release = yes; }); h.hold(() => pending);
  const work = h.api.prepareRecentlyDeleted({ kind: 'playlist', title: 'List', payload: snapshot(h) });
  for (let i = 0; i < 20; i++) await Promise.resolve(); h.switchTo('B'); h.switchTo('A'); release();
  await assert.rejects(work, /Owner changed/); assert.equal((await h.api.listRecentlyDeleted()).length, 0);
});
test('smart rule snapshots preserve bounded AND/OR groups and explicit profile cleanup invalidates old tickets', async () => {
  const h = harness(); const rule = { ...EMPTY_RULE, id: 'old', name: 'Rule', groupMatch: 'any', groups: [{ match: 'all', conditions: [{ field: 'year', operator: 'at-least', value: 2000 }] }] };
  const ticket = await h.api.prepareRecentlyDeleted({ kind: 'smart-playlist', title: 'Rule', payload: rule });
  await h.api.commitRecentlyDeleted(ticket); assert.equal((await h.api.listRecentlyDeleted())[0].payload.groups[0].conditions[0].value, 2000);
  await h.api.clearRecentlyDeletedProfile('A'); await assert.rejects(h.api.commitRecentlyDeleted(ticket), /Library changed/);
  assert.equal((await h.api.listRecentlyDeleted()).length, 0);
});
