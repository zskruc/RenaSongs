import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

import { MenuMorphSession } from '../src/lib/menuMorph';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('exit completes once and cannot be overwritten by repeated presses or an opening acknowledgement', () => {
  const session = new MenuMorphSession(); const calls: string[] = [];
  const id = session.begin();
  assert.equal(session.close(() => calls.push('first')), true);
  assert.equal(session.close(() => calls.push('second')), false);
  assert.equal(session.complete(id, true), false);
  assert.deepEqual(calls, []);
  assert.equal(session.complete(id, false), true);
  assert.equal(session.complete(id, false), false);
  assert.deepEqual(calls, ['first']);
});

test('reopen, replacement and unmount invalidate old native acknowledgements and destructive callbacks', () => {
  const session = new MenuMorphSession(); let removed = 0;
  const first = session.begin(); session.close(() => removed++);
  const next = session.begin();
  assert.notEqual(first, next); assert.equal(session.complete(first, false), false);
  assert.equal(session.complete(next, true), true);
  assert.equal(session.phase, 'open'); assert.equal(removed, 0);
  session.close(() => removed++); session.invalidate();
  assert.equal(session.complete(next, false), false); assert.equal(removed, 0);
  session.begin(); session.close({ nativeEvent: {} });
  assert.doesNotThrow(() => session.complete(session.id, false));
});

function harness(native = true) {
  const callbacks: (() => void)[] = []; let consumed = 0; let hook: any;
  const dependencies: Record<string, any> = {
    react: React,
    'react-native': { Dimensions: { get: () => ({ height: 900 }) } },
    'react-native-gesture-handler': { Gesture: { Pan: () => new Proxy({}, { get: (_target, name) => name === 'then' ? undefined : () => dependencies['react-native-gesture-handler'].Gesture.Pan() }) } },
    'react-native-reanimated': {
      cancelAnimation() {}, useSharedValue: (value: unknown) => React.useRef({ value }).current,
      useAnimatedStyle: (style: () => unknown) => style(),
      withSpring: (value: number, _config: object, done?: (finished: boolean) => void) => { if (done) callbacks.push(() => done(true)); return value; },
      withTiming: (value: number, _config: object, done?: (finished: boolean) => void) => { if (done) callbacks.push(() => done(true)); return value; },
    },
    'react-native-worklets': { scheduleOnRN: (call: (...args: any[]) => void, ...args: any[]) => call(...args) },
    '../../modules/liquid-glass': { isMenuMorphAvailable: native },
    '@/lib/menuMorph': { MenuMorphSession },
    '@/lib/menuOrigin': { takeMenuOrigin: () => { consumed++; return [10, 20, 44, 44, 22]; } },
    '@/theme/motion': { SHEET_IN: { duration: 240 }, SHEET_OUT: { duration: 160 }, motion: { reduceMotion: { essential: 0 } } },
  };
  const api: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/hooks/useBottomSheetAnim.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: api, require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  function Probe({ open, identity = 1, onClose }: { open: boolean; identity?: number; onClose: () => void }) {
    hook = api.useBottomSheetAnim(open, onClose, 'card', identity);
    return React.createElement('Probe', { motion: hook.motion });
  }
  const event = (sessionId: number, open: boolean) => ({ nativeEvent: { sessionId, open } });
  return { Probe, callbacks, event, get hook() { return hook; }, get consumed() { return consumed; } };
}

test('native card waits for actual window/layout acknowledgement and its own completed exit', async () => {
  const h = harness(); let root!: ReactTestRenderer; let closes = 0;
  try {
    await act(async () => { root = create(React.createElement(h.Probe, { open: true, onClose: () => closes++ })); });
    const id = h.hook.motion.sessionId;
    assert.equal(h.consumed, 1); assert.equal(h.hook.motion.ready, false);
    assert.equal(h.callbacks.length, 0, 'native open is not spent on a JS timer before Modal shows');
    await act(async () => h.hook.onModalShow()); assert.equal(h.hook.motion.ready, true);
    await act(async () => h.hook.motion.onMotionComplete(h.event(id, true)));
    await act(async () => { h.hook.dismiss({ nativeEvent: {} }); h.hook.dismiss(); });
    assert.equal(h.hook.motion.open, false); assert.equal(closes, 0);
    await act(async () => h.hook.motion.onMotionComplete(h.event(id + 900, false))); assert.equal(closes, 0);
    await act(async () => { h.hook.motion.onMotionComplete(h.event(id, false)); h.hook.motion.onMotionComplete(h.event(id, false)); });
    assert.equal(closes, 1);
  } finally { await act(async () => root?.unmount()); }
});

test('replacement during close ignores the preceding native completion and uses the new callback', async () => {
  const h = harness(); let root!: ReactTestRenderer; const actions: string[] = [];
  try {
    await act(async () => { root = create(React.createElement(h.Probe, { open: true, onClose: () => actions.push('old') })); });
    const old = h.hook.motion.sessionId;
    await act(async () => h.hook.dismiss());
    await act(async () => root.update(React.createElement(h.Probe, { open: true, identity: 2, onClose: () => actions.push('new') })));
    const next = h.hook.motion.sessionId;
    assert.notEqual(old, next); assert.equal(h.consumed, 2);
    await act(async () => h.hook.motion.onMotionComplete(h.event(old, false))); assert.deepEqual(actions, []);
    await act(async () => h.hook.dismiss());
    await act(async () => h.hook.motion.onMotionComplete(h.event(next, false))); assert.deepEqual(actions, ['new']);
  } finally { await act(async () => root?.unmount()); }
});

test('older native builds retain a working animated exit without waiting for an unavailable host', async () => {
  const h = harness(false); let root!: ReactTestRenderer; let closed = 0;
  try {
    await act(async () => { root = create(React.createElement(h.Probe, { open: true, onClose: () => closed++ })); });
    assert.equal(h.callbacks.length, 1);
    await act(async () => h.callbacks.shift()!());
    await act(async () => h.hook.dismiss()); assert.equal(closed, 0);
    await act(async () => h.callbacks.shift()!()); assert.equal(closed, 1);
    assert.ok(h.hook.motion.fallbackStyle);
  } finally { await act(async () => root?.unmount()); }
});
