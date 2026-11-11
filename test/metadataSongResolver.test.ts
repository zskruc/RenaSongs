import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as gate from '../src/api/netGate';
import { untilAborted } from '../src/api/deadline';

function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, Math, setTimeout, clearTimeout, URL, URLSearchParams, AbortController,
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), `${path}: ${name}`); return dependencies[name]; } });
  return exports;
}
class RequestError extends Error {
  network: boolean; code?: number;
  constructor(message: string, network: boolean, code?: number) { super(message); this.network = network; this.code = code; }
}
const auth = { serverType: 'jellyfin', serverUrl: 'https://jellyfin.test', username: 'User', jfUserId: 'user-id', jfToken: 'private-token', jfDeviceId: 'device-id' };
const item = { Id: 'audio-id', Type: 'Audio', Name: 'Resolved recording', Album: 'Exact album', AlbumId: 'album-id',
  AlbumArtist: 'Album artist', Artists: ['Singer A', 'Singer B'], ArtistItems: [{ Id: 'artist-id', Name: 'Singer A' }],
  RunTimeTicks: 123_0000000, IndexNumber: 4, ParentIndexNumber: 2, ProductionYear: 2024, Genres: ['Pop', 'Folk'],
  AlbumPrimaryImageTag: 'cover-tag', NormalizationGain: -4.5, UserData: { IsFavorite: true }, DateCreated: '2024-01-01T00:00:00Z',
  MediaSources: [{ Container: 'flac', Bitrate: 950_000, MediaStreams: [{ Type: 'Audio', BitDepth: 24, SampleRate: 96000 }] }] };
function harness() {
  const calls: { url: string; options: any }[] = [];
  let response: unknown = item, status = 200, failure: Error | undefined;
  const client = load('../src/api/jellyfin.ts', {
    'expo-constants': { __esModule: true, default: { expoConfig: { version: 'test' }, deviceName: 'Test phone' } }, 'expo-crypto': {},
    '@/i18n': { tg: (key: string) => key }, '@/lib/lyricWords': {},
    './subsonic': { SubsonicRequestError: RequestError, CLIENT_NAME: 'Resonus Test', COVER: {} },
    './deadline': { untilAborted }, './netGate': gate, '@/lib/perfLog': { netTally() {} },
    'expo/fetch': { fetch: async (url: string, options: any) => {
      calls.push({ url, options }); if (failure) throw failure;
      return { ok: status >= 200 && status < 300, status, text: async () => response === undefined ? '' : JSON.stringify(response) };
    } },
  });
  return { client, calls, response: (value: unknown, code = 200) => { response = value; status = code; }, fail: (error: Error) => { failure = error; } };
}

test('Jellyfin single-song resolution makes one authenticated item GET, requests media fields and keeps recording details', async () => {
  gate.setOfflineMode(false); const h = harness();
  const result = await h.client.getSong(auth, 'audio-id');
  assert.equal(h.calls.length, 1); const url = new URL(h.calls[0].url);
  assert.equal(url.pathname, '/Users/user-id/Items/audio-id'); assert.equal(h.calls[0].options.method, 'GET');
  assert.equal(url.searchParams.get('Fields'), 'MediaSources,DateCreated,NormalizationGain,Genres');
  assert.equal(url.searchParams.has('Recursive'), false); assert.equal(url.searchParams.has('StartIndex'), false);
  assert.match(h.calls[0].options.headers.Authorization, /Token="private-token"/);
  assert.equal(result.id, 'audio-id'); assert.equal(result.title, 'Resolved recording'); assert.equal(result.albumId, 'album-id');
  assert.equal(result.artist, 'Singer A, Singer B'); assert.equal(result.artistId, 'artist-id');
  assert.equal(result.duration, 123); assert.equal(result.track, 4); assert.equal(result.discNumber, 2); assert.equal(result.year, 2024);
  assert.equal(result.coverArt, 'album-id'); assert.equal(result.suffix, 'flac'); assert.equal(result.bitRate, 950);
  assert.equal(result.bitDepth, 24); assert.equal(result.samplingRate, 96000); assert.equal(result.replayGain.trackGain, -4.5);
  assert.deepEqual(JSON.parse(JSON.stringify(result.genres)), [{ name: 'Pop' }, { name: 'Folk' }]);
});

test('only a real HTTP404 is a missing song; authentication, forbidden, transient and malformed responses remain failures', async () => {
  gate.setOfflineMode(false);
  const missing = harness(); missing.response({}, 404); assert.equal(await missing.client.getSong(auth, 'audio-id'), null); assert.equal(missing.calls.length, 1);
  for (const status of [401, 403, 429, 500, 503]) {
    const h = harness(); h.response({}, status);
    await assert.rejects(h.client.getSong(auth, 'audio-id'), (error: any) => error instanceof RequestError && error.network === false && (status === 401 ? /Session expired/.test(error.message) : error.code === status));
    assert.equal(h.calls.length, 1);
  }
  for (const malformed of [{ ...item, Id: 'different-recording' }, { ...item, Type: 'MusicAlbum' }, { ...item, Type: 'Video' }, { ...item, Type: undefined }, null, undefined]) {
    const h = harness(); h.response(malformed);
    await assert.rejects(h.client.getSong(auth, 'audio-id'), /Unexpected server response/); assert.equal(h.calls.length, 1);
  }
  const transport = harness(); transport.fail(new Error('DNS failed'));
  await assert.rejects(transport.client.getSong(auth, 'audio-id'), (error: any) => error instanceof RequestError && error.network === true);
  assert.equal(transport.calls.length, 1);
});

test('single-song requests reuse the closed-at-launch/manual and automatic offline gate before opening a socket', async () => {
  for (const automatic of [false, true]) {
    const h = harness(); gate.setOfflineMode(true, automatic);
    await assert.rejects(h.client.getSong(auth, 'audio-id'), gate.OfflineError); assert.equal(h.calls.length, 0);
  }
  gate.setOfflineMode(false); const h = harness(); await h.client.getSong(auth, 'audio-id'); assert.equal(h.calls.length, 1);
});

test('the backend dispatcher uses the direct recording resolver for Jellyfin and preserves Subsonic getSong', async () => {
  gate.setOfflineMode(false); const h = harness(), subsonicCalls: unknown[][] = [];
  const backend = load('../src/api/backend.ts', { './jellyfin': h.client,
    './subsonic': { getSong: async (...args: unknown[]) => { subsonicCalls.push(args); return { id: 'subsonic-song' }; } } });
  assert.equal((await backend.getSong(auth, 'audio-id')).id, 'audio-id'); assert.equal(h.calls.length, 1); assert.equal(subsonicCalls.length, 0);
  const other = { serverType: 'navidrome' }; assert.equal((await backend.getSong(other, 'subsonic-song')).id, 'subsonic-song');
  assert.equal(subsonicCalls.length, 1); assert.equal(subsonicCalls[0][0], other); assert.equal(subsonicCalls[0][1], 'subsonic-song');
});
