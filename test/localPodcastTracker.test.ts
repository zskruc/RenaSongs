import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { createStore } from 'zustand/vanilla';
import ts from 'typescript';
import { episodePlayed } from '../src/lib/episodeResume';
test('the actual local podcast tracker saves accepted progress without timers, respects manual marks and rejects a stale profile source', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const song = { id: 'local', title: 'Episode', mediaKind: 'podcast' }, calls: any[] = [];
  let now = 0, epoch = 0, version = 0, accepted = false, intervals = 0, onBackground: ((state: string) => void) | undefined;
  const player = createStore<any>(() => ({ queue: [song], index: 0, positionSec: 0, durationSec: 100, isPlaying: true, isBuffering: false }));
  const imports = { react: React, 'react-native': { AppState: { addEventListener: (_name: string, fn: (state: string) => void) => { onBackground = fn; return { remove: () => { onBackground = undefined; } }; } } },
    '@/lib/currentContentKind': { getSongContentKind: (song: any) => song.mediaKind ?? 'music' }, '@/lib/episodeResume': { episodePlayed },
    '@/lib/localCustomizations': { customizationScope: () => ({}), captureCustomizationOwner: () => { const token = epoch; return () => token === epoch; } },
    '@/store/localPodcasts': { localPodcastProgressVersion: () => version, saveLocalPodcastProgress: async (...args: any[]) => { calls.push(args); } },
    '@/store/player': { usePlayerStore: player, longAudioPlaybackSample: () => { const s = player.getState(); return accepted ? { song: s.queue[s.index], position: s.positionSec, duration: s.durationSec, playing: s.isPlaying, buffering: s.isBuffering } : undefined; } } };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/LocalPodcastTracker.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date: { now: () => now }, setInterval: () => { intervals++; }, require: (key: string) => { assert.ok(Object.hasOwn(imports, key), key); return imports[key as keyof typeof imports]; } });
  let view!: ReturnType<typeof create>; await act(async () => { view = create(React.createElement(exports.LocalPodcastTracker)); });
  assert.equal(calls.length, 0); accepted = true; player.setState({ positionSec: 0 }); assert.equal(calls.length, 0, 'initial position zero must not erase a saved resume');
  now = 1000; player.setState({ positionSec: 1 }); now = 2000; player.setState({ positionSec: 2 }); assert.equal(calls.length, 1);
  now = 3000; player.setState({ isPlaying: false }); assert.equal(calls.length, 2); assert.equal(calls[1][1].positionSec, 2);
  version++; now = 20_000; player.setState({ positionSec: 3, isPlaying: true }); onBackground?.('background'); assert.equal(calls.length, 2, 'manual played/unplayed mark blocks stale accepted-load writes');
  player.setState({ queue: [song], positionSec: 4 }); assert.equal(calls.length, 3, 'a deliberate fresh queue admits a new version');
  epoch++; accepted = false; player.setState({ positionSec: 90 }); onBackground?.('background'); assert.equal(calls.length, 3, 'old player state cannot save into a new profile');
  assert.equal(intervals, 0); await act(async () => { view.unmount(); }); assert.equal(onBackground, undefined);
});
