import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as models from '../src/lib/metadata/models';
import * as matching from '../src/lib/metadata/matching';
import * as config from '../src/lib/metadata/config';
import { parseLrc } from '../src/lib/lrc';
import { parseTtml } from '../src/lib/ttml';
import { validLyricDocument } from '../src/lib/lyricDocuments';
import { parseRelativeMetadataLyrics } from '../src/lib/metadata/relativeLyrics';
import * as imageHeader from '../src/lib/metadata/imageHeader';

function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, Math, setTimeout, clearTimeout, URL, URLSearchParams, TextDecoder, Uint8Array, AbortController, atob,
      require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } }); return exports;
}
const operation = () => ({ scope: { profile: 'A', source: 'server' }, current: () => true });
test('metadata transport hard deadline settles even if fetch or response body ignores abort', async () => {
  for (const phase of ['headers', 'body'] as const) {
    let aborted = false;
    const request = load('../src/lib/metadata/request.ts', { 'expo/fetch': { fetch: async (_: string, options: any) => {
      options.signal.addEventListener('abort', () => { aborted = true; });
      if (phase === 'headers') return new Promise(() => {});
      return { ok: true, status: 200, headers: { get: () => null }, text: () => new Promise(() => {}) };
    } }, '@/api/netGate': { isManualOffline: () => false }, './models': models });
    const start = Date.now(); await assert.rejects(request.readMetadataResponse('https://metadata.test', operation(), { timeoutMs: 15 }), /network/);
    assert.ok(Date.now() - start < 500); assert.equal(aborted, true);
  }
});
test('metadata transport handles caller cancel, manual offline and bounded chunks without forwarding account headers', async () => {
  let calls = 0, cancelled = 0, offline = false, actualHeaders: Record<string, string> = {};
  const request = load('../src/lib/metadata/request.ts', { 'expo/fetch': { fetch: async (_: string, options: any) => {
    calls++; actualHeaders = options.headers;
    return { ok: true, status: 200, headers: { get: () => null }, body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(10) }), cancel: async () => { cancelled++; } }) } };
  } }, '@/api/netGate': { isManualOffline: () => offline }, './models': models });
  await assert.rejects(request.readMetadataResponse('https://metadata.test', operation(), { maxBytes: 15 }), /invalid-response/);
  assert.ok(cancelled); assert.equal(actualHeaders.Authorization, undefined); assert.equal(actualHeaders.Cookie, undefined);
  offline = true; await assert.rejects(request.readMetadataResponse('https://metadata.test', operation())); assert.equal(calls, 1);
  offline = false; const controller = new AbortController(); controller.abort();
  await assert.rejects(request.readMetadataResponse('https://metadata.test', { ...operation(), signal: controller.signal }), models.MetadataCancelled); assert.equal(calls, 1);
});
test('actual provider normalization uses high-resolution artwork and release tracks keep real disc and recording IDs', async () => {
  const requests: string[] = [];
  const itunesSong = { trackId: 11, trackName: 'Song', artistName: 'Artist', collectionName: 'Album', trackNumber: 2, discNumber: 1, trackTimeMillis: 123456, primaryGenreName: 'Pop', artworkUrl100: 'https://img.test/100x100bb.jpg' };
  const provider = load('../src/lib/metadata/providers.ts', {
    '@/lib/lrc': { parseLrc }, '@/lib/ttml': { parseTtml }, '@/lib/lyricDocuments': { validLyricDocument }, './models': models, './matching': matching,
    './config': config, './customProvider': { searchCustomMetadata: async () => [], detailCustomMetadata: async (_: unknown, candidate: unknown) => candidate },
    './request': { metadataJson: async (_key: string, location: string) => { requests.push(location); return { results: [itunesSong] }; }, metadataRequest: async () => '', MetadataRequestError: Error },
  });
  const candidate = provider.itunesMetadata(itunesSong, 'US'); assert.equal(candidate.duration, 123.456); assert.equal(candidate.coverUrl, 'https://img.test/1200x1200bb.jpg'); assert.equal(candidate.externalId, 'US:11');
  const tracks = await provider.metadataReleaseTracks({ provider: 'itunes', externalId: 'TW:99' }, operation());
  assert.equal(tracks[0].fields.track, 2); assert.equal(tracks[0].fields.discNumber, 1); assert.equal(tracks[0].externalId, 'TW:11');
  assert.match(requests[0], /country=TW/); assert.match(requests[0], /id=99/);
  const mb = provider.musicBrainzMetadata({ id: '12345678-1234-1234-1234-123456789012', title: 'Song', length: 200000, 'artist-credit': [{ name: 'Artist' }],
    releases: [{ id: 'abcdefgh-1234-1234-1234-123456789012', title: 'Album', date: '2020-01-01' }] });
  assert.equal(mb.fields.year, 2020); assert.equal(mb.duration, 200); assert.equal(mb.fields.artist, 'Artist');
});
test('custom endpoint scripts are passed to isolated parser and templates escape URL query without exposing secrets in public profiles', async () => {
  const calls: any[] = [], scripts: any[] = [];
  const custom = load('../src/lib/metadata/customProvider.ts', { '@/lib/metadataScript': { runMetadataScript: async (...args: any[]) => { scripts.push(args); return [{ id: '42', title: 'A+B', durationMs: 120000, genres: ['Pop'] }]; } },
    '@/lib/lrc': { parseLrc }, '@/lib/ttml': { parseTtml }, '@/lib/lyricDocuments': { validLyricDocument },
    './repository': { scraperCredentials: async () => ({ secrets: { token: 'private' }, headers: { search: { Authorization: 'Bearer private' } } }) },
    './config': config, './models': models, './relativeLyrics': { parseRelativeMetadataLyrics }, './request': { metadataRequest: async (...args: any[]) => { calls.push(args); return '{"items":[]}'; } } });
  const profile = config.validateScraperProfile({ version: 1, id: 'custom', name: 'Custom', capabilities: ['metadata'], search: { url: 'https://example.test/search', params: { q: '{{title}}' }, script: 'return response.items;' } });
  const result = await custom.searchCustomMetadata(profile, { title: 'A+B', artist: 'Artist' }, operation());
  assert.equal(result[0].externalId, '42'); assert.equal(result[0].duration, 120); assert.match(calls[0][1], /q=A%2BB/);
  assert.equal(calls[0][3].headers.Authorization, 'Bearer private'); assert.equal(scripts[0][2].secrets.token, 'private');
  assert.equal(profile.search!.headers!.Authorization, undefined);
});
test('local animated artwork keeps original GIF bytes, is owner-fenced and rejects oversized image dimensions before display', async () => {
  const files = new Map<string, Uint8Array>(); const gif = Uint8Array.from([71, 73, 70, 56, 57, 97, 100, 0, 100, 0, 1, 2, 3]); files.set('file:///picked.gif', gif);
  const saved: any[] = []; let current = true;
  const api = load('../src/lib/metadata/artwork.ts', { 'expo-file-system/legacy': { documentDirectory: 'file:///app/', EncodingType: { Base64: 'base64' },
    getInfoAsync: async (uri: string) => ({ exists: files.has(uri), size: files.get(uri)?.length, isDirectory: false }),
    readAsStringAsync: async (uri: string) => Buffer.from(files.get(uri)!).toString('base64'), makeDirectoryAsync: async () => {},
    copyAsync: async ({ from, to }: { from: string; to: string }) => { files.set(to, files.get(from)!.slice()); }, deleteAsync: async (uri: string) => { files.delete(uri); } },
    '@/lib/localLibrary': { hashKey: () => 'hash' }, '@/api/netGate': { isManualOffline: () => false }, './models': models,
    './repository': { readMetadataRecord: async () => undefined, saveMetadataRecord: async (...args: any[]) => { models.metadataCheck(args[3]); saved.push(args); } }, './imageHeader': imageHeader });
  const value = await api.savePickedMetadataArtwork('file:///picked.gif', 'artist', 'artist', { ...operation(), current: () => current });
  assert.match(value.uri, /\.gif$/); assert.deepEqual(files.get(value.uri), gif); assert.equal(value.mime, 'image/gif'); assert.equal(saved.length, 1);
  current = false; await assert.rejects(api.savePickedMetadataArtwork('file:///picked.gif', 'artist', 'artist', { ...operation(), current: () => current })); assert.equal(saved.length, 1);
  const png = new Uint8Array(24); png.set([137, 80, 78, 71]); new DataView(png.buffer).setUint32(16, 10000); new DataView(png.buffer).setUint32(20, 10000);
  files.set('file:///oversized.png', png); current = true; await assert.rejects(api.savePickedMetadataArtwork('file:///oversized.png', 'album', 'album', operation()), /oversized/);
});
