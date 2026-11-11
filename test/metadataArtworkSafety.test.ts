import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as models from '../src/lib/metadata/models';
import * as config from '../src/lib/metadata/config';
import * as archiveModels from '../src/lib/metadata/archiveModels';
import * as imageHeader from '../src/lib/metadata/imageHeader';

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const turn = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve };
}
function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, Math, setTimeout, clearTimeout, AbortController, URL, URLSearchParams, Uint8Array, atob,
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), `${path}: ${name}`); return dependencies[name]; } });
  return exports;
}
const directory = 'file:///app/metadata-artwork/A/server/';
const gif = Uint8Array.from([71, 73, 70, 56, 57, 97, 100, 0, 100, 0, 1, 2, 3]);
function harness() {
  const raw = new DatabaseSync(':memory:'), files = new Map<string, Uint8Array>(), deleted: string[] = [], copied: { from: string; to: string }[] = [];
  const downloaded = deferred<void>(), copyStarted = deferred<void>();
  let downloadGate: Promise<void> | undefined, copyGate: Promise<void> | undefined, commits = 0;
  const operation = { scope: { profile: 'A', source: 'server' }, current: () => true };
  const database: any = { execAsync: async (sql: string) => raw.exec(sql),
    getFirstAsync: async (sql: string, ...args: any[]) => raw.prepare(sql).get(...args),
    getAllAsync: async (sql: string, ...args: any[]) => raw.prepare(sql).all(...args),
    runAsync: async (sql: string, ...args: any[]) => raw.prepare(sql).run(...args),
    withExclusiveTransactionAsync: async (work: (tx: any) => Promise<void>) => {
      raw.exec('BEGIN IMMEDIATE'); try { await work(database); raw.exec('COMMIT'); commits++; }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
    } };
  const fs = { documentDirectory: 'file:///app/', EncodingType: { Base64: 'base64' },
    makeDirectoryAsync: async () => {},
    getInfoAsync: async (uri: string) => ({ exists: files.has(uri), size: files.get(uri)?.length, isDirectory: false }),
    readAsStringAsync: async (uri: string) => Buffer.from(files.get(uri)!).toString('base64'),
    copyAsync: async (value: { from: string; to: string }) => {
      copied.push(value); files.set(value.to, files.get(value.from)!.slice());
      if (value.from.endsWith('.tmp')) { copyStarted.resolve(); if (copyGate) await copyGate; }
    },
    deleteAsync: async (uri: string) => { deleted.push(uri); files.delete(uri); },
    createDownloadResumable: (_url: string, temporary: string) => ({
      downloadAsync: async () => { files.set(temporary, gif.slice()); downloaded.resolve(); if (downloadGate) await downloadGate; return { status: 200, uri: temporary }; },
      cancelAsync: async () => {},
    }),
  };
  const repository = load('../src/lib/metadata/repository.ts', {
    'expo-secure-store': {}, 'expo-file-system/legacy': fs,
    '@/store/auth': { useAuthStore: { getState: () => ({ auth: { username: 'A' } }) } },
    '@/lib/mediaCacheDb': { mediaCacheDatabase: async () => database }, '@/lib/localLibrary': { hashKey: (value: string) => value },
    '@/lib/localCustomizations': { customizationScope: () => operation.scope, captureCustomizationOwner: () => () => true },
    './config': config, './models': models, './archiveModels': archiveModels, './artworkRegistry': {},
  });
  const artwork = load('../src/lib/metadata/artwork.ts', { 'expo-file-system/legacy': fs, '@/lib/localLibrary': { hashKey: (value: string) => value },
    '@/api/netGate': { isManualOffline: () => false }, './models': models, './repository': repository, './imageHeader': imageHeader });
  const previous = { uri: `${directory}previous.gif`, bytes: gif.length, mime: 'image/gif', updatedAt: 1 };
  files.set(previous.uri, gif.slice()); files.set('file:///picked-new.gif', gif.slice());
  return { raw, files, deleted, copied, repository, artwork, operation, previous, downloaded, copyStarted, commits: () => commits,
    blockDownload: (gate: Promise<void>) => { downloadGate = gate; }, blockCopy: (gate: Promise<void>) => { copyGate = gate; },
    init: () => repository.saveMetadataRecord('artwork', 'artist:artist', previous, operation),
    saved: () => repository.readMetadataRecord('artwork', 'artist:artist', operation),
    close: () => raw.close() };
}

test('actual SQLite artwork CAS keeps a hand-picked image that wins while a remote download or copy is in progress', async () => {
  for (const phase of ['download', 'copy']) {
    const h = harness(), release = deferred<void>();
    try {
      await h.init();
      if (phase === 'download') h.blockDownload(release.promise); else h.blockCopy(release.promise);
      const work = h.artwork.fetchMetadataArtwork('https://images.test/old-result.gif', 'artist', 'artist', h.operation);
      const rejected = assert.rejects(work, /Local metadata changed/);
      await (phase === 'download' ? h.downloaded.promise : h.copyStarted.promise);
      const manual = await h.artwork.savePickedMetadataArtwork('file:///picked-new.gif', 'artist', 'artist', h.operation);
      const commits = h.commits(); release.resolve(); await rejected; await turn();
      assert.deepEqual(plain(await h.saved()), plain(manual)); assert.equal(h.commits(), commits, 'the stale remote result must not commit');
      assert.equal(h.files.has(manual.uri), true); assert.equal(h.deleted.includes(manual.uri), false);
      assert.equal(h.files.has('file:///picked-new.gif'), true, 'the user source document is never deleted');
      const remoteCopy = h.copied.find((value) => value.from.endsWith('.tmp'))!;
      assert.equal(h.files.has(remoteCopy.to), false); assert.equal(h.files.has(remoteCopy.from), false);
    } finally { h.close(); }
  }
});

test('successful download commits its complete image and cleans only the previous owned image plus temporary download', async () => {
  const h = harness();
  try {
    await h.init(); h.files.set(`${directory}another-song.gif`, gif.slice());
    const saved = await h.artwork.fetchMetadataArtwork('https://images.test/cover.gif', 'artist', 'artist', h.operation); await turn();
    assert.deepEqual(plain(await h.saved()), plain(saved)); assert.deepEqual(h.files.get(saved.uri), gif);
    assert.equal(h.files.has(h.previous.uri), false); assert.equal(h.files.has(`${directory}another-song.gif`), true);
    assert.equal(h.files.has('file:///picked-new.gif'), true);
    assert.equal(h.deleted.includes(saved.uri), false); assert.equal(h.deleted.every((uri) => uri === h.previous.uri || uri.endsWith('.tmp')), true);
    assert.equal(h.commits(), 2);
  } finally { h.close(); }
});

test('a rejecting pre-commit guard cannot save artwork and removes the new copy and temporary file', async () => {
  const h = harness();
  try {
    await h.init(); const committed = h.commits(); let guarded = 0;
    await assert.rejects(h.artwork.fetchMetadataArtwork('https://images.test/cover.gif', 'artist', 'artist', h.operation, async () => {
      guarded++; throw new Error('Recording changed before commit');
    }), /Recording changed before commit/); await turn();
    assert.equal(guarded, 1); assert.equal(h.commits(), committed); assert.deepEqual(plain(await h.saved()), h.previous);
    assert.equal(h.files.has(h.previous.uri), true); assert.equal(h.deleted.includes(h.previous.uri), false);
    const created = h.copied[0]; assert.equal(h.files.has(created.to), false); assert.equal(h.files.has(created.from), false);
  } finally { h.close(); }
});

test('a download that observed no local artwork cannot overwrite a first manual selection made while it was running', async () => {
  const h = harness(), release = deferred<void>();
  try {
    assert.equal(await h.saved(), undefined); h.blockDownload(release.promise);
    const work = h.artwork.fetchMetadataArtwork('https://images.test/late-first-cover.gif', 'artist', 'artist', h.operation);
    const rejected = assert.rejects(work, /Local metadata changed/); await h.downloaded.promise;
    const chosen = await h.artwork.savePickedMetadataArtwork('file:///picked-new.gif', 'artist', 'artist', h.operation);
    release.resolve(); await rejected; await turn();
    assert.deepEqual(plain(await h.saved()), plain(chosen)); assert.equal(h.commits(), 1);
    assert.equal(h.files.has(chosen.uri), true); assert.equal(h.deleted.includes(chosen.uri), false);
  } finally { h.close(); }
});
