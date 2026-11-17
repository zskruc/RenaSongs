import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalRefreshScheduler } from '../src/lib/localRefreshScheduler';
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
const turn = () => new Promise<void>((r) => setImmediate(r));

test('automatic checks are shared, throttled per source and never run concurrently with a manual rescan', async () => {
  let now = 1000, active = 0, peak = 0;
  const scheduler = createLocalRefreshScheduler(300000, () => now), gate = deferred(), calls: string[] = [];
  const work = (name: string, wait?: Promise<void>) => async () => { calls.push(name); active++; peak = Math.max(peak, active); await wait; active--; return true; };
  const automatic = scheduler.run('A', false, () => true, work('auto', gate.promise));
  assert.equal(scheduler.run('A', false, () => true, work('duplicate')), automatic);
  await turn();
  const manual = scheduler.run('A', true, () => true, work('manual'));
  const other = scheduler.run('B', false, () => true, work('B'));
  assert.deepEqual(calls, ['auto']); gate.resolve(); await Promise.all([automatic, manual, other]);
  assert.deepEqual(calls, ['auto', 'manual', 'B']); assert.equal(peak, 1);
  assert.equal(await scheduler.run('A', false, () => true, work('too soon')), false);
  now += 300001; assert.equal(await scheduler.run('A', false, () => true, work('due')), true);
});

test('stale queued work is discarded and one failing scan does not block later sources', async () => {
  const scheduler = createLocalRefreshScheduler(300000), gate = deferred(); let current = true;
  const first = scheduler.run('A', false, () => true, async () => { await gate.promise; throw new Error('unreadable'); });
  const rejected = assert.rejects(first, /unreadable/);
  const stale = scheduler.run('B', true, () => current, async () => { throw new Error('must not start'); });
  current = false; gate.resolve(); await rejected; assert.equal(await stale, false);
  assert.equal(await scheduler.run('C', true, () => true, async () => true), true);
});
