import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { createMenuOriginTracker } from '../src/lib/menuOriginState';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('opening consumes the point fallback immediately and late native geometry cannot revive it', async () => {
  const measured = deferred<unknown>();
  const tracker = createMenuOriginTracker(() => measured.promise, () => 100);
  tracker.start({ x: 100, y: 200 }, 1);
  assert.deepEqual(tracker.take(), [78, 178, 44, 44, 22]);
  measured.resolve([70, 170, 80, 80, 40]); await settle();
  assert.equal(tracker.take(), null);
});

test('native full-button bounds replace the descendant seed, with bounded touch size and radius', async () => {
  const tracker = createMenuOriginTracker(async () => [70, 180, 120, 40, 50], () => 100);
  tracker.start({ x: 100, y: 200 }, 1); await settle();
  assert.deepEqual(tracker.take(), [70, 178, 120, 44, 22]);
  assert.equal(tracker.take(), null, 'one press belongs to one menu');
});

test('only an explicit button identity survives immediate consumption and cannot be replaced by late geometry', async () => {
  const first = deferred<unknown>(), second = deferred<unknown>();
  const tracker = createMenuOriginTracker((tag) => tag === 40 ? first.promise : second.promise, () => 100);
  tracker.start({ x: 100, y: 200 }, 40, true);
  assert.deepEqual(tracker.take(), [78, 178, 44, 44, 22, 40], 'fast open receives the exact tag before async measurement');
  tracker.start({ x: 300, y: 400 }, 60, true);
  first.resolve([270, 370, 60, 60, 30, 999]); await settle();
  second.resolve([270, 370, 60, 60, 30, 888]); await settle();
  assert.deepEqual(tracker.take(), [270, 370, 60, 60, 30, 60], 'an earlier result or an untrusted measurement tag cannot replace ownership');
  assert.equal(tracker.take(), null);
});

test('generic or implicit origins never authorize hidden-source capture, including a new ordinary touch after a menu trigger', async () => {
  const tracker = createMenuOriginTracker(async () => [80, 180, 44, 44, 22, 900], () => 100);
  tracker.start({ x: 100, y: 200 }, 40, true);
  tracker.start({ x: 100, y: 200 }, 50); await settle();
  assert.deepEqual(tracker.take(), [80, 180, 44, 44, 22]);
  tracker.start({ x: 100, y: 200 }, Number.MAX_SAFE_INTEGER + 1, true);
  assert.deepEqual(tracker.take(), [78, 178, 44, 44, 22]);
});

test('superseded measurements, source clears and expired presses never contaminate another menu', async () => {
  let now = 100;
  const first = deferred<unknown>(), second = deferred<unknown>();
  const tracker = createMenuOriginTracker((tag) => tag === 1 ? first.promise : second.promise, () => now);
  tracker.start({ x: 50, y: 50 }, 1); tracker.start({ x: 300, y: 400 }, 2);
  first.resolve([25, 25, 50, 50, 25]); second.resolve([270, 370, 60, 60, 30]); await settle();
  assert.deepEqual(tracker.take(), [270, 370, 60, 60, 30]);
  tracker.start({ x: 10, y: 20 }); now += 1201;
  assert.equal(tracker.take(), null);
  tracker.start({ x: 20, y: 30 }); now -= 1;
  assert.equal(tracker.take(), null, 'clock rollback cannot extend ownership');
  tracker.start({ x: 25, y: 35 }); tracker.clear(); assert.equal(tracker.take(), null);
});

test('scrolling invalidates a source and any outstanding measurement without eating a small press movement', async () => {
  const native = deferred<unknown>(); const tracker = createMenuOriginTracker(() => native.promise, () => 100);
  tracker.start({ x: 10, y: 20 }, 1); tracker.move({ x: 10, y: 33 });
  native.resolve([0, 0, 44, 44]); await settle(); assert.equal(tracker.take(), null);
  tracker.start({ x: 10, y: 20 }); tracker.move({ x: 15, y: 23 });
  assert.deepEqual(tracker.take(), [-12, -2, 44, 44, 22]);
});

test('unrelated, malformed or rejected native measurements keep the valid fallback; invalid points never create one', async () => {
  for (const measured of [[0, 0, 400, 900], [900, 900, 40, 40], [10, 20, NaN, 50], null]) {
    const tracker = createMenuOriginTracker(async () => measured, () => 100);
    tracker.start({ x: 30, y: 40 }, 1); await settle();
    assert.deepEqual(tracker.take(), [8, 18, 44, 44, 22]);
  }
  const tracker = createMenuOriginTracker(async () => { throw new Error('detached'); }, () => 100);
  tracker.start({ x: 30, y: 40 }, 1); await settle(); assert.ok(tracker.take());
  tracker.start({ x: Infinity, y: 20 }); assert.equal(tracker.take(), null);
});

function adapter() {
  const requests: number[] = [];
  const native = deferred<unknown>();
  const source = readFileSync(new URL('../src/lib/menuOrigin.ts', import.meta.url), 'utf8');
  const exports: Record<string, any> = {};
  const imports: Record<string, unknown> = {
    'react-native': { findNodeHandle: (value: { tag?: number }) => value.tag ?? null, UIManager: {} },
    '../../modules/liquid-glass': { measureNativeMenuOrigin: async (tag: number) => { requests.push(tag); return native.promise; } },
    './menuOriginState': { createMenuOriginTracker },
  };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require(name: string) { assert.ok(name in imports, name); return imports[name]; }, setTimeout, clearTimeout, Promise,
  });
  return { api: exports, native, requests };
}
function event(target = 7, currentTarget: unknown = { tag: 99 }) {
  return { nativeEvent: { pageX: 100, pageY: 200, target, touches: [{}], changedTouches: [{}] }, currentTarget };
}

test('root capture measures the touched descendant while a control press-in promotes its own host', async () => {
  const h = adapter(), press = event();
  h.api.captureMenuTouchStart(press); await settle(); assert.deepEqual(h.requests, [7]);
  h.api.captureMenuTrigger(press, { tag: 44 }); await settle(); assert.deepEqual(h.requests, [7, 44]);
  // React may recycle the event before the native request comes back.
  press.nativeEvent.pageY = 900; press.nativeEvent.target = 888;
  h.native.resolve([80, 180, 44, 44, 22]); await settle();
  assert.deepEqual(Array.from(h.api.takeMenuOrigin()), [80, 180, 44, 44, 22, 44]);
});

test('event currentTarget alone retains geometry fallback but cannot authorize hiding the enclosing toolbar', async () => {
  const h = adapter(); h.api.captureMenuTrigger(event());
  await settle(); assert.deepEqual(h.requests, [99]);
  h.native.resolve([80, 180, 132, 44, 22]); await settle();
  assert.deepEqual(Array.from(h.api.takeMenuOrigin()), [80, 180, 132, 44, 22]);
});

test('touch release promotion works, while keyboard activation and multi-touch clear an unrelated origin', () => {
  const h = adapter();
  const release = event(); release.nativeEvent.touches = [];
  h.api.captureMenuTrigger(release); assert.ok(h.api.takeMenuOrigin());
  const keyboard = event(); keyboard.nativeEvent.touches = []; keyboard.nativeEvent.changedTouches = [];
  h.api.captureMenuTouchStart(event()); h.api.captureMenuTrigger(keyboard); assert.equal(h.api.takeMenuOrigin(), null);
  const multiple = event(); multiple.nativeEvent.touches = [{}, {}];
  h.api.captureMenuTouchStart(multiple); assert.equal(h.api.takeMenuOrigin(), null);
});

test('GlassPressable delegates original props and ref to the exact trigger wrapper without adding material', () => {
  const text = readFileSync(new URL('../src/components/glass/index.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('glass.tsx', text, ts.ScriptTarget.Latest, true);
  const statement = file.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(file) === 'GlassPressable'));
  assert.ok(statement);
  const calls: unknown[] = [], exports: Record<string, any> = {};
  const jsx = (type: unknown, props: object) => ({ type, props });
  runInNewContext(ts.transpileModule(statement.getText(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, forwardRef: (render: unknown) => render, MenuTriggerPressable: 'MenuTriggerPressable',
    require(name: string) { assert.equal(name, 'react/jsx-runtime'); return { jsx }; },
    MATERIAL_PROPS: ['variant', 'radius'],
  });
  const press = () => {}, pressIn = (value: unknown) => { calls.push(value); }, ref = {}, style = { color: 'red' };
  const result = exports.GlassPressable({ onPress: press, onPressIn: pressIn, style, disabled: true, variant: 'subtle', radius: 20, buttonMaterial: true }, ref);
  assert.equal(result.type, 'MenuTriggerPressable');
  assert.equal(result.props.ref, ref); assert.equal(result.props.onPress, press); assert.equal(result.props.style, style); assert.equal(result.props.disabled, true);
  assert.equal(result.props.onPressIn, pressIn, 'capture belongs to one shared trigger wrapper, not two nested press-in handlers');
  assert.equal('variant' in result.props, false); assert.equal('radius' in result.props, false); assert.equal('buttonMaterial' in result.props, false);
  const input = event(); result.props.onPressIn(input); assert.deepEqual(calls, [input]);
});
