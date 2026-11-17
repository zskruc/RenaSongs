import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { Song } from '../src/api/backend';
import { captureSnapshot, restoreSnapshot, type PlayerSnapshot } from '../src/lib/playerSnapshot';

const song = (id: string): Song => ({ id, title: id });
function snapshot(radio = false): PlayerSnapshot {
  const queue = [song('a'), song('b')];
  return { queue, index: 0, queuedCount: 1, positionSec: 17, durationSec: 180,
    originalQueue: [...queue].reverse(), queueDealt: true, source: radio ? 'Mix' : 'Album',
    sourceHref: radio ? null : '/album/a', radioMode: radio, radioSeed: radio ? queue[0] : null, shuffle: !radio };
}

test('rollback preserves the old radio, shuffle, queued block and exact source references', () => {
  for (const radio of [true, false]) {
    const state = snapshot(radio), saved = captureSnapshot(state);
    Object.assign(state, { queue: [song('replacement')], radioMode: !radio, radioSeed: song('wrong'), shuffle: radio });
    const restored = restoreSnapshot(saved);
    assert.equal(restored.radioMode, radio); assert.equal(restored.radioSeed, saved.radioSeed);
    assert.equal(restored.shuffle, !radio); assert.equal(restored.queue, saved.queue);
    assert.equal(restored.originalQueue, saved.originalQueue);
    assert.equal(restored.queuedCount, 1); assert.equal(restored.positionSec, 17);
  }
});

test('production Previous restores an interrupted mix or ordinary album with a fresh clock', () => {
  const source = readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('player.ts', source, ts.ScriptTarget.Latest, true);
  let previous: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'previous' && ts.isArrowFunction(node.initializer)) previous = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(previous);
  for (const radio of [true, false]) {
    const saved = snapshot(radio), state = snapshot(!radio), loads: unknown[][] = [];
    const context = { listeningIntent: 0, cancelPlaybackRecovery() {}, endBootQuiet() {}, restoreSnapshot,
      useSettings: { getState: () => ({ previousButtonMode: 'always' }) },
      get: () => state, set: (patch: object) => Object.assign(state, patch),
      playedHistory: [saved], contextKey: (source: string | null, href: string | null) => href ?? source,
      loadIndex: (...args: unknown[]) => { loads.push(args); }, skipAutoplay: () => true };
    const run = runInNewContext(ts.transpileModule(`(${previous.getText(tree)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    run();
    assert.equal(state.radioMode, radio); assert.equal(state.radioSeed, saved.radioSeed);
    assert.equal(state.shuffle, !radio); assert.equal(state.sourceHref, saved.sourceHref);
    assert.equal(state.queue, saved.queue); assert.equal(state.queuedCount, 0);
    assert.equal(state.positionSec, 0); assert.equal(state.durationSec, 0);
    assert.deepEqual(loads, [[saved.index, true]]);
  }
});
