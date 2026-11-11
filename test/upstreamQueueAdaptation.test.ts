import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { unshuffleQueue } from '../src/lib/unshuffleQueue';
import type { Song } from '../src/api/subsonic';
const song = (id: string, extra = {}): Song => ({ id, title: id, ...extra });

test('unshuffle preserves edits, current duplicate occurrence and current metadata with linear matching', () => {
  const a = song('a'), b = song('b'), c = song('c'), added = song('x', { queued: true });
  let result = unshuffleQueue([c, added, a], [a, b, c], 1);
  assert.deepEqual(result.queue, [a, c, added]); assert.equal(result.index, 2);
  const first = song('a', { title: 'Old copy' }), second = song('a', { title: 'Playing copy' });
  result = unshuffleQueue([c, second], [first, c, second], 1);
  assert.deepEqual(result.queue, [c, second]); assert.equal(result.queue[result.index], second);
  const newCopy = song('a', { queued: true });
  result = unshuffleQueue([newCopy, a, c], [a, b, c], 0);
  assert.deepEqual(result.queue, [a, c, newCopy]); assert.equal(result.index, 2);
  const updated = song('a', { title: 'Corrected title' });
  result = unshuffleQueue([c, updated], [a, c], 1);
  assert.equal(result.queue[0], updated); assert.equal(result.index, 0);
  result = unshuffleQueue([a, a, c], [c, a], 1);
  assert.equal(result.queue.length, 3); assert.equal(result.index, 2, 'same object can represent two distinct queue occurrences');
});

test('the production remote transition resets the listen and queued block before publishing a new item, without repeating same-index events', () => {
  const tree = ts.createSourceFile('player.ts', readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const integration = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'initRemoteIntegration')!;
  let handler: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'onTrackChanged' && ts.isArrowFunction(node.initializer)) handler = node.initializer; ts.forEachChild(node, visit); };
  visit(integration); assert.ok(handler);
  const calls: string[] = [], state = { queue: [song('a'), song('b')], index: 0, positionSec: 50, durationSec: 100 };
  const context: Record<string, any> = { usePlayerStore: { getState: () => state, setState: (patch: object) => { calls.push('publish'); Object.assign(state, patch); } },
    pushHistory: () => calls.push('history'), consumeQueuedOnIndexChange: () => calls.push('queued'), scrobbledThisTrack: true,
    plausibleDuration: (duration: number) => duration, onTrackChanged: () => calls.push('track') };
  const run = runInNewContext(ts.transpileModule(`(${handler.getText(tree)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  run(1, 2, 100, 'b'); assert.deepEqual(calls, ['history', 'queued', 'publish', 'track']);
  run(1, 3, 100, 'b'); assert.equal(context.scrobbledThisTrack, false); assert.equal(calls.length, 4);
});

test('music-player manifest category is idempotent and preserves the launcher and existing filters', async () => {
  const { createRequire } = await import('node:module'); const require = createRequire(import.meta.url);
  const plugin = require('../plugins/withMusicPlayerCategory.js');
  const initial = { $: { 'android:name': '.MainActivity' }, 'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }] };
  const config: any = plugin({ name: 'Test', slug: 'test' });
  const mod = config.mods.android.manifest;
  let value: any = { modResults: { manifest: { application: [{ activity: [initial] }] } }, modRequest: {} };
  value = await mod(value); value = await mod(value);
  assert.equal(value.modResults.manifest.application[0].activity[0]['intent-filter'].length, 2);
  assert.equal(initial['intent-filter'][0].category[0].$['android:name'], 'android.intent.category.LAUNCHER');
});
