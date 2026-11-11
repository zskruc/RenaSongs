import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.createSourceFile('player.ts', readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
function production(name: string) {
  const node = source.statements.find((item): item is ts.FunctionDeclaration => ts.isFunctionDeclaration(item) && item.name?.text === name)!;
  return ts.transpileModule(`${node.getText(source)}\nexports.run=${name}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}

test('actual repeat status reconciliation ignores queued null when the synchronous native status still owns A-B', () => {
  for (const [native, live, clears] of [[{ startSec: 5, endSec: 10 }, false, 0], [null, false, 1], [null, true, 1]] as const) {
    const state = { section: { profile: 'A', songId: 'song', start: 5, end: 10 } as object | null };
    let reset = 0;
    const exports: Record<string, any> = {};
    runInNewContext(production('onStatus'), { exports,
      useRepeatSection: { getState: () => state, setState: (patch: typeof state) => { Object.assign(state, patch); reset++; } },
      profileScopeId: () => 'A', currentSong: () => ({ id: 'song' }), usePlayerStore: { getState: () => ({}) },
      activePlayer: () => ({ currentStatus: { abRepeat: native } }), applyLoop() {}, scheduleNextSource() {},
      beat() {}, expectedAudioBeatIntervalMs: 500, remoteKind: () => 'controlled-early-return',
    });
    exports.run({ abRepeat: null }, live); assert.equal(reset, clears);
    assert.equal(state.section === null, clears === 1);
  }
});

test('actual gapless loudness failure queues an ordinary source once and cannot revive an obsolete owner or A-B section', async () => {
  for (const replacement of ['none', 'owner', 'section'] as const) {
    const next = { id: 'next' }, queue = [{ id: 'current' }, next], state = { queue, index: 0, repeat: 'off' };
    let owner: object = {}, section: object | null = null, reject!: (error: Error) => void;
    const sources: unknown[] = [], settings = { replayGain: 'track' }, exports: Record<string, any> = {};
    const player = { setNextSource: (value: unknown) => sources.push(value), clearNextSource() {} };
    const context: Record<string, any> = { exports, preparingNext: null, queuedNext: null,
      activePlayer: () => player, usePlayerStore: { getState: () => state }, useRepeatSection: { getState: () => ({ section }) },
      useSettings: { getState: () => settings }, useAuthStore: { getState: () => ({ auth: owner }) }, profileScopeId: () => 'A',
      gaplessReady: () => true, nextIndex: () => 1, gaplessSettingsKey: () => 'same', currentSong: () => queue[0],
      sourceFor: (song: unknown) => song, streamOffsetSec: 0,
      prepareLoudnessSnapshot: () => new Promise<void>((_resolve, fail) => { reject = fail; }),
    };
    runInNewContext(production('scheduleNextSource'), context);
    exports.run(); assert.deepEqual(sources, []);
    if (replacement === 'owner') owner = {};
    if (replacement === 'section') section = { start: 5, end: 10 };
    reject(new Error('Controlled cache failure'));
    for (let tick = 0; tick < 4; tick++) await Promise.resolve();
    assert.equal(sources.length, replacement === 'none' ? 1 : 0);
    if (replacement === 'none') assert.equal(sources[0], next);
    assert.equal(context.preparingNext, null);
  }
});
