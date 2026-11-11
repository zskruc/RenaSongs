import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as models from '../src/lib/metadata/models';
import * as customizationModels from '../src/lib/localCustomizationModels';
import * as localMetadata from '../src/lib/localMetadata';
import * as lyricDocuments from '../src/lib/lyricDocuments';
import type { Song } from '../src/api/subsonic';
import type * as Catalog from '../src/lib/metadata/catalog';

const hashKey = (value: string) => Array.from(value).reduce((total, char) => (Math.imul(total, 31) + char.charCodeAt(0)) >>> 0, 0).toString(36);
const song = (id: string, extra: Partial<Song> = {}): Song => ({ id, title: `Song ${id}`, ...extra });
const lyrics = { synced: false, lines: [{ value: 'Already saved lyrics' }] };
function harness() {
  let state: any = { auth: { username: 'A', serverType: 'navidrome' }, offline: false, offlineSource: null, hydrating: false };
  let libraries: any = { disabled: {}, folders: {} }, current = true;
  const calls: { offset: number; folder: number; count: number }[] = [], serverCalls: string[] = [], localCalls: string[] = [];
  let folders: Song[][] = [[]], cap = 100, reads = 0, active = 0, peak = 0;
  let readHook: (() => void | Promise<void>) | undefined;
  let serverHook: ((id: string) => void | Promise<void>) | undefined;
  let pageHook: ((count: number, offset: number, folder: number) => Promise<{ songs: Song[]; sourceCount: number }>) | undefined;
  let serverFailure: Error | undefined;
  const custom = new Map<string, any>(), artwork = new Map<string, any>(), files = new Set<string>(), cached = new Map<string, any[]>(), saved = new Map<string, any>();
  const localLyrics = new Map<string, any[]>(), localSongs = new Map<string, Song>(), serverSongs = new Map<string, Song>(), covers = new Map<string, string>();
  const albumSongs = new Map<string, Song[]>(), playlistSongs = new Map<string, Song[]>();
  let albums: any[] = [], artists: any[] = [], playlists: any[] = [];
  const writes: string[] = [];
  const op = (): models.ScrapeOperation => {
    const auth = state.auth, profile = state.auth?.username ?? 'local', source = 'server';
    return { scope: { profile, source }, current: () => current && state.auth === auth && (state.auth?.username ?? 'local') === profile };
  };
  const dependencies: Record<string, any> = {
    'expo-file-system/legacy': { documentDirectory: 'file:///app/', getInfoAsync: async (uri: string) => { localCalls.push(`stat:${uri}`); return { exists: files.has(uri), size: files.has(uri) ? 42 : 0 }; } },
    '@/api/data': { getCatalogSongPage: async (count: number, offset: number, folder: number) => {
      calls.push({ count, offset, folder }); reads++; await readHook?.();
      return pageHook ? pageHook(count, offset, folder) : { songs: (folders[folder] ?? []).slice(offset, offset + Math.min(count, cap)), sourceCount: folders.length };
    }, getAlbum: async (id: string) => ({ album: { id, name: id }, songs: albumSongs.get(id) ?? [] }),
    getPlaylist: async (id: string) => ({ playlist: { id, name: id }, songs: playlistSongs.get(id) ?? [] }),
    getSong: async (id: string) => localSongs.get(id), coverArtUrl: (id: string) => covers.get(id) ?? (id ? `https://server/getCoverArt?id=${id}` : undefined),
    getAlbumList: async (_: string, count: number, offset: number) => albums.slice(offset, offset + Math.min(count, cap)),
    getArtists: async () => artists, getPlaylists: async () => playlists,
    updatePlaylist: () => { writes.push('playlist'); throw new Error('Forbidden server write'); },
    setRating: () => { writes.push('rating'); throw new Error('Forbidden server write'); } },
    '@/api/backend': { getSong: async (_: unknown, id: string) => {
      serverCalls.push(id); active++; peak = Math.max(peak, active);
      try { await serverHook?.(id); if (serverFailure) throw serverFailure; return serverSongs.get(id) ?? null; } finally { active--; }
    } },
    '@/store/auth': { useAuthStore: { getState: () => state }, profileScopeId: () => state.auth?.username ?? 'local' },
    '@/store/libraries': { useLibraries: { getState: () => libraries } },
    '@/lib/localCustomizations': { captureCustomizationOwner: (scope: any, extra: () => boolean) => {
      const auth = state.auth; return () => state.auth === auth && (state.auth?.username ?? 'local') === scope.profile && extra();
    }, readLocalCustomization: async (_: unknown, kind: string, id: string, current: () => boolean) => { assert.ok(current()); localCalls.push(`${kind}:${id}`); return custom.get(`${kind}:${id}`); } },
    '@/lib/localCustomizationModels': customizationModels, '@/lib/localMetadata': localMetadata,
    '@/lib/localLibrary': { hashKey }, '@/lib/lyricDocuments': lyricDocuments,
    '@/lib/lyricLibraryDb': { cachedLyricCandidates: async (_: string, song: Song) => cached.get(song.id) ?? [] },
    '@/lib/mediaCacheDb': { readSavedLyrics: async (_: string, id: string, source: string) => saved.get(`${id}:${source}`) },
    '@/lib/localLyrics': { getOnDeviceLyricCandidates: async (song: Song) => { localCalls.push(`lyrics:${song.localUri}`); return localLyrics.get(song.id) ?? []; } },
    '@/lib/ownedAudio': { ownedAudioUri: (song: Song) => song.localUri?.startsWith('file:///owned/') ? song.localUri : undefined },
    './repository': { readMetadataRecord: async (_: string, id: string, operation: any) => { assert.ok(operation.current()); return artwork.get(id); } },
    './models': models,
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/metadata/catalog.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, setTimeout, clearTimeout, URL, AbortController, require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return { api: exports as typeof Catalog, op, calls, serverCalls, localCalls, custom, artwork, files, cached, saved, localLyrics, localSongs, serverSongs, covers, albumSongs, playlistSongs, writes,
    setFolders: (value: Song[][], max = 100) => { folders = value; cap = max; }, setReadHook: (hook: typeof readHook) => { readHook = hook; },
    setPageHook: (hook: typeof pageHook) => { pageHook = hook; }, setServerHook: (hook: typeof serverHook) => { serverHook = hook; },
    setState: (patch: any) => { state = { ...state, ...patch }; }, setLibraries: (value: any) => { libraries = value; },
    setLists: (value: { albums?: any[]; artists?: any[]; playlists?: any[] }) => { albums = value.albums ?? albums; artists = value.artists ?? artists; playlists = value.playlists ?? playlists; },
    failServer: (error: Error) => { serverFailure = error; }, cancel: () => { current = false; }, peak: () => peak, reads: () => reads,
  };
}
async function collect(h: ReturnType<typeof harness>, scope: Catalog.BulkMetadataScope, options: Catalog.MetadataCatalogOptions = {}) {
  const operation = h.op(), songs: Song[] = [], unavailable: Catalog.UnavailableMetadataSong[] = []; let cursor: string | undefined, scanned = 0, turns = 0;
  do {
    const page = await h.api.readMetadataCatalogPage(scope, cursor, operation, options);
    assert.ok(page.songs.length <= 100); assert.ok(page.scanned <= 100); assert.equal(page.done, !page.nextCursor);
    songs.push(...page.songs); unavailable.push(...(page.unavailable ?? [])); scanned += page.scanned; cursor = page.nextCursor;
    assert.ok(++turns < 5000, 'must terminate');
  } while (cursor);
  return { songs, scanned, turns, unavailable };
}
test('all-library paging visits >1000 songs across independently capped folders, continuing short pages to empty', async () => {
  const h = harness(), first = Array.from({ length: 1151 }, (_, i) => song(`A${i}`)), second = Array.from({ length: 487 }, (_, i) => song(`B${i}`));
  h.setFolders([first, second], 37);
  const result = await collect(h, { kind: 'all' });
  assert.equal(result.songs.length, 1638); assert.equal(result.scanned, 1638);
  assert.deepEqual(result.songs.map((song) => song.id), [...first, ...second].map((song) => song.id));
  assert.ok(h.calls.some((call) => call.folder === 0 && call.offset === 1151));
  assert.ok(h.calls.some((call) => call.folder === 1 && call.offset === 487));
  assert.equal(h.serverCalls.length, 0); assert.deepEqual(h.writes, []);
});
test('album and playlist catalogs page beyond1000 without dropping tracks', async () => {
  const h = harness(), songs = Array.from({ length: 1321 }, (_, i) => song(`collection-${i}`));
  h.albumSongs.set('album', songs); h.playlistSongs.set('playlist', songs);
  for (const scope of [{ kind: 'album', id: 'album' }, { kind: 'playlist', id: 'playlist' }] as const) {
    const result = await collect(h, scope); assert.equal(result.songs.length, 1321); assert.equal(result.scanned, 1321);
  }
  assert.deepEqual(h.writes, []);
});
test('selected online IDs use actual server reads in groups of four, preserving >1000 selection', async () => {
  const h = harness(), ids = Array.from({ length: 1103 }, (_, i) => `selected-${i}`);
  for (const id of ids) { h.serverSongs.set(id, song(id)); h.localSongs.set(id, song(id, { title: 'stale cache' })); }
  h.setServerHook(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  const result = await collect(h, { kind: 'selected', songIds: ids });
  assert.deepEqual(result.songs.map((song) => song.id), ids); assert.equal(result.scanned, 1103);
  assert.equal(h.calls.length, 0); assert.equal(h.peak(), 4); assert.ok(result.songs.every((song) => song.title !== 'stale cache'));
});
test('selected deleted IDs stay explicit review records while later pages continue; transport failures reject', async () => {
  const h = harness(), ids = Array.from({ length: 1103 }, (_, i) => `selected-${i}`), deleted = new Set(['selected-3', 'selected-800', 'selected-1102']);
  for (const id of ids) if (!deleted.has(id)) h.serverSongs.set(id, song(id));
  const result = await collect(h, { kind: 'selected', songIds: ids });
  assert.deepEqual(result.songs.map((song) => song.id), ids.filter((id) => !deleted.has(id)));
  assert.deepEqual(result.unavailable.map((entry) => entry.id), [...deleted]);
  assert.ok(result.unavailable.every((entry) => entry.issue === 'Metadata recording changed. Review again.'));
  assert.equal(result.scanned, ids.length); assert.equal(result.songs.length + result.unavailable.length, ids.length);
  h.failServer(new Error('auth expired'));
  await assert.rejects(h.api.resolveMetadataCatalogSong(ids[0], h.op()), /auth expired/);
  await assert.rejects(h.api.readMetadataCatalogPage({ kind: 'selected', songIds: ids.slice(0, 10) }, undefined, h.op()), /auth expired/);
});
test('a malformed container scope cannot accidentally turn an artist selection into the entire library', async () => {
  const h = harness(); h.setFolders([[song('one')]]);
  await assert.rejects(h.api.readMetadataCatalogPage({ kind: 'artist' } as Catalog.BulkMetadataScope, undefined, h.op()), /Invalid metadata container/);
  assert.equal(h.calls.length, 0);
});
test('offline selected enumeration scans once, returns empty intermediate pages, then finds uncached IDs', async () => {
  const h = harness(); h.setState({ offline: true });
  const songs = Array.from({ length: 1101 }, (_, i) => song(`J${i}`)); h.setFolders([songs]);
  const result = await collect(h, { kind: 'selected', songIds: ['J1005', 'J1099'] });
  assert.deepEqual(result.songs.map((song) => song.id), ['J1005', 'J1099']); assert.equal(result.scanned, 1101);
  assert.equal(h.serverCalls.length, 0); assert.equal(h.calls.length, 13);
});
test('artist enumeration includes primary, album, guest and contributor IDs over every source; no name guessing', async () => {
  const h = harness();
  h.setFolders([[song('lead', { artistId: 'A' }), song('wrong', { artist: 'A', artistId: 'other' }), song('guest', { artists: [{ id: 'A', name: 'artist' }] })],
    [song('album-artist', { albumArtists: [{ id: 'A', name: 'artist' }] }), song('contributor', { contributors: [{ role: 'performer', artist: { id: 'A', name: 'artist' } }] })]]);
  const result = await collect(h, { kind: 'artist', id: 'A' });
  assert.deepEqual(result.songs.map((song) => song.id), ['lead', 'guest', 'album-artist', 'contributor']);
});
test('missing fields use durable effective corrections rather than raw tags, and search displays the same local names', async () => {
  const h = harness(), raw = song('one', { title: '', artist: '', album: '', year: 0 });
  h.custom.set('song-metadata:one', { version: 1, patch: { title: 'Local name', artist: 'Local artist', album: 'Local album', year: 2025, genres: [{ name: 'Ambient' }], albumArtist: 'Local album artist' }, original: {} });
  assert.deepEqual(Array.from(await h.api.metadataMissingFields(raw, ['title', 'artist', 'album', 'year', 'genres', 'albumArtist', 'track'], h.op())), ['track']);
  assert.equal(raw.title, '');
  h.setFolders([[raw]]);
  assert.equal((await collect(h, { kind: 'missing' }, { fields: ['title', 'artist'], search: 'Local name' })).songs.length, 0);
  const displayed = (await collect(h, { kind: 'all' }, { search: 'Local name' })).songs[0];
  assert.equal(displayed.title, 'Local name'); assert.equal(localMetadata.sourceSong(displayed).title, '');
});
test('cover presence protects real local artwork and advertised IDs; album ID synthetic URL is not evidence', async () => {
  const h = harness(), operation = h.op(), raw = song('one', { albumId: 'album' });
  assert.deepEqual(Array.from(await h.api.metadataMissingFields(raw, ['cover'], operation)), ['cover']);
  const uri = `file:///app/metadata-artwork/${hashKey('A')}/${hashKey('server')}/album-test.jpg`;
  h.artwork.set('album:album', { uri, bytes: 42, mime: 'image/jpeg', updatedAt: 1 });
  assert.equal(await h.api.isMetadataSongMissing(raw, ['cover'], operation), true, 'deleted custom file is still missing');
  h.files.add(uri); assert.equal(await h.api.isMetadataSongMissing(raw, ['cover'], operation), false);
  h.files.delete(uri); h.covers.set('album', 'file:///owned/cached-album.jpg'); h.files.add('file:///owned/cached-album.jpg');
  assert.equal(await h.api.isMetadataSongMissing(raw, ['cover'], operation), false);
  assert.equal(await h.api.isMetadataSongMissing(song('two', { coverArt: 'actual-cover-id' }), ['cover'], operation), false);
  assert.equal(await h.api.isMetadataSongMissing(song('three', { coverBase64: 'abc' }), ['cover'], operation), false);
  h.artwork.set('song:foreign', { uri: 'file:///app/metadata-artwork/another-user/another-source/private.jpg' });
  assert.equal(await h.api.isMetadataSongMissing(song('foreign'), ['cover'], operation), true);
  assert.ok(!h.localCalls.some((call) => call.includes('another-user')));
  assert.equal(h.serverCalls.length, 0); assert.equal(h.calls.length, 0);
});
test('lyrics completeness includes recording-bound edits, cached documents, saved lyrics and owned local embedded files without network', async () => {
  const h = harness(), operation = h.op();
  const edited = song('edit');
  h.custom.set('lyric-edit:edit', { version: 1, recording: lyricDocuments.lyricRecordingKey(edited), base: lyrics, lyrics, updatedAt: 1 });
  h.cached.set('candidate', [{ lyrics }]); h.saved.set('saved:online', lyrics); h.localLyrics.set('local', [{ lyrics }]);
  for (const entry of [edited, song('candidate'), song('saved'), song('local', { localUri: 'file:///owned/local.flac' })]) {
    assert.equal(await h.api.isMetadataSongMissing(entry, ['lyrics'], operation), false, entry.id);
  }
  assert.equal(await h.api.isMetadataSongMissing(song('edit', { title: 'Different recording' }), ['lyrics'], operation), true);
  assert.equal(await h.api.isMetadataSongMissing(song('local', { localUri: 'file:///foreign/local.flac' }), ['lyrics'], operation), true);
  assert.equal(h.serverCalls.length, 0); assert.equal(h.calls.length, 0); assert.deepEqual(h.writes, []);
});
test('missing field recheck observes resources saved after enumeration; no stale presence cache', async () => {
  const h = harness(), raw = song('later'), operation = h.op();
  assert.equal(await h.api.isMetadataSongMissing(raw, ['lyrics'], operation), true);
  h.cached.set(raw.id, [{ lyrics }]);
  assert.equal(await h.api.isMetadataSongMissing(raw, ['lyrics'], operation), false);
  h.cached.clear(); assert.equal(await h.api.isMetadataSongMissing(raw, ['lyrics'], operation), true);
});
test('owner, folder-filter and abort changes during asynchronous catalog read reject the result', async () => {
  for (const change of ['account', 'folders', 'cancel', 'signal'] as const) {
    const h = harness(); h.setFolders([[song('one')]]); const operation = h.op(), controller = new AbortController(); operation.signal = controller.signal;
    h.setReadHook(() => {
      if (change === 'account') h.setState({ auth: { username: 'B', serverType: 'navidrome' } });
      if (change === 'folders') h.setLibraries({ disabled: { A: ['one'] }, folders: {} });
      if (change === 'cancel') h.cancel();
      if (change === 'signal') controller.abort();
    });
    await assert.rejects(h.api.readMetadataCatalogPage({ kind: 'all' }, undefined, operation), /cancelled/);
  }
});
test('durable cursors reject a different query, scope, selected set, profile or source folders', async () => {
  const h = harness(); h.setFolders([[song('one')]]);
  const first = await h.api.readMetadataCatalogPage({ kind: 'all' }, undefined, h.op()); assert.ok(first.nextCursor);
  await assert.rejects(h.api.readMetadataCatalogPage({ kind: 'all' }, first.nextCursor, h.op(), { search: 'other' }), /changed/);
  await assert.rejects(h.api.readMetadataCatalogPage({ kind: 'missing' }, first.nextCursor, h.op()), /changed/);
  h.setLibraries({ disabled: { A: ['different'] }, folders: {} });
  await assert.rejects(h.api.readMetadataCatalogPage({ kind: 'all' }, first.nextCursor, h.op()), /changed/);
  h.setState({ auth: { username: 'B', serverType: 'navidrome' } });
  await assert.rejects(h.api.readMetadataCatalogPage({ kind: 'all' }, first.nextCursor, h.op()), /changed/);
});
test('server repeated pages and changing folder counts fail explicitly, never report a capped successful catalog', async () => {
  const h = harness(); h.setPageHook(async () => ({ songs: [song('repeated')], sourceCount: 1 }));
  const operation = h.op(), first = await h.api.readMetadataCatalogPage({ kind: 'all' }, undefined, operation);
  await assert.rejects(h.api.readMetadataCatalogPage({ kind: 'all' }, first.nextCursor, operation), /repeated/);
  h.setPageHook(async () => ({ songs: [song('other')], sourceCount: 2 }));
  await assert.rejects(h.api.readMetadataCatalogPage({ kind: 'all' }, first.nextCursor, operation), /sources changed/);
});
test('resolver reads uncached Subsonic/Jellyfin songs and falls back to offline later pages; deleted IDs alone return undefined', async () => {
  const h = harness(); h.serverSongs.set('raw', song('raw', { title: 'actual' })); h.localSongs.set('raw', song('raw', { title: 'old' }));
  assert.equal((await h.api.resolveMetadataCatalogSong('raw', h.op()))?.title, 'actual');
  assert.equal(await h.api.resolveMetadataCatalogSong('deleted', h.op()), undefined);
  h.setState({ auth: { username: 'A', serverType: 'jellyfin' } }); h.serverSongs.set('jellyfin', song('jellyfin'));
  assert.equal((await h.api.resolveMetadataCatalogSong('jellyfin', h.op()))?.id, 'jellyfin');
  const selected = await h.api.readMetadataCatalogPage({ kind: 'selected', songIds: ['jellyfin'] }, undefined, h.op());
  assert.equal(selected.songs[0].id, 'jellyfin'); assert.equal(selected.done, true); assert.equal(h.calls.length, 0);
  h.setState({ offline: true }); h.setFolders([Array.from({ length: 1101 }, (_, i) => song(`J${i}`))]);
  assert.equal((await h.api.resolveMetadataCatalogSong('J1100', h.op()))?.id, 'J1100');
  assert.equal(h.calls.at(-1)?.offset, 1100);
});
test('container picker pages raw rows, keeps filtered empty next pages and never fetches their song arrays', async () => {
  const h = harness();
  h.setLists({ albums: Array.from({ length: 1101 }, (_, i) => ({ id: `al${i}`, name: `Album${i}` })),
    artists: Array.from({ length: 1101 }, (_, i) => ({ id: `ar${i}`, name: `Artist${i}` })), playlists: [{ id: 'pl', name: 'Playlist' }] });
  for (const kind of ['album', 'artist'] as const) {
    let offset: number | undefined = 0, count = 0;
    do { const result = await h.api.listMetadataContainers(kind, '', offset, h.op()); count += result.items.length; offset = result.nextOffset; } while (offset !== undefined);
    assert.equal(count, 1101);
  }
  const filtered = await h.api.listMetadataContainers('album', 'no match', 0, h.op());
  assert.equal(filtered.items.length, 0); assert.equal(filtered.nextOffset, 100);
  assert.deepEqual(Array.from((await h.api.listMetadataContainers('playlist', '', 0, h.op())).items, (item) => item.id), ['pl']);
  assert.equal(h.serverCalls.length, 0); assert.equal(h.calls.length, 0); assert.deepEqual(h.writes, []);
});
