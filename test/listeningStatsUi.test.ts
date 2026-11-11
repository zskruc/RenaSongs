import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import * as Query from '@tanstack/react-query';
import { create as createStore } from 'zustand';
import ts from 'typescript';
import { listeningRange, localDay } from '../src/lib/listeningMath';
import type { ListeningReport, ListeningRankSort } from '../src/lib/listeningDb';
import type { ListeningContentKind } from '../src/lib/contentKind';
import { listeningRankItems } from '../src/lib/listeningPresentation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = async () => { for (let index = 0; index < 4; index++) await new Promise<void>((done) => setTimeout(done, 1)); };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function report(title = 'Recorded song', seconds = 3600): ListeningReport {
  const song = { id: title, title, artist: 'Artist', artistId: 'artist', album: 'Album', albumId: 'album' };
  return {
    seconds, plays: 8, songs: 3, activeDays: 2, artistCount: 1, albumCount: 1,
    days: [{ day: '2026-11-11', seconds: seconds / 2, plays: 3 }, { day: '2026-11-12', seconds: seconds / 2, plays: 5 }],
    top: [{ song, seconds, plays: 8 }], artists: [{ name: 'Artist', seconds }],
    artistRanks: [{ key: 'artist', id: 'artist', name: 'Artist', song, seconds, plays: 8 }],
    albumRanks: [{ key: 'album', id: 'album', name: 'Album', artist: 'Artist', song, seconds, plays: 8 }],
  };
}
function load(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, setTimeout, clearTimeout, ...globals, require(name: string) {
    assert.ok(Object.hasOwn(imports, name), `Unexpected ${path} dependency ${name}`); return imports[name];
  } });
  return exports;
}
type ReportRequest = { profile: string; from: string; until: string; kind: ListeningContentKind; sort: ListeningRankSort; current: () => boolean };

/** The actual hook, TanStack observer, profile guard and recording store run here.
 * Time, SQLite IO and foreground/focus are the controlled native boundaries. */
function harness(initialAt = new Date(2026, 10, 12, 12).getTime(), withScreen = false) {
  let now = initialAt, focused = true;
  const firstAuth = { username: 'A' };
  const auth = createStore<any>(() => ({ auth: firstAuth, offline: false, offlineSource: null, autoOffline: false }));
  const authModule = { useAuthStore: auth, profileScopeId: () => auth.getState().auth?.username ?? 'local' };
  const navigationListeners = { blur: new Set<() => void>(), focus: new Set<() => void>() };
  const navigation = { isFocused: () => focused, addListener(event: 'blur' | 'focus', callback: () => void) {
    navigationListeners[event].add(callback); return () => { navigationListeners[event].delete(callback); };
  } };
  const listeners = new Set<(state: string) => void>();
  const appState = { currentState: 'active', addEventListener(_event: string, callback: (state: string) => void) {
    listeners.add(callback); return { remove: () => { listeners.delete(callback); } };
  } };
  const timers = new Map<object, { work: () => void; delay: number }>();
  const ClockDate: any = function (...args: unknown[]) { return Reflect.construct(Date, args.length ? args : [now]); };
  ClockDate.now = () => now; ClockDate.parse = Date.parse; ClockDate.UTC = Date.UTC; ClockDate.prototype = Date.prototype;
  const clock = { Date: ClockDate,
    setTimeout(work: () => void, delay: number) { const token = {}; timers.set(token, { work, delay }); return token; },
    clearTimeout(token: object) { timers.delete(token); },
  };
  const disk = new Map([['A', { enabled: true, startedAt: new Date(2025, 1, 1).getTime() }], ['B', { enabled: false, startedAt: new Date(2026, 5, 1).getTime() }]]);
  const requests: ReportRequest[] = [], writes: [string, boolean][] = [], toasts: string[] = [];
  const pushes: unknown[] = [], apiSongReads: string[] = [], plays: unknown[][] = [];
  const context = { params: {} as { setting?: string } };
  let apiSongReader = async (id: string) => ({ id, title: id });
  let reader = async (_request: ReportRequest, _index: number) => report();
  let write = async (_profile: string, _value: boolean) => {};
  let preferences = async (profile: string): Promise<{ enabled: boolean; startedAt?: number }> => disk.get(profile) ?? { enabled: true };
  const db = {
    listeningReport: (profile: string, from: string, until: string, kind: ListeningContentKind, sort: ListeningRankSort, current: () => boolean) => {
      const request = { profile, from, until, kind, sort, current }; requests.push(request); return reader(request, requests.length - 1);
    },
    listeningPreferences: (profile: string) => preferences(profile),
    setListeningEnabled: async (profile: string, enabled: boolean) => {
      writes.push([profile, enabled]); await write(profile, enabled);
      disk.set(profile, { ...(disk.get(profile) ?? { startedAt: now }), enabled });
    },
  };
  const owner = load('../src/lib/lyricOwner.ts', { '@/store/auth': authModule });
  const stats = load('../src/store/listeningStats.ts', { zustand: { create: createStore }, '@/lib/listeningDb': db, './auth': authModule }).useListeningStats;
  const api = load('../src/hooks/useListeningReport.ts', {
    react: React, '@tanstack/react-query': Query, 'expo-router': { useIsFocused: () => focused, useNavigation: () => navigation }, 'react-native': { AppState: appState },
    '@/i18n': { useT: () => (key: string) => key }, '@/lib/listeningDb': db, '@/lib/listeningMath': { listeningRange, localDay },
    '@/lib/lyricOwner': owner, '@/store/auth': authModule, '@/store/listeningStats': { useListeningStats: stats },
    '@/store/toast': { useToast: (select: any) => select({ show: (value: string) => toasts.push(value) }) },
  }, clock);
  const screen = withScreen ? load('../src/app/settings/listening-stats.tsx', {
    react: React, 'react/jsx-runtime': JSXRuntime, 'expo-router': { router: { push: (path: unknown) => pushes.push(path) }, useLocalSearchParams: () => context.params },
    'react-native': { Pressable: 'Button', Text: 'Text', View: 'View' },
    '@/api/data': { getSong: (id: string) => { apiSongReads.push(id); return apiSongReader(id); } },
    '@/components/DockScrollView': { DockScrollView: 'DockScrollView' }, '@/components/Icon': { __esModule: true, default: 'Icon' },
    '@/components/SettingsUI': { SettingsPage: 'Page', SettingsGroup: 'Group', SettingRow: 'Row', SelectList: 'Select', SwitchList: 'Switches', settingsStyles: { content: {} } },
    '@/components/stats/ListeningDashboard': { ListeningSegments: 'Segments', ListeningDashboardHeader: ({ controls, rankingControls, podium, ...props }: any) =>
      React.createElement('Dashboard', props, controls, rankingControls, podium) },
    '@/components/stats/ListeningRankings': { ListeningPodium: 'Podium', ListeningRankRow: 'RankRow' },
    '@/hooks/useListeningReport': { useListeningReport: () => { latest = api.useListeningReport(); return latest; } },
    '@/i18n': { useT: () => (key: string, values?: Record<string, unknown>) => key.replace(/\{(\w+)\}/g, (_all, name) => String(values?.[name] ?? `{${name}}`)) },
    '@/lib/listeningPresentation': { listeningRankItems },
    '@/store/player': { currentSong: () => undefined, usePlayerStore: Object.assign((select: any) => select({}), { getState: () => ({ playQueue: async (...args: unknown[]) => { plays.push(args); } }) }) },
    '@/store/settings': { useSettings: (select: any) => select({ language: 'en-US' }) },
    '@/store/toast': { useToast: (select: any) => select({ show: (value: string) => toasts.push(value) }) },
    '@/theme': { useTheme: () => ({ accent: '#1db954' }), themed: (factory: any) => factory({}) },
  }).default : undefined;
  const client = new Query.QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 300_000, gcTime: Infinity } } });
  let latest: any, root!: ReactTestRenderer;
  function Probe() { latest = api.useListeningReport(); return null; }
  const tree = () => React.createElement(Query.QueryClientProvider, { client }, React.createElement(screen ?? Probe));
  return { auth, firstAuth, client, requests, writes, toasts, timers, stats, listeners, navigationListeners, pushes, plays, apiSongReads, context,
    get root() { return root.root; }, apiSong(next: typeof apiSongReader) { apiSongReader = next; },
    get latest() { return latest; }, get now() { return now; },
    read(next: typeof reader) { reader = next; }, write(next: typeof write) { write = next; }, preferences(next: typeof preferences) { preferences = next; },
    async mount() { await act(async () => { root = create(tree()); await tick(); }); await act(tick); },
    async settle() { await act(tick); },
    async loaded() { for (let index = 0; index < 30; index++) { if (latest?.report && !latest.refreshing) return; await act(tick); } throw new Error('Report did not finish loading'); },
    async action(work: () => unknown) { await act(async () => { work(); await tick(); }); },
    async focus(value: boolean) { focused = value; await act(async () => { navigationListeners[value ? 'focus' : 'blur'].forEach((callback) => callback()); root.update(tree()); await tick(); }); },
    async focusCycle() { await act(async () => {
      focused = false; navigationListeners.blur.forEach((callback) => callback());
      focused = true; navigationListeners.focus.forEach((callback) => callback()); await tick();
    }); },
    async appCycle() { await act(async () => {
      appState.currentState = 'background'; listeners.forEach((callback) => callback('background'));
      appState.currentState = 'active'; listeners.forEach((callback) => callback('active')); await tick();
    }); },
    async app(value: string) { appState.currentState = value; await act(async () => { listeners.forEach((callback) => callback(value)); await tick(); }); },
    async time(value: number, fire = false) {
      now = value;
      if (fire) await act(async () => { for (const [token, timer] of [...timers]) { timers.delete(token); timer.work(); } await tick(); });
    },
    async close() { await act(async () => root?.unmount()); client.clear(); },
  };
}

test('mounted listening report keeps loading distinct from zero and filters real data using concrete calendar keys', async () => {
  const h = harness(), pending = deferred<ListeningReport>(); h.read(() => pending.promise);
  try {
    await h.mount(); assert.equal(h.latest.period, 'month'); assert.equal(h.latest.kind, 'music'); assert.equal(h.latest.sort, 'seconds');
    assert.equal(h.latest.initialLoading, true); assert.equal(h.latest.report, undefined); assert.equal(h.requests.length, 1);
    const expected = listeningRange('month', 2026, h.now);
    assert.deepEqual({ from: h.requests[0].from, until: h.requests[0].until }, expected);
    await h.action(() => pending.resolve(report()));
    assert.equal(h.latest.initialLoading, false); assert.equal(h.latest.report.seconds, 3600);
    assert.equal(h.latest.report.artistRanks[0].name, 'Artist'); assert.equal(h.latest.report.albumRanks[0].name, 'Album');
    h.read(async () => report('Filtered song', 120));
    await h.action(() => h.latest.setPeriod('week')); assert.equal(h.requests.at(-1)?.from, '2026-11-06');
    await h.action(() => h.latest.setKind('podcast')); assert.equal(h.requests.at(-1)?.kind, 'podcast');
    await h.action(() => h.latest.setSort('plays')); assert.equal(h.requests.at(-1)?.sort, 'plays');
    const count = h.client.getQueryCache().getAll().length, reads = h.requests.length;
    await h.action(() => { for (let index = 0; index < 8; index++) h.latest.refresh(); });
    assert.equal(h.client.getQueryCache().getAll().length, count, 'refresh must not create another query cache key');
    assert.equal(h.requests.length, reads + 1, 'same-frame refresh taps share the current request');
  } finally { await h.close(); }
});

test('recording toggle serializes same-frame taps, rolls back failures and remains retryable', async () => {
  const h = harness(), pending = deferred<void>(); h.write(() => pending.promise);
  try {
    await h.mount(); assert.equal(h.latest.recordingDisabled, false); assert.equal(h.latest.recordingEnabled, true);
    await h.action(() => { const toggle = h.latest.toggleRecording; toggle(false); toggle(true); });
    assert.deepEqual(h.writes, [['A', false]]); assert.equal(h.latest.recordingDisabled, true);
    await h.action(() => pending.resolve()); assert.equal(h.latest.recordingDisabled, false); assert.equal(h.latest.recordingEnabled, false);
    h.write(async () => { throw new Error('Disk unavailable'); });
    await h.action(() => h.latest.toggleRecording(true));
    assert.equal(h.latest.recordingEnabled, false); assert.equal(h.latest.recordingDisabled, false);
    assert.equal(h.toasts.length, 1); assert.equal(h.latest.error, true);
    await h.action(() => h.latest.refresh()); assert.equal(h.latest.error, false);
    h.write(async () => {}); await h.action(() => h.latest.toggleRecording(true));
    assert.equal(h.latest.recordingEnabled, true); assert.equal(h.latest.report.seconds, 3600);
  } finally { await h.close(); }
});

test('a failed report is an error rather than an empty period and refresh retries the same cache entry', async () => {
  const h = harness(); h.read(async () => { throw new Error('SQLite unavailable'); });
  try {
    await h.mount(); assert.equal(h.latest.initialLoading, false); assert.equal(h.latest.error, true);
    assert.equal(h.latest.report, undefined); assert.equal(h.latest.recordingDisabled, false);
    const count = h.client.getQueryCache().getAll().length;
    h.read(async () => report('Recovered report', 1800));
    await h.action(() => h.latest.refresh());
    assert.equal(h.latest.error, false); assert.equal(h.latest.report.seconds, 1800);
    assert.equal(h.client.getQueryCache().getAll().length, count);
  } finally { await h.close(); }
});

test('a new profile with failed preferences cannot inherit the previous recording date or selected year', async () => {
  const h = harness();
  try {
    await h.mount(); assert.ok(h.latest.startedAt); await h.action(() => h.latest.setYear(2025));
    assert.equal(h.latest.year, 2025);
    h.preferences(async () => { throw new Error('Preference read failed'); });
    await h.action(() => h.auth.setState({ auth: { username: 'B' } }));
    assert.equal(h.latest.error, true); assert.equal(h.latest.startedAt, undefined);
    assert.equal(h.latest.year, 2026); assert.deepEqual(Array.from(h.latest.years, (row: { value: number }) => row.value), [2026]);
    assert.equal(h.latest.recordingDisabled, false, 'the preference failure must remain retryable');
  } finally { await h.close(); }
});

test('profile and source ABA invalidate retained actions and late report replies before another owner can see them', async () => {
  const h = harness(), old = deferred<ListeningReport>(), next = deferred<ListeningReport>();
  h.read((_request, index) => index === 0 ? old.promise : index === 1 ? next.promise : Promise.resolve(report('Source report', 240)));
  try {
    await h.mount(); const retained = h.latest.canAct; assert.equal(retained(), true);
    await h.action(() => { h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: h.firstAuth }); });
    assert.equal(retained(), false); assert.equal(h.requests[0].current(), false);
    await h.action(() => next.resolve(report('New owner report', 180)));
    await h.action(() => old.resolve(report('Late old report', 999_999)));
    assert.equal(h.latest.report.top[0].song.title, 'New owner report');
    const retainedSource = h.latest.canAct;
    await h.action(() => h.auth.setState({ offlineSource: { uri: 'file:///different-local-folder' } }));
    assert.equal(retainedSource(), false); assert.equal(h.latest.report.top[0].song.title, 'Source report');
    const beforeUnmount = h.latest.canAct; await h.close(); assert.equal(beforeUnmount(), false); assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
  } catch (error) { await h.close(); throw error; }
});

test('a visible report rolls over at midnight and foreground without polling while hidden', async () => {
  const h = harness(new Date(2026, 10, 12, 23, 59).getTime());
  try {
    await h.mount(); assert.equal(h.requests[0].until, '2026-11-13'); assert.equal(h.timers.size, 1);
    const timer = [...h.timers.values()][0]; assert.ok(timer.delay >= 60_000 && timer.delay < 61_000);
    await h.time(new Date(2026, 10, 13, 0, 0, 1).getTime(), true);
    assert.equal(h.latest.range.until, '2026-11-14'); assert.equal(h.requests.at(-1)?.until, '2026-11-14'); assert.equal(h.timers.size, 1);
    await h.focus(false); assert.equal(h.timers.size, 0);
    await h.time(new Date(2026, 10, 14, 12).getTime()); await h.focus(true);
    assert.equal(h.latest.range.until, '2026-11-15'); assert.equal(h.requests.at(-1)?.until, '2026-11-15');
    await h.app('background'); assert.equal(h.timers.size, 0); const reads = h.requests.length;
    await h.time(new Date(2027, 0, 1, 12).getTime()); assert.equal(h.requests.length, reads);
    await h.app('active'); assert.equal(h.latest.year, 2027); assert.equal(h.latest.range.until, '2027-01-02');
    await h.action(() => h.latest.setPeriod('year')); await h.action(() => h.latest.setYear(2025));
    assert.equal(h.latest.range.from, '2025-01-01'); assert.equal(h.latest.range.until, '2026-01-01');
    assert.equal(h.latest.years[0].value, 2027);
  } finally { await h.close(); }
});

function rankingReport(count = 30, spoken = false): ListeningReport {
  const top = Array.from({ length: count }, (_, index) => ({ song: { id: `${spoken ? 'episode' : 'song'}-${index}`, title: `Song ${index}`,
    artist: `Artist ${index % 3}`, artistId: `artist-${index % 3}`, album: `Album ${index % 3}`, albumId: `album-${index % 3}`,
    ...(spoken ? { mediaKind: 'podcast' as const, podcastChannelId: 'show' } : {}) }, seconds: 300, plays: 2 }));
  const seconds = count * 300, plays = count * 2;
  return { ...report(), seconds, plays, songs: count, artistCount: 3, albumCount: 3, top,
    days: [{ day: '2026-11-12', seconds, plays }],
    artistRanks: top.slice(0, 3).map((row, index) => ({ key: `artist-${index}`, id: `artist-${index}`, name: `Artist ${index}`, song: row.song, seconds: seconds / 3, plays: plays / 3 })),
    albumRanks: top.slice(0, 3).map((row, index) => ({ key: `album-${index}`, id: `album-${index}`, name: `Album ${index}`, artist: `Artist ${index}`, song: row.song, seconds: seconds / 3, plays: plays / 3 })),
  };
}

test('actual stats page bounds initial rankings, expands on request and routes artist/album/podcast podium items', async () => {
  const h = harness(undefined, true); h.read(async (request) => rankingReport(30, request.kind === 'podcast'));
  try {
    await h.mount();
    const segments = (label: string) => h.root.findAllByType('Segments' as any).find((node) => node.props.label === label)!;
    assert.equal(h.root.findAllByType('DockScrollView' as any).length, 1);
    assert.equal(h.root.findAllByType('Podium' as any)[0].props.items.length, 3);
    assert.equal(h.root.findAllByType('RankRow' as any).length, 7, 'podium plus rows initially shows ten, not every saved item');
    const more = () => h.root.findAllByType('Button' as any).find((node) => node.findAllByType('Text' as any).some((text) => text.props.children === 'Show all 30'))!;
    await h.action(() => more().props.onPress()); assert.equal(h.root.findAllByType('RankRow' as any).length, 27);
    await h.action(() => segments('Ranking order').props.onChange('plays')); await h.loaded(); assert.equal(h.root.findAllByType('RankRow' as any).length, 7);
    assert.equal(h.root.findAllByType('Podium' as any)[0].props.sort, 'plays');
    await h.action(() => segments('Ranking category').props.onChange('artists'));
    let podium = h.root.findAllByType('Podium' as any)[0]; await h.action(() => podium.props.onOpen(podium.props.items[0]));
    assert.equal((h.pushes.at(-1) as any).pathname, '/artist/[id]'); assert.equal((h.pushes.at(-1) as any).params.id, 'artist-0');
    await h.action(() => segments('Ranking category').props.onChange('albums'));
    podium = h.root.findAllByType('Podium' as any)[0]; await h.action(() => podium.props.onOpen(podium.props.items[0]));
    assert.equal((h.pushes.at(-1) as any).pathname, '/album/[id]'); assert.equal((h.pushes.at(-1) as any).params.id, 'album-0');
    await h.action(() => segments('Content statistics').props.onChange('podcast')); await h.loaded();
    assert.equal(h.root.findAllByType('Segments' as any).filter((node) => node.props.label === 'Ranking category').length, 0);
    podium = h.root.findAllByType('Podium' as any)[0]; await h.action(() => podium.props.onOpen(podium.props.items[0]));
    assert.equal((h.pushes.at(-1) as any).pathname, '/podcast-episode/[id]'); assert.equal((h.pushes.at(-1) as any).params.channelId, 'show');
    assert.equal(h.apiSongReads.length, 0, 'detail navigation does not fetch each artwork or song');
  } finally { await h.close(); }
});

test('actual stats row callbacks reject account ABA before a lookup and after a pending song lookup', async () => {
  const h = harness(undefined, true), pending = deferred<{ id: string; title: string }>();
  h.read(async () => rankingReport(3)); h.apiSong(() => pending.promise);
  try {
    await h.mount();
    const podium = h.root.findAllByType('Podium' as any)[0], item = podium.props.items[0], retained = podium.props.onOpen;
    await h.action(() => { void retained(item); }); assert.equal(h.apiSongReads.length, 1);
    await h.action(() => { h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: h.firstAuth }); });
    await h.action(() => pending.resolve({ id: item.id, title: 'Late old song' })); assert.equal(h.plays.length, 0);
    await h.action(() => retained(item)); assert.equal(h.apiSongReads.length, 1, 'a retained old row cannot start a new lookup');
    h.apiSong(async (id) => ({ id, title: 'Fresh song' }));
    const fresh = h.root.findAllByType('Podium' as any)[0]; await h.action(() => fresh.props.onOpen(fresh.props.items[0]));
    assert.equal(h.plays.length, 1); assert.equal((h.plays[0][0] as { id: string }[])[0].id, item.id);
    assert.equal(h.toasts.length, 0);
  } finally { await h.close(); }
});

for (const cycle of ['focusCycle', 'appCycle'] as const) {
  test(`an actual held song lookup cannot revive after a batched ${cycle}`, async () => {
    const h = harness(undefined, true), pending = deferred<{ id: string; title: string }>();
    h.read(async () => rankingReport(3)); h.apiSong(() => pending.promise);
    try {
      await h.mount(); const podium = h.root.findAllByType('Podium' as any)[0];
      const retained = podium.props.onOpen, item = podium.props.items[0], oldCanAct = h.latest.canAct;
      const cacheCount = h.client.getQueryCache().getAll().length;
      await h.action(() => { void retained(item); }); assert.equal(h.apiSongReads.length, 1);
      await h[cycle](); await h.loaded();
      assert.equal(oldCanAct(), false); assert.equal(h.latest.canAct(), true, 'returning starts a new, usable visit');
      await h.action(() => pending.resolve({ id: item.id, title: 'Old visit reply' }));
      assert.equal(h.plays.length, 0); assert.equal(h.toasts.length, 0);
      await h.action(() => retained(item)); assert.equal(h.apiSongReads.length, 1, 'retained pre-leave callback stays invalid');
      assert.equal(h.client.getQueryCache().getAll().length, cacheCount, 'visit generations must not grow query keys');
      h.apiSong(async (id) => ({ id, title: 'New visit reply' }));
      const fresh = h.root.findAllByType('Podium' as any)[0]; await h.action(() => fresh.props.onOpen(fresh.props.items[0]));
      assert.equal(h.plays.length, 1);
    } finally { await h.close(); }
  });
}

test('a same-key report lookup is canceled on leave and a new visit cannot be overwritten by its late reply', async () => {
  const h = harness(), old = deferred<ListeningReport>(), next = deferred<ListeningReport>();
  h.read((_request, index) => index === 0 ? old.promise : next.promise);
  try {
    await h.mount(); assert.equal(h.requests.length, 1);
    await h.focusCycle(); await h.settle();
    assert.equal(h.requests[0].current(), false); assert.equal(h.requests.length, 2);
    await h.action(() => next.resolve(report('New visit report', 1200))); await h.loaded();
    await h.action(() => old.resolve(report('Late previous visit', 999_999)));
    assert.equal(h.latest.report.top[0].song.title, 'New visit report'); assert.equal(h.latest.report.seconds, 1200);
    assert.equal(h.client.getQueryCache().getAll().length, 1);
  } finally { await h.close(); }
  assert.equal(h.navigationListeners.focus.size, 0); assert.equal(h.navigationListeners.blur.size, 0);
});

test('a hidden stats screen retains its same-owner layout while disabling actions and clears it on account change', async () => {
  const h = harness(undefined, true); h.read(async () => rankingReport(3));
  try {
    await h.mount(); const data = h.latest.report, oldCanAct = h.latest.canAct;
    await h.focus(false); assert.equal(h.latest.report, data); assert.equal(h.latest.initialLoading, false); assert.equal(h.latest.recordingDisabled, true);
    assert.equal(h.root.findAllByType('Podium' as any).length, 1); assert.equal(oldCanAct(), false);
    await h.app('background'); assert.equal(h.latest.report, data); assert.equal(h.root.findAllByType('Podium' as any).length, 1);
    const reads = h.requests.length;
    await h.action(() => h.auth.setState({ auth: { username: 'B' } }));
    assert.equal(h.latest.report, undefined); assert.equal(h.root.findAllByType('Podium' as any).length, 0);
    assert.equal(h.requests.length, reads, 'hidden account handoff must not run another report');
  } finally { await h.close(); }
});

test('imported older ledger days extend year choices without changing when local recording began', async () => {
  const h = harness(); const startedAt = new Date(2026, 0, 1).getTime();
  h.preferences(async () => ({ enabled: true, startedAt }));
  h.read(async (request) => ({ ...report(), firstRecordedDay: request.kind === 'podcast' ? '2020-04-12' : '2024-02-20' }));
  try {
    await h.mount(); assert.equal(h.latest.startedAt, startedAt);
    assert.deepEqual(Array.from(h.latest.years, (row: { value: number }) => row.value), [2026, 2025, 2024]);
    await h.action(() => h.latest.setPeriod('year')); await h.loaded();
    await h.action(() => h.latest.setYear(2024)); await h.loaded(); assert.equal(h.latest.range.from, '2024-01-01');
    await h.action(() => h.latest.setKind('podcast')); await h.loaded();
    assert.equal(h.latest.years.at(-1).value, 2020); assert.equal(h.latest.startedAt, startedAt);
    assert.equal(h.stats.getState().startedAt, startedAt, 'UI year navigation must not rewrite recording metadata');
  } finally { await h.close(); }
});

test('the latest stats song tap wins when held lookups finish in reverse order', async () => {
  const h = harness(undefined, true), first = deferred<{ id: string; title: string }>(), second = deferred<{ id: string; title: string }>();
  h.read(async () => rankingReport(3)); h.apiSong((id) => id === 'song-0' ? first.promise : second.promise);
  try {
    await h.mount(); const podium = h.root.findAllByType('Podium' as any)[0];
    await h.action(() => { void podium.props.onOpen(podium.props.items[0]); void podium.props.onOpen(podium.props.items[1]); });
    assert.deepEqual(h.apiSongReads, ['song-0', 'song-1']);
    await h.action(() => second.resolve({ id: 'song-1', title: 'Second tap' }));
    await h.action(() => first.resolve({ id: 'song-0', title: 'First tap late' }));
    assert.equal(h.plays.length, 1); assert.equal((h.plays[0][0] as { id: string }[])[0].id, 'song-1');
    assert.equal(h.toasts.length, 0);
  } finally { await h.close(); }
});

test('the previous Year settings-search link reveals the yearly selector on the actual screen', async () => {
  const h = harness(undefined, true); h.context.params = { setting: 'Year' };
  try {
    await h.mount(); assert.equal(h.latest.period, 'year');
    const selector = h.root.findAllByType('Select' as any).find((node) => node.props.label === 'Year'); assert.ok(selector);
    assert.equal(selector.props.value, 2026); assert.equal(h.requests.at(-1)?.from, '2026-01-01');
    await h.action(() => selector.props.onChange(2025)); assert.equal(h.requests.at(-1)?.until, '2026-01-01');
  } finally { await h.close(); }
});
