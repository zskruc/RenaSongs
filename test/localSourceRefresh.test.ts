/** Actual local filesystem/catalog refresh boundaries with a failed SAF provider. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createCoverIndex } from '../src/lib/coverIndex';
import { songNeedsReread } from '../src/lib/songReread';

function harness() {
  const TREE = 'content://provider/tree/primary%3AMusic';
  const doc = (path: string) => `${TREE}/document/${encodeURIComponent(`primary:Music/${path}`)}`;
  const album = doc('Album'), a = doc('Album/a.mp3'), b = doc('Album/b.mp3');
  const files = new Map<string, string[]>([[TREE, [album]], [album, [a]]]);
  const stamps = new Map([[a, 1000], [b, 2000]]), storage = new Map<string, string>(), catalogs = new Map<string, any>();
  const reads: string[] = [], copies: string[] = [], deletions: string[] = []; let copyFails = false; let blocked: Promise<void> | undefined, failDir: string | undefined, saves = 0;
  const clone = (value: any) => value ? structuredClone(value) : null;
  const Db = {
    saveCatalog: async (_dir: string, name: string, value: any) => { catalogs.set(name, clone(value)); saves++; },
    loadCatalog: async (_dir: string, name: string) => clone(catalogs.get(name)),
    songStamps: async (src: any) => new Map((catalogs.get(src.name)?.songs ?? []).map((song: any) => [song.id, song.addedAt ?? 0])),
    hasSongs: async (src: any) => !!catalogs.get(src.name)?.songs.length,
    backfillColumn: async () => {},
    coverRows: async (src: any, table: string) => clone(catalogs.get(src.name)?.[table] ?? []),
    closeLocalDbs: async () => {},
  };
  const fs = { documentDirectory: 'file:///app/', EncodingType: { Base64: 'base64' },
    makeDirectoryAsync: async () => {}, deleteAsync: async (uri: string) => { deletions.push(uri); }, writeAsStringAsync: async () => {},
    getInfoAsync: async (uri: string) => ({ exists: true, modificationTime: (stamps.get(uri) ?? 0) / 1000, size: 10 }),
    readAsStringAsync: async (uri: string) => { reads.push(uri); await blocked; return ''; },
    copyAsync: async ({ from }: any) => { copies.push(from); if (copyFails) throw new Error('image source unavailable'); },
    StorageAccessFramework: { readDirectoryAsync: async (uri: string) => { if (uri === failDir) throw new Error('permission'); return files.get(uri) ?? []; } },
  };
  const mocks: Record<string, any> = { 'expo-file-system/legacy': fs, 'expo-media-library/legacy': {},
    '@/lib/perfLog': { bump: () => {} }, '@/store/scanProgress': { useScanProgress: { getState: () => ({ begin() {}, tick() {}, start() {}, startCovers() {}, done() {} }) } },
    './containerTags': { isFlac: () => false, isMp4: () => false }, './id3': { base64ToUint8: () => new Uint8Array(), parseID3: () => ({}) },
    './localDb': Db, './storage': { getItem: async (key: string) => storage.get(key) ?? null, setItem: async (key: string, value: string) => { storage.set(key, value); } },
    './coverIndex': { createCoverIndex }, './songReread': { songNeedsReread },
  };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/localLibrary.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require: (id: string) => { if (id in mocks) return mocks[id]; throw new Error(`Unexpected ${id}`); }, Uint8Array, Map, Set, Promise, console });
  return { api: exports, TREE, album, a, b, doc, files, stamps, reads, copies, deletions, catalogs, failCopies: () => { copyFails = true; }, saves: () => saves,
    fail: (dir?: string) => { failDir = dir; }, block: (gate?: Promise<void>) => { blocked = gate; } };
}

test('folder refresh retains unchanged tags, adds/removes files, discovers side artwork and manual rescan checks changed timestamps', async () => {
  const h = harness(), first = await h.api.ensureScanned('folder', [h.TREE]);
  assert.equal(h.catalogs.get(first.src.name).songs.length, 1);
  h.reads.length = 0; h.files.set(h.album, [h.a, h.b, h.doc('Album/cover.jpg'), h.doc('Album/artist.jpg')]);
  assert.equal(await h.api.refreshSource('folder', [h.TREE]), true);
  assert.equal(h.catalogs.get(first.src.name).songs.length, 2);
  assert.equal(h.reads.includes(h.a), false, 'unchanged song tags were retained'); assert.equal(h.reads.includes(h.b), true);
  assert.equal(h.copies.length, 2); assert.equal(h.catalogs.get(first.src.name).artists[0].ownImage, true);
  h.reads.length = 0; await h.api.refreshSource('folder', [h.TREE], true);
  assert.equal(h.reads.length, 0, 'manual scan stats unchanged music without rereading tags');
  h.stamps.set(h.a, 3000); await h.api.refreshSource('folder', [h.TREE], true);
  assert.equal(h.reads.includes(h.a), true); assert.equal(h.reads.includes(h.b), false);
  h.files.set(h.album, [h.b]); await h.api.refreshSource('folder', [h.TREE]);
  assert.equal(h.catalogs.get(first.src.name).songs.length, 1);
});

test('a failed nested folder read preserves the complete catalog instead of treating permission loss as song deletion', async () => {
  const h = harness(), first = await h.api.ensureScanned('folder', [h.TREE]); const before = h.saves();
  h.fail(h.album); await assert.rejects(h.api.refreshSource('folder', [h.TREE], true), /every music folder/);
  assert.equal(h.saves(), before); assert.equal(h.catalogs.get(first.src.name).songs.length, 1);
});

test('a scan retired during file I/O cannot publish or persist its old source after source replacement', async () => {
  const h = harness(); let release!: () => void; const gate = new Promise<void>((r) => { release = r; }); h.block(gate);
  const work = h.api.ensureScanned('folder', [h.TREE]); const rejected = assert.rejects(work, /source changed/);
  while (!h.reads.length) await new Promise<void>((r) => setImmediate(r));
  h.api.clearLocalCatalog(); release(); await rejected; assert.equal(h.saves(), 0);
});


test('failed side-image replacement retains the last committed cover and artist picture without deleting either', async () => {
  const h = harness(); h.files.set(h.album, [h.a, h.doc('Album/cover.jpg'), h.doc('Album/artist.jpg')]);
  const first = await h.api.ensureScanned('folder', [h.TREE]);
  const before = h.catalogs.get(first.src.name), albumImage = before.albums[0].coverUri, artistImage = before.artists[0].coverUri;
  assert.ok(albumImage); assert.ok(artistImage); h.failCopies();
  await h.api.refreshSource('folder', [h.TREE], true);
  const after = h.catalogs.get(first.src.name);
  assert.equal(after.albums[0].coverUri, albumImage); assert.equal(after.artists[0].coverUri, artistImage);
  assert.equal(h.deletions.includes(albumImage), false); assert.equal(h.deletions.includes(artistImage), false);
});

test('an external account owner retiring during tag I/O stops publication without requiring catalog clear', async () => {
  const h = harness(); let current = true, release!: () => void;
  h.block(new Promise<void>((r) => { release = r; }));
  const work = h.api.ensureScanned('folder', [h.TREE], () => current); const rejected = assert.rejects(work, /source changed/);
  while (!h.reads.length) await new Promise<void>((r) => setImmediate(r));
  current = false; release(); await rejected; assert.equal(h.saves(), 0);
  assert.equal(h.api.getLocalCatalog('folder', h.TREE), undefined);
});


test('a previously empty chosen folder notices music added later', async () => {
  const h = harness(); h.files.set(h.TREE, []);
  const first = await h.api.ensureScanned('folder', [h.TREE]);
  assert.equal(h.catalogs.get(first.src.name).songs.length, 0);
  h.files.set(h.TREE, [h.album]);
  assert.equal(await h.api.refreshSource('folder', [h.TREE]), true);
  assert.equal(h.catalogs.get(first.src.name).songs.length, 1);
});
