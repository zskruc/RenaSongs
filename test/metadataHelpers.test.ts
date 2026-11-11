import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Song } from '../src/api/subsonic';
import { validateScraperProfile, safeScraperProfile, scraperImportSummary, jsonMetadataPath, expandMetadataTemplate } from '../src/lib/metadata/config';
import { rankMetadataCandidate, recordingIdentity, matchReleaseTracks } from '../src/lib/metadata/matching';
import { createMetadataJob, runMetadataJob } from '../src/lib/metadata/jobs';
import { MetadataCancelled, type ScrapeCandidate } from '../src/lib/metadata/models';

const song: Song = { id: 'song', title: 'A song', artist: 'Artist', album: 'Release', duration: 200, track: 1, discNumber: 1 };
const candidate = (changes: Partial<ScrapeCandidate> = {}): ScrapeCandidate => ({ id: 'provider:1', provider: 'itunes', externalId: '1',
  fields: { title: song.title, artist: song.artist, album: song.album }, duration: 200, ...changes });
const profile = () => ({ version: 1, id: 'custom', name: 'Custom source', capabilities: ['metadata', 'cover', 'lyrics'],
  search: { url: 'https://example.test/search?query={{query}}', method: 'GET', items: 'data.items', fields: { id: 'key', title: 'name' } },
  detail: { url: 'https://example.test/item/{{id}}', script: 'return {id:externalId,title:response.title};' }, headers: { Authorization: 'Bearer private', 'X-Api-Key': 'private-key', Accept: 'application/json' } });

test('recording matching rejects same-title covers, different versions, editions and incompatible durations', () => {
  assert.equal(rankMetadataCandidate(song, candidate()).confident, true);
  assert.equal(rankMetadataCandidate(song, candidate({ fields: { title: song.title, artist: 'Other artist' } })).confident, false);
  assert.equal(rankMetadataCandidate(song, candidate({ fields: { title: `${song.title} (Live)`, artist: song.artist } })).confident, false);
  assert.equal(rankMetadataCandidate(song, candidate({ fields: { title: song.title, artist: song.artist, album: 'Other edition' } })).confident, false);
  assert.equal(rankMetadataCandidate(song, candidate({ duration: 245 })).confident, false);
  assert.equal(rankMetadataCandidate({ ...song, artist: undefined }, candidate({ duration: 201 })).confident, true);
  assert.equal(rankMetadataCandidate({ ...song, artist: undefined, duration: undefined }, candidate()).confident, false);
  for (let index = 0; index < 5; index++) assert.deepEqual(recordingIdentity('01. A song (Live)'), recordingIdentity('A song - Live'));
});
test('release matching respects disc/track and never assigns one release track twice', () => {
  const other = { ...song, id: 'other', discNumber: 2 };
  const one = candidate({ fields: { title: song.title, artist: song.artist, track: 1, discNumber: 1 } });
  const two = candidate({ id: 'provider:2', externalId: '2', fields: { title: song.title, artist: song.artist, track: 1, discNumber: 2 } });
  assert.equal(matchReleaseTracks([song, other], [one, two]).get('other')?.id, two.id);
  assert.equal(matchReleaseTracks([song, { ...song, id: 'duplicate' }], [one]).size, 0);
  assert.equal(matchReleaseTracks([{ ...song, title: 'Track 01' }], [one]).get(song.id)?.id, one.id);
  assert.equal(matchReleaseTracks([song], [candidate({ duration: 230 })]).size, 0);
});
test('custom configs preserve isolated scripts and safe mapping but never export private headers', () => {
  const value = validateScraperProfile(profile()), safe = safeScraperProfile(value);
  assert.match(value.detail!.script!, /response.title/);
  assert.equal(value.search!.headers!.Authorization, 'Bearer private');
  assert.equal(safe.search!.headers!.Authorization, undefined);
  assert.equal(safe.search!.headers!['X-Api-Key'], undefined);
  assert.equal(safe.search!.headers!.Accept, 'application/json');
  assert.deepEqual(scraperImportSummary(value), { domains: ['example.test'], methods: ['GET'], schemes: ['HTTPS'], sensitiveHeaders: true });
  assert.equal(jsonMetadataPath({ data: { items: [{ title: 'A' }] } }, '$.data.items[0].title'), 'A');
  assert.equal(jsonMetadataPath({}, '__proto__.constructor'), undefined);
  assert.equal(jsonMetadataPath({ title: 'A' }, 'toString'), undefined);
  assert.equal(expandMetadataTemplate('https://x.test?q={{title}}', { title: 'A+B & 世界' }), 'https://x.test?q=A%2BB%20%26%20%E4%B8%96%E7%95%8C');
  for (const location of ['https://name:password@example.test/search', 'file:///private/music']) {
    assert.throws(() => validateScraperProfile({ ...profile(), search: { url: location } }));
  }
  assert.deepEqual(scraperImportSummary(validateScraperProfile({ ...profile(), search: { url: 'http://192.168.1.2:3000/lyrics' }, detail: undefined })).schemes, ['HTTP']);
  assert.throws(() => validateScraperProfile({ ...profile(), search: { url: 'https://x.test?api_key=private' } }), /local secrets/);
  assert.throws(() => validateScraperProfile({ ...profile(), search: { url: 'https://x.test', params: { token: 'private' } } }), /local secrets/);
  assert.doesNotThrow(() => validateScraperProfile({ ...profile(), search: { url: 'https://x.test?api_key={{key}}' } }));
});
test('release-only tasks leave unmatched songs for review without searching other releases', async () => {
  const target = [song, { ...song, id: 'unmatched', title: 'Unmatched' }];
  const job = createMetadataJob(target, 'Release', ['title'], false, new Map([[song.id, candidate()]]));
  let searches = 0, applied = 0; const saved: unknown[] = [];
  const result = await runMetadataJob(job, { scope: { profile: 'A', source: 'server' }, current: () => true }, {
    save: async (value) => { saved.push(JSON.parse(JSON.stringify(value))); }, find: async () => { searches++; return candidate(); }, apply: async () => { applied++; }, publish() {},
  });
  assert.equal(searches, 0); assert.equal(applied, 1); assert.equal(result.items[1].status, 'review'); assert.equal(result.status, 'completed');
  assert.ok(saved.length >= 3);
});
test('cancel after persisted candidate does not start the next song; retry uses the same durable intent', async () => {
  const job = createMetadataJob([song, { ...song, id: 'two' }], 'Batch', ['title'], false);
  let current = true, applied = 0, last = job; const intents = new Set<string>();
  await assert.rejects(runMetadataJob(job, { scope: { profile: 'A', source: 'server' }, current: () => current }, {
    save: async (value) => { last = structuredClone(value); }, find: async () => candidate(), publish() {},
    apply: async (item) => { if (!intents.has(item.intentId)) { intents.add(item.intentId); applied++; } current = false; },
  }));
  assert.equal(applied, 1); assert.equal(last.items[0].candidate?.id, candidate().id); assert.equal(last.items[1].status, 'pending');
  current = true;
  const result = await runMetadataJob(last, { scope: { profile: 'A', source: 'server' }, current: () => current }, {
    save: async () => {}, find: async () => candidate(), publish() {}, apply: async (item) => { if (!intents.has(item.intentId)) { intents.add(item.intentId); applied++; } },
  });
  assert.equal(applied, 2); assert.equal(result.items.every((item) => item.status === 'done'), true);
  await assert.rejects(runMetadataJob(job, { scope: { profile: 'A', source: 'server' }, current: () => false }, { save: async () => assert.fail(), find: async () => candidate(), apply: async () => {}, publish() {} }), MetadataCancelled);
});
