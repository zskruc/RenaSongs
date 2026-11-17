import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import type { Song } from '../src/api/backend';
import * as queue from '../src/lib/jukeboxQueue';
const song = (id: string, extra = {}): Song => ({ id, title: id, duration: 100, ...extra });
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let count = 0; count < 100; count++) await Promise.resolve(); };
function deferred() { let resolve!: () => void; const promise = new Promise<void>((yes) => { resolve = yes; }); return { promise, resolve }; }

function harness() {
  const a = { username: 'a', serverUrl: 'https://a.test' }, b = { username: 'b', serverUrl: 'https://b.test' };
  const auth = createStore<any>(() => ({ auth: a }));
  let ids: string[] = [], index = 0, position = 0, playing = false, now = 1000;
  let inFlight = 0, maxInFlight = 0;
  const calls: { action: string; args: any[]; owner: string }[] = [];
  const holds = new Map<string, Promise<void>>(), failAfter = new Set<string>();
  const timers = new Map<number, () => void>(); let timerId = 0;
  const status = () => ({ currentIndex: index, position, playing, gain: 1 });
  async function invoke(action: string, owner: any, args: any[], apply: () => void = () => {}) {
    calls.push({ action, args: plain(args), owner: owner.username });
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const hold = holds.get(action); holds.delete(action); if (hold) await hold;
      apply();
      if (failAfter.delete(action)) throw new Error('reply lost after commit');
      return status();
    } finally { inFlight--; }
  }
  const subsonic = {
    hasJukeboxRole: async () => true,
    jukeboxSet: (owner: unknown, list: string[]) => invoke('set', owner, [list], () => { ids = [...list]; index = 0; position = 0; }),
    jukeboxAdd: (owner: unknown, list: string[]) => invoke('add', owner, [list], () => { ids.push(...list); }),
    jukeboxRemove: (owner: unknown, at: number) => invoke('remove', owner, [at], () => { ids.splice(at, 1); }),
    jukeboxGet: async (owner: unknown) => ({ ...await invoke('get', owner, []), ids: [...ids] }),
    jukeboxStart: (owner: unknown) => invoke('start', owner, [], () => { playing = true; }),
    jukeboxStop: (owner: unknown) => invoke('stop', owner, [], () => { playing = false; }),
    jukeboxSkip: (owner: unknown, at: number, sec: number) => invoke('skip', owner, [at, sec], () => { index = at; position = sec; }),
    jukeboxStatus: (owner: unknown) => invoke('status', owner, []),
    jukeboxSetGain: (owner: unknown, volume: number) => invoke('gain', owner, [volume]),
  };
  const imports: Record<string, unknown> = { zustand: { create: createStore }, './auth': { useAuthStore: auth }, '@/api/subsonic': subsonic, '@/lib/jukeboxQueue': queue };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/store/jukebox.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date: { now: () => now },
    setInterval: (fn: () => void) => { timers.set(++timerId, fn); return timerId; }, clearInterval: (id: number) => timers.delete(id),
    require: (key: string) => { assert.ok(Object.hasOwn(imports, key), key); return imports[key]; } });
  const changed: any[][] = [], finished: true[] = [], progresses: any[][] = [];
  exports.initJukebox({ onConnected() {}, onDisconnected() {}, onTrackChanged: (...args: any[]) => changed.push(args),
    onProgress: (...args: any[]) => progresses.push(args), onPlayingChanged() {}, onFinished: () => finished.push(true) });
  return { api: exports, a, b, auth, calls, changed, finished, progresses,
    ids: () => [...ids], active: () => exports.useJukebox.getState().active, maxInFlight: () => maxInFlight,
    hold: (action: string, promise: Promise<void>) => holds.set(action, promise), failAfter: (action: string) => failAfter.add(action),
    move: (at: number, sec: number, play = true) => { index = at; position = sec; playing = play; },
    poll: async () => { for (const fn of timers.values()) fn(); await tick(); }, advance: (milliseconds: number) => { now += milliseconds; } };
}

test('a server continuation is bounded and stops before duplicate, local and URL items', () => {
  const a = song('a');
  assert.equal(queue.jukeboxUpcoming(a, Array.from({ length: 100 }, (_, n) => song(`n${n}`)), 3).length, 20);
  assert.deepEqual(queue.jukeboxUpcoming(a, [song('b'), a, song('c')], 7).map((x) => x.queueIndex), [8]);
  for (const bad of [song('x', { url: 'https://radio.test' }), song('x', { localUri: 'file:///track.mp3' })])
    assert.deepEqual(queue.jukeboxUpcoming(a, [song('b'), bad, song('c')], 0).map((x) => x.song.id), ['b']);
});

test('server-driven progression reports the absolute occurrence and seek targets the server index', async () => {
  const h = harness(); await h.api.jukeboxConnect();
  await h.api.jukeboxLoad(song('a'), true, 0, [song('b'), song('c')], 9);
  assert.deepEqual(h.ids(), ['a', 'b', 'c']);
  h.move(1, 3); await h.poll(); await h.poll();
  assert.deepEqual(h.changed, [[10, 3, 100, 'b']]);
  await h.api.jukeboxSeek(12);
  assert.deepEqual(h.calls.at(-1)?.args, [1, 12]);
  h.move(1, 100, false); await h.poll(); assert.equal(h.finished.length, 0);
  h.move(2, 100, false); await h.poll(); await h.poll(); assert.equal(h.finished.length, 1);
});

test('tail synchronization retains the latest edit while another mutation is suspended', async () => {
  const h = harness(); await h.api.jukeboxConnect(); await h.api.jukeboxLoad(song('a'), true, 0, [song('b'), song('c')]);
  const gate = deferred(); h.hold('remove', gate.promise);
  const first = h.api.jukeboxSyncUpcoming(song('a'), [song('d'), song('e')]); await tick();
  const latest = h.api.jukeboxSyncUpcoming(song('a'), [song('x'), song('y')]);
  gate.resolve(); await Promise.all([first, latest]);
  assert.deepEqual(h.ids(), ['a', 'x', 'y']);
  assert.equal(h.calls.filter((call) => call.action === 'set').length, 1);
  assert.equal(h.calls.filter((call) => call.action === 'start').length, 1);
  assert.equal(h.maxInFlight(), 1);
});

test('an overtaken load cannot seek or start after its replacement, and stale polls cannot publish it', async () => {
  const h = harness(); await h.api.jukeboxConnect();
  const gate = deferred(); h.hold('set', gate.promise);
  const first = h.api.jukeboxLoad(song('a'), true, 18, [song('b')]); await tick();
  const second = h.api.jukeboxLoad(song('x'), true, 0, [song('y')]); gate.resolve();
  assert.equal(await first, false); assert.equal(await second, true);
  assert.deepEqual(h.calls.map((call) => call.action), ['set', 'set', 'start']);
  const statusGate = deferred(); h.hold('status', statusGate.promise); const oldPoll = h.poll(); await tick();
  await h.api.jukeboxLoad(song('z'), true, 0, [song('q')]); h.move(1, 3); statusGate.resolve(); await oldPoll;
  assert.equal(h.changed.length, 0); await h.poll(); assert.deepEqual(h.changed, [[1, 3, 100, 'q']]);
});

test('an account change fences old loads and availability without stopping the new session', async () => {
  const h = harness(); await h.api.jukeboxConnect();
  const gate = deferred(); h.hold('set', gate.promise); const old = h.api.jukeboxLoad(song('a'), true); await tick();
  h.auth.setState({ auth: h.b }); assert.equal(h.active(), false); await h.api.jukeboxConnect();
  const fresh = h.api.jukeboxLoad(song('b'), true); gate.resolve(); await Promise.all([old, fresh]);
  assert.deepEqual(h.ids(), ['b']); assert.deepEqual(h.calls.filter((call) => call.action === 'start').map((call) => call.owner), ['b']);
});

test('a lost mutation reply reconciles actual server entries before retry, and the latest edit wins', async () => {
  const h = harness(); await h.api.jukeboxConnect(); await h.api.jukeboxLoad(song('a'), true, 0, [song('b'), song('c')]);
  h.failAfter('remove'); await h.api.jukeboxSyncUpcoming(song('a'), [song('d')]);
  assert.deepEqual(h.ids(), ['a', 'b']);
  await h.api.jukeboxSyncUpcoming(song('a'), [song('x')]);
  assert.deepEqual(h.ids(), ['a', 'x']);
  assert.equal(h.calls.filter((call) => call.action === 'get').length, 1);
  assert.deepEqual(h.calls.filter((call) => call.action === 'remove').map((call) => call.args), [[2], [1]]);
});

test('a queue edit during loading is applied, and end-of-song/repeat-one empties only the future tail', async () => {
  const h = harness(); await h.api.jukeboxConnect(); const gate = deferred(); h.hold('set', gate.promise);
  const load = h.api.jukeboxLoad(song('a'), true, 0, [song('b'), song('c')]); await tick();
  const sync = h.api.jukeboxSyncUpcoming(song('a'), [song('x')]); gate.resolve(); await Promise.all([load, sync]);
  assert.deepEqual(h.ids(), ['a', 'x']); await h.api.jukeboxSyncUpcoming(song('a'), []); assert.deepEqual(h.ids(), ['a']);
  const text = readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('player.ts', text, ts.ScriptTarget.Latest, true);
  const helper = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'jukeboxUpcoming')!;
  const state = { queue: [song('a'), song('b')], repeat: 'off', sleepAtSongEnd: false, chapterStop: null as object | null };
  const run = runInNewContext(ts.transpileModule(`${helper.getText(tree)}\njukeboxUpcoming`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { usePlayerStore: { getState: () => state } });
  assert.deepEqual(plain(run(0)), [song('b')]);
  state.repeat = 'one'; assert.deepEqual(plain(run(0)), []);
  state.repeat = 'all'; state.sleepAtSongEnd = true; assert.deepEqual(plain(run(0)), []);
  state.sleepAtSongEnd = false; state.chapterStop = {}; assert.deepEqual(plain(run(0)), []);
});

test('a server advance during tail removal stops the old edit before it removes the playing item', async () => {
  const h = harness(); await h.api.jukeboxConnect(); await h.api.jukeboxLoad(song('a'), true, 0, [song('b'), song('c')]);
  const gate = deferred(); h.hold('remove', gate.promise);
  const sync = h.api.jukeboxSyncUpcoming(song('a'), [song('x')]); await tick();
  h.move(1, 2); gate.resolve(); await sync;
  assert.deepEqual(h.ids(), ['a', 'b']);
  assert.deepEqual(h.changed, [[1, 2, 100, 'b']]);
  assert.deepEqual(h.calls.filter((call) => call.action === 'remove').map((call) => call.args), [[2]]);
  await h.api.jukeboxSyncUpcoming(song('b'), [song('x')], 1);
  assert.deepEqual(h.ids(), ['a', 'b', 'x']);
});

test('a later tail cannot reintroduce an ID from the played server prefix', async () => {
  const h = harness(); await h.api.jukeboxConnect(); await h.api.jukeboxLoad(song('a'), true, 0, [song('b'), song('c')]);
  h.move(1, 3); await h.poll();
  await h.api.jukeboxSyncUpcoming(song('b'), [song('a'), song('d')], 5);
  assert.deepEqual(h.ids(), ['a', 'b']);
  assert.equal(new Set(h.ids()).size, h.ids().length);
});
