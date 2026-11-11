import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import * as resumeRules from '../src/lib/episodeResume';
function load(path: string, imports: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (key: string) => { assert.ok(Object.hasOwn(imports, key), key); return imports[key]; } }); return exports;
}
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
function harness() {
  const a = { username: 'A' }, b = { username: 'B' }, auth = createStore<any>(() => ({ auth: a, offline: false, autoOffline: false, offlineSource: null }));
  const authModule = { useAuthStore: auth, profileScopeId: () => auth.getState().auth.username }, owner = load('lib/lyricOwner.ts', { '@/store/auth': authModule });
  const episodes = Array.from({ length: 45 }, (_, index) => ({ id: `show/guid|${index}`, channelId: 'show', title: `Episode ${index}`, url: `https://publisher.test/${index}.mp3`, duration: 120 }));
  let channels = [{ id: 'show', title: 'Show', imageUrl: 'https://publisher.test/art', showType: 'episodic' }], pageReads = 0, shelfReads = 0, hold: (() => Promise<void>) | undefined;
  const calls: any[] = [], state = { queue: [] as any[], index: 0, playQueue: async (songs: any[], index: number, ...extra: unknown[]) => { calls.push({ kind: 'play', songs, index, extra }); state.queue = songs; state.index = index; }, seekTo: (value: number) => calls.push({ kind: 'seek', value }) };
  const library = load('lib/podcastLibrary.ts', { './episodeResume': resumeRules, './localLibrary': {}, './lyricOwner': owner, './podcastDb': {}, '@/store/auth': authModule });
  const api = load('lib/carPodcastTree.ts', { '@/api/podcasts': { listAddedChannels: async () => channels, podcastCover: (ch: any) => ch.imageUrl,
    episodeToSong: (ep: any, ch: any) => ({ id: ep.id, title: ep.title, url: ep.url, vod: true, duration: ep.duration, artist: ch.title, podcastChannelId: ch.id, coverArt: ch.imageUrl }) },
    '@/store/auth': authModule, '@/store/player': { usePlayerStore: { getState: () => state } }, '@/i18n': { tg: (v: string) => v }, './lyricOwner': owner, './localLibrary': { hashKey: (v: string) => v },
    './podcastDb': { listEpisodePage: async (_scope: string, _id: string, options: any, current: () => boolean) => { pageReads++; const rows = episodes.slice(options.offset, options.offset + options.limit); if (hold) { const f = hold; hold = undefined; await f(); } if (!current()) throw new Error('Owner changed'); return { items: rows, nextOffset: options.offset + rows.length < episodes.length ? options.offset + rows.length : null }; },
      listLibraryEpisodes: async (_scope: string, _filter: string, limit: number, offset: number) => { shelfReads++; return episodes.slice(offset, offset + limit).map((episode) => ({ episode, channel: channels[0] })); } },
    './podcastLibrary': { podcastListeningState: library.podcastListeningState, readPodcastShowProgress: async () => new Map(episodes.map((episode) => [episode.id, { positionSec: 30, durationSec: 120 }])) },
  }); return { api, auth, a, b, calls, counts: () => ({ pageReads, shelfReads }), unsubscribe: () => { channels = []; }, hold: (f: () => Promise<void>) => { hold = f; } };
}
test('car podcast root reads subscriptions only; opening a show reads one small page and publishes a real next folder', async () => {
  const h = harness(), root = await h.api.buildPodcastCarBase();
  assert.deepEqual(h.counts(), { pageReads: 0, shelfReads: 0 });
  const parent = root.nodes['podcast:shows'][0].id, first = await h.api.requestPodcastCarPage(parent);
  assert.equal(first.tree.nodes[parent].filter((node: any) => node.playable).length, 20);
  const next = first.tree.nodes[parent].at(-1).id, second = await h.api.requestPodcastCarPage(next);
  assert.equal(second.tree.nodes[next][0].title, 'Episode 20'); assert.equal(h.counts().pageReads, 2);
  assert.equal(await h.api.requestPodcastCarPage(parent), undefined, 'native notification re-read does not query/publish again in a loop');
  await h.api.handlePodcastCarPlay(second.tree.nodes[next][3].id);
  assert.equal(h.calls[0].index, 3); assert.equal(h.calls[0].songs[3].id, 'show/guid|23'); assert.equal(h.calls[0].songs.length, 20);
  assert.equal(h.calls[1].kind, 'seek'); assert.equal(h.calls[1].value, 30, 'uses the existing exact RSS resume policy');
});
test('continue/unplayed/downloaded car shelves use bounded local pages and never refresh feeds', async () => {
  const h = harness(), root = await h.api.buildPodcastCarBase();
  for (const row of root.nodes['tab:podcasts'].slice(0, 3)) { const result = await h.api.requestPodcastCarPage(row.id); assert.equal(result.tree.nodes[row.id].length, 21); }
  assert.deepEqual(h.counts(), { pageReads: 0, shelfReads: 3 }); assert.equal(h.calls.length, 0);
});
test('a pending show read cannot publish or play after account ABA; stale native nodes cannot play an unsubscribed show', async () => {
  const h = harness(), root = await h.api.buildPodcastCarBase(), parent = root.nodes['podcast:shows'][0].id;
  let release!: () => void; const gate = new Promise<void>((yes) => { release = yes; }); h.hold(() => gate);
  const work = h.api.requestPodcastCarPage(parent); for (let i = 0; i < 10; i++) await Promise.resolve();
  h.auth.setState({ auth: h.b }); h.auth.setState({ auth: h.a }); release(); await assert.rejects(work, /Owner changed/);
  const fresh = await h.api.requestPodcastCarPage(parent); assert.equal(fresh.current(), true);
  h.unsubscribe(); await h.api.handlePodcastCarPlay(fresh.tree.nodes[parent][0].id); assert.equal(h.calls.length, 0);
  assert.equal(await h.api.handlePodcastCarPlay('track|album|music'), false);
  assert.equal(await h.api.requestPodcastCarPage('podcast-show|show|1'), undefined);
  assert.ok(plain(root.nodes['tab:podcasts']).every((node: any) => node.playable === false));
});
