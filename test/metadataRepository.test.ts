import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import * as models from '../src/lib/metadata/models';
import * as config from '../src/lib/metadata/config';
import * as customizationModels from '../src/lib/localCustomizationModels';
import * as localMetadata from '../src/lib/localMetadata';
import * as lyricDocuments from '../src/lib/lyricDocuments';
import * as artworkRegistry from '../src/lib/metadata/artworkRegistry';
import * as archiveModels from '../src/lib/metadata/archiveModels';

function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, setTimeout, clearTimeout, AbortController, URL, URLSearchParams, require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return exports;
}
const hashKey = (value: string) => Array.from(value).reduce((total, char) => (Math.imul(total, 31) + char.charCodeAt(0)) >>> 0, 0).toString(36);
function harness() {
  const first = { username: 'A' }, auth = createStore<any>(() => ({ auth: first, offline: false, autoOffline: false, offlineSource: null }));
  const authModule = { useAuthStore: auth, profileScopeId: () => auth.getState().auth?.username ?? 'local' };
  const owner = load('../src/lib/lyricOwner.ts', { '@/store/auth': authModule });
  const raws = new Map<string, DatabaseSync>(), handles = new Map<string, any>(), credentials = new Map<string, string>(), deleted: string[] = [];
  let gate: (() => Promise<void>) | undefined, afterCommit: (() => void) | undefined;
  const database = async (profile: string) => {
    if (handles.has(profile)) return handles.get(profile);
    const raw = new DatabaseSync(':memory:'); raws.set(profile, raw);
    const wrapper = { execAsync: async (sql: string) => raw.exec(sql), getFirstAsync: async (sql: string, ...args: any[]) => raw.prepare(sql).get(...args),
      getAllAsync: async (sql: string, ...args: any[]) => raw.prepare(sql).all(...args), runAsync: async (sql: string, ...args: any[]) => raw.prepare(sql).run(...args),
      withExclusiveTransactionAsync: async (work: (tx: any) => Promise<void>) => {
        raw.exec('BEGIN IMMEDIATE'); try {
          await work({ getFirstAsync: wrapper.getFirstAsync, getAllAsync: wrapper.getAllAsync, runAsync: async (sql: string, ...args: any[]) => {
            if (gate && sql.startsWith('INSERT')) { const block = gate; gate = undefined; await block(); } return raw.prepare(sql).run(...args);
          } }); raw.exec('COMMIT'); const committed = afterCommit; afterCommit = undefined; committed?.();
        } catch (error) { raw.exec('ROLLBACK'); throw error; }
      } };
    handles.set(profile, wrapper); return wrapper;
  };
  const local = load('../src/lib/localCustomizations.ts', { '@/store/auth': authModule, './lyricOwner': owner, './localCustomizationModels': customizationModels,
    './localLibrary': { hashKey, folderSetKey: (uris: string[]) => [...uris].sort().join('|') }, './mediaCacheDb': { mediaCacheDatabase: database } });
  const repository = load('../src/lib/metadata/repository.ts', { 'expo-secure-store': { getItemAsync: async (key: string) => credentials.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { credentials.set(key, value); }, deleteItemAsync: async (key: string) => { credentials.delete(key); } },
    'expo-file-system/legacy': { documentDirectory: 'file:///app/', deleteAsync: async (uri: string) => { deleted.push(uri); } }, '@/store/auth': authModule,
    '@/lib/mediaCacheDb': { mediaCacheDatabase: database }, '@/lib/localLibrary': { hashKey }, '@/lib/localCustomizations': local, './config': config, './models': models,
    './artworkRegistry': artworkRegistry, './archiveModels': archiveModels });
  const choices = new Map<string, any>(), lyrics = new Map<string, any>();
  const apply = load('../src/lib/metadata/apply.ts', { '@/lib/localMetadata': localMetadata, '@/lib/localCustomizations': local, '@/lib/localLibrary': { hashKey },
    '@/lib/lyricLibraryDb': { chosenLyricSource: async (_: string, song: any) => choices.get(song.id)?.id ?? null,
      cachedLyricCandidates: async () => [...lyrics.values()], saveLyricCandidate: async (_: string, _song: any, value: any, current: () => boolean) => { assert.ok(current()); lyrics.set(value.id, value); },
      selectLyricCandidate: async (_: string, song: any, value: any, current: () => boolean) => { assert.ok(current()); choices.set(song.id, value); } },
    '@/lib/lyricDocuments': lyricDocuments, '@/lib/query': { queryClient: { invalidateQueries: async () => {} } }, './models': models, './repository': repository });
  return { auth, first, local, repository, apply, credentials, raws, choices, lyrics, deleted, gate: (value: () => Promise<void>) => { gate = value; }, afterCommit: (value: () => void) => { afterCommit = value; }, close: () => { for (const raw of raws.values()) raw.close(); } };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const song = { id: 'song', title: 'Title', artist: 'Artist', album: 'Album', albumId: 'album', duration: 100 };
const picked = { id: 'source:1', provider: 'source', externalId: '1', fields: { title: 'Corrected', albumArtist: 'Album artist', genres: [{ name: 'Pop' }, { name: 'Electronic' }] },
  lyrics: { synced: true, lines: [{ start: 100, value: 'A', translation: '译文', words: [{ start: 100, end: 800, value: 'A' }] }] } };

test('actual SQLite metadata intents preserve IDs, original fields and timed lyrics, and undo is reconciled without erasing a later edit', async () => {
  const h = harness(); try {
    const operation = h.repository.metadataOperation();
    await h.apply.applyMetadataCandidate(song, picked, ['title', 'albumArtist', 'genres', 'lyrics'], true, operation, 'intent');
    const saved = await h.local.readLocalCustomization(operation.scope, 'song-metadata', song.id);
    assert.equal(saved.patch.title, 'Corrected'); assert.equal(saved.original.title, 'Title'); assert.equal(saved.albumId, 'album');
    assert.deepEqual(JSON.parse(JSON.stringify(saved.patch.genres)), picked.fields.genres); assert.equal(saved.patch.albumArtist, 'Album artist');
    assert.deepEqual(JSON.parse(JSON.stringify(h.choices.get(song.id).lyrics)), picked.lyrics);
    await h.apply.applyMetadataCandidate(song, picked, ['title', 'albumArtist', 'genres', 'lyrics'], true, operation, 'intent');
    assert.equal((await h.repository.listMetadataRecords('undo', operation)).length, 1);
    await h.apply.undoMetadataCandidate(song, 'intent', operation);
    assert.equal(await h.local.readLocalCustomization(operation.scope, 'song-metadata', song.id), undefined); assert.equal(h.choices.get(song.id), null);
    await h.apply.applyMetadataCandidate(song, picked, ['title'], true, operation, 'later');
    await h.local.writeLocalCustomization(operation.scope, 'song-metadata', song.id, { version: 1, original: { title: 'Title' }, patch: { title: 'Manual later' } });
    await assert.rejects(h.apply.undoMetadataCandidate(song, 'later', operation), /Review again/);
    assert.equal((await h.local.readLocalCustomization(operation.scope, 'song-metadata', song.id)).patch.title, 'Manual later');
  } finally { h.close(); }
});
test('fill missing fields keeps existing/manual metadata while adding multigenre and album artist', async () => {
  const h = harness(); try {
    const operation = h.repository.metadataOperation();
    await h.apply.applyMetadataCandidate(song, picked, ['title', 'albumArtist', 'genres'], false, operation, 'missing');
    const saved = await h.local.readLocalCustomization(operation.scope, 'song-metadata', song.id);
    assert.equal(saved.patch.title, undefined); assert.equal(saved.patch.albumArtist, 'Album artist'); assert.equal(saved.patch.genre, 'Pop');
    const displayed = localMetadata.applySongDisplay(song, { [song.id]: saved }, []);
    assert.equal(displayed.id, song.id); assert.equal(displayed.albumId, song.albumId); assert.equal(localMetadata.sourceSong(displayed), song);
    assert.equal(localMetadata.applyAlbumDisplay({ id: 'album', name: 'Album', artist: 'Artist' }, { [song.id]: saved }, []).artist, 'Album artist');
  } finally { h.close(); }
});
test('silent batch writes keep a separate committed version and publish UI updates only when flushed', async () => {
  const h = harness(); try {
    const scope = h.local.customizationScope(), operation = h.repository.metadataOperation();
    const ui = h.local.metadataCustomizationRevision(), committed = h.local.localCustomizationWriteRevision();
    await h.local.writeLocalCustomization(scope, 'song-metadata', 'one', { version: 1, original: {}, patch: { mediaKind: 'audiobook' } }, operation.current, { notify: false });
    await h.local.writeLocalCustomization(scope, 'song-metadata', 'two', { version: 1, original: {}, patch: { title: 'Two' } }, operation.current, { notify: false });
    assert.equal(h.local.metadataCustomizationRevision(), ui); assert.equal(h.local.localCustomizationWriteRevision(), committed + 2);
    h.local.publishLocalCustomizationChanges(operation.current); assert.equal(h.local.metadataCustomizationRevision(), ui + 1);
    h.local.publishLocalCustomizationChanges(operation.current); assert.equal(h.local.metadataCustomizationRevision(), ui + 1);
  } finally { h.close(); }
});
test('queued actual SQLite write rolls back on account ABA and profile deletion cannot resurrect it', async () => {
  for (const mode of ['aba', 'delete'] as const) {
    const h = harness(); try {
      const operation = h.repository.metadataOperation(); let entered = false, release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
      h.gate(async () => { entered = true; await wait; });
      const work = h.repository.saveMetadataRecord('insight', 'artist:a', { source: 'Wikipedia', text: 'Old', url: 'https://en.wikipedia.org/wiki/Artist', language: 'en', fetchedAt: 1 }, operation), rejected = assert.rejects(work);
      while (!entered) await turn();
      let clearing: Promise<void> | undefined;
      if (mode === 'aba') { h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: h.first }); }
      else clearing = h.repository.clearMetadataProfile('A');
      release(); await rejected; await clearing;
      if (mode === 'delete') { await assert.rejects(h.repository.readMetadataRecord('insight', 'artist:a', h.repository.metadataOperation())); h.auth.setState({ auth: { username: 'A' } }); }
      assert.equal(await h.repository.readMetadataRecord('insight', 'artist:a', h.repository.metadataOperation()), undefined);
      if (mode === 'delete') assert.ok(h.deleted[0].startsWith('file:///app/metadata-artwork/'));
    } finally { h.close(); }
  }
});
test('source config secrets stay in SecureStore, safe exports omit them and recovery retries use one stable ID', async () => {
  const h = harness(); try {
    const operation = h.repository.metadataOperation(), raw = { version: 1, id: 'my_source', name: 'Private source', capabilities: ['metadata'],
      secrets: { seed: 'private-seed' }, search: { url: 'https://example.test/search', headers: { Authorization: 'Bearer private', Accept: 'application/json' }, script: 'return response.items;' } };
    await h.repository.saveScraperProfile(raw, operation);
    const safe = await h.repository.exportScraperProfileSafe('my_source'); const exported = JSON.stringify(await h.repository.exportMetadataProfile('A'));
    assert.ok(!exported.includes('Bearer private')); assert.ok(!exported.includes('private-seed')); assert.ok([...h.credentials.values()][0].includes('private-seed'));
    assert.equal(safe.search.headers.Authorization, undefined);
    const id = await h.repository.restoreScraperProfile(safe, () => true, 'restored_stable');
    assert.equal(await h.repository.restoreScraperProfile(safe, () => true, 'restored_stable'), id);
    assert.equal((await h.repository.listMetadataRecords('provider', operation)).length, 2);
    await h.repository.saveScraperProfile({ ...safe, id, name: 'Changed after restore' }, operation);
    await assert.rejects(h.repository.restoreScraperProfile(safe, () => true, 'restored_stable'), /edited/);
    h.auth.setState({ auth: { username: 'B' } }); assert.equal((await h.repository.listMetadataRecords('provider', h.repository.metadataOperation())).length, 0);
  } finally { h.close(); }
});

test('restoring a changed source recipe clears its old credentials while an unchanged recipe retains them', async () => {
  const h = harness(); try {
    const config = { version: 1, id: 'private_source', name: 'Private', capabilities: ['metadata'], search: { url: 'https://old.example/search', headers: { Authorization: 'Bearer old' } }, secrets: { seed: 'old' } };
    await h.repository.saveScraperProfile(config);
    const archive = await h.repository.exportMetadataProfile('A');
    await h.repository.restoreMetadataProfile('A', archive, () => true);
    assert.ok(JSON.stringify(await h.repository.scraperCredentials('private_source')).includes('Bearer old'));
    archive.entries[0].value.search.url = 'https://new.example/search';
    await h.repository.restoreMetadataProfile('A', archive, () => true);
    assert.equal(JSON.stringify(await h.repository.scraperCredentials('private_source')), '{}');
    assert.equal((await h.repository.exportScraperProfileSafe('private_source')).search.url, 'https://new.example/search');
  } finally { h.close(); }
});

test('retained tasks can read credentials only for the exact saved source recipe, including queued source edits', async () => {
  const h = harness(); try {
    const original = { version: 1, id: 'recipe_bound', name: 'Private', capabilities: ['metadata'], search: { url: 'https://first.example/search', headers: { Authorization: 'Bearer first' } } };
    const snapshot = await h.repository.saveScraperProfile(original), op = h.repository.metadataOperation();
    assert.ok(JSON.stringify(await h.repository.scraperCredentials(snapshot.id, op, snapshot)).includes('Bearer first'));
    let release!: () => void;
    h.gate(() => new Promise<void>((resolve) => { release = resolve; }));
    const change = h.repository.saveScraperProfile({ ...original, search: { url: 'https://second.example/search', headers: { Authorization: 'Bearer second' } } }, op);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    const staleRead = h.repository.scraperCredentials(snapshot.id, op, snapshot);
    release(); await change;
    await assert.rejects(staleRead, /Scraping source changed/);
    const current = await h.repository.exportScraperProfileSafe(original.id);
    assert.ok(JSON.stringify(await h.repository.scraperCredentials(current.id, op, current)).includes('Bearer second'));
    await h.repository.deleteScraperProfile(original.id);
    await assert.rejects(h.repository.scraperCredentials(snapshot.id, op, snapshot), /Scraping source changed/);
  } finally { h.close(); }
});

test('fill-missing applies positive numeric tags over zero and text over whitespace while preserving alternative tags', () => {
  const h = harness(); try {
    const raw = { id: 'missing', title: '   ', artist: '  ', album: 'Album', year: 0, track: 0, discNumber: 0, genre: 'Jazz', albumArtists: [{ id: 'a', name: 'Existing credited artist' }] };
    const candidate = { fields: { title: 'Correct title', artist: 'Singer', album: 'Other album', year: 2020, track: 3, discNumber: 1, genres: [{ name: 'Pop' }], albumArtist: 'Other credit' } };
    const patch = h.apply.metadataPatch(raw, undefined, candidate, ['title', 'artist', 'album', 'year', 'track', 'discNumber', 'genres', 'albumArtist'], false);
    assert.deepEqual(JSON.parse(JSON.stringify(patch)), { title: 'Correct title', artist: 'Singer', year: 2020, track: 3, discNumber: 1 });
  } finally { h.close(); }
});

test('metadata artwork compare-and-set cannot replace a newer manual choice or delete it on retry', async () => {
  const h = harness(); try {
    const op = h.repository.metadataOperation(), original = { uri: 'file:///app/old.png' }, manual = { uri: 'file:///app/manual.png' };
    await h.repository.saveMetadataRecord('artwork', 'song:s', original, op);
    await h.repository.saveMetadataRecord('artwork', 'song:s', manual, op);
    await assert.rejects(h.repository.saveMetadataRecord('artwork', 'song:s', { uri: 'file:///app/provider.png' }, op, { expected: original }), /Local metadata changed/);
    assert.deepEqual(JSON.parse(JSON.stringify(await h.repository.readMetadataRecord('artwork', 'song:s', op))), manual);
    await assert.rejects(h.repository.saveMetadataRecord('artwork', 'song:s', undefined, op, { expected: undefined }), /Local metadata changed/);
    await h.repository.saveMetadataRecord('artwork', 'song:s', original, op, { expected: manual });
    assert.deepEqual(JSON.parse(JSON.stringify(await h.repository.readMetadataRecord('artwork', 'song:s', op))), original);
  } finally { h.close(); }
});

test('a source commit followed immediately by an account handoff never restores old credentials onto its new recipe', async () => {
  const h = harness(); try {
    const config = { version: 1, id: 'private_source', name: 'Private', capabilities: ['metadata'], search: { url: 'https://old.example/search', headers: { Authorization: 'Bearer old' } }, secrets: { seed: 'old' } };
    await h.repository.saveScraperProfile(config);
    // The first commit records the key; switch only after the provider commit.
    h.afterCommit(() => { h.afterCommit(() => h.auth.setState({ auth: { username: 'B' } })); });
    await assert.rejects(h.repository.saveScraperProfile({ ...config, search: { url: 'https://new.example/search' }, secrets: {} }));
    h.auth.setState({ auth: { username: 'A' } });
    assert.equal((await h.repository.exportScraperProfileSafe('private_source')).search.url, 'https://new.example/search');
    assert.ok(!JSON.stringify(await h.repository.scraperCredentials('private_source')).includes('Bearer old'));
  } finally { h.close(); }
});

test('a manual edit accepted while the scraping undo intent is being saved wins the atomic local metadata comparison', async () => {
  const h = harness(); try {
    const operation = h.repository.metadataOperation(), manual = { version: 1, original: {}, patch: { title: 'Manual newest' } };
    // The metadata transaction ends before a queued customization write runs.
    h.afterCommit(() => { void h.local.writeLocalCustomization(operation.scope, 'song-metadata', song.id, manual); });
    await assert.rejects(h.apply.applyMetadataCandidate(song, picked, ['title'], true, operation, 'racing-intent'), /Review again/);
    assert.equal((await h.local.readLocalCustomization(operation.scope, 'song-metadata', song.id)).patch.title, 'Manual newest');
  } finally { h.close(); }
});
