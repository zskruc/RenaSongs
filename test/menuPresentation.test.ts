import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

import { MenuMorphSession } from '../src/lib/menuMorph';
import { MenuPresentationRegistry } from '../src/lib/menuPresentation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('presentation leases are idempotent per owner and publish only aggregate visibility transitions', () => {
  const registry = new MenuPresentationRegistry(), first = {}, second = {};
  const visibility: boolean[] = [];
  const unsubscribe = registry.subscribe(() => visibility.push(registry.getSnapshot()));
  assert.equal(registry.getSnapshot(), false);
  registry.begin(first, 1); registry.begin(first, 1); registry.begin(first, 2);
  assert.deepEqual(visibility, [true]);
  assert.equal(registry.end(first, 1), false, 'a replacement still owns its own lease');
  registry.begin(second, 3);
  assert.equal(registry.end(first, 2), true);
  assert.equal(registry.end(first, 2), false);
  assert.equal(registry.getSnapshot(), true, 'an overlapping owner still covers the app');
  assert.equal(registry.end(second, 3), true);
  assert.deepEqual(visibility, [true, false]);
  unsubscribe(); registry.begin(first, 4); registry.end(first, 4);
  assert.deepEqual(visibility, [true, false], 'removed subscribers receive no later updates');
});

test('closing retains menu activity until its exact completed exit and acknowledges it only once', () => {
  const registry = new MenuPresentationRegistry(), session = new MenuMorphSession(registry);
  let callbacks = 0;
  const id = session.begin();
  assert.equal(registry.getSnapshot(), true);
  assert.equal(session.complete(id, true), true);
  assert.equal(registry.getSnapshot(), true, 'opening completion does not release a visible menu');
  assert.equal(session.close(() => callbacks++), true);
  assert.equal(session.close(() => callbacks++), false);
  assert.equal(registry.getSnapshot(), true, 'dismiss requests cannot resume the covered marquee early');
  assert.equal(session.complete(id + 1, false), false);
  assert.equal(session.complete(id, true), false);
  assert.equal(registry.getSnapshot(), true);
  assert.equal(session.complete(id, false), true);
  assert.equal(registry.getSnapshot(), false);
  assert.equal(session.complete(id, false), false);
  assert.equal(callbacks, 1);
});

test('replacement, overlapping owners and invalidation cannot be released by stale native completion', () => {
  const registry = new MenuPresentationRegistry();
  const first = new MenuMorphSession(registry), second = new MenuMorphSession(registry);
  const visibility: boolean[] = [];
  registry.subscribe(() => visibility.push(registry.getSnapshot()));
  let abandonedActions = 0;
  const old = first.begin(); first.close(() => abandonedActions++);
  const replacement = first.begin();
  assert.equal(first.complete(old, false), false);
  assert.equal(registry.getSnapshot(), true);
  assert.deepEqual(visibility, [true], 'replacement must not briefly resume an obscured animation');
  const overlap = second.begin(); second.close(() => abandonedActions++);
  first.invalidate(); first.invalidate();
  assert.equal(first.complete(replacement, false), false);
  assert.equal(registry.getSnapshot(), true, 'invalidating one owner cannot clear another');
  second.invalidate();
  assert.equal(second.complete(overlap, false), false);
  assert.equal(registry.getSnapshot(), false);
  assert.deepEqual(visibility, [true, false]);
  assert.equal(abandonedActions, 0);
});

test('an exit callback may reopen its owner without an old acknowledgement releasing the new menu', () => {
  const registry = new MenuPresentationRegistry(), session = new MenuMorphSession(registry);
  const first = session.begin();
  let next = 0;
  session.close(() => { next = session.begin(); });
  assert.equal(session.complete(first, false), true);
  assert.notEqual(next, first);
  assert.equal(registry.getSnapshot(), true);
  assert.equal(session.complete(first, false), false);
  assert.equal(registry.getSnapshot(), true);
  session.invalidate();
  const failed = session.begin();
  session.close(() => { throw new Error('action failed'); });
  assert.throws(() => session.complete(failed, false), /action failed/);
  assert.equal(registry.getSnapshot(), false, 'a failed after-exit action cannot leak the retired owner');
});

test('the actual useSyncExternalStore hook changes only at aggregate menu boundaries and unsubscribes on unmount', async () => {
  const registry = new MenuPresentationRegistry();
  const dependencies: Record<string, unknown> = { react: React, '@/lib/menuPresentation': { menuPresentations: registry } };
  const api: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/hooks/useMenuPresentationActive.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: api, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected menu activity import ${name}`);
    return dependencies[name];
  } });
  const first = {}, second = {}, observed: boolean[] = [];
  let root!: ReactTestRenderer;
  function Activity({ active }: { active: boolean }) {
    return React.createElement('span', { 'data-active': active });
  }
  function Probe() {
    const active = api.useMenuPresentationActive();
    observed.push(active);
    return React.createElement(Activity, { active });
  }
  try {
    await act(async () => { root = create(React.createElement(Probe)); });
    assert.equal(root.root.findByType(Activity).props.active, false);
    await act(async () => registry.begin(first, 1));
    assert.equal(root.root.findByType(Activity).props.active, true);
    const coveredRenders = observed.length;
    await act(async () => { registry.begin(first, 1); registry.begin(first, 2); registry.begin(second, 3); registry.end(first, 1); });
    assert.equal(observed.length, coveredRenders, 'same/overlapping owner updates need no extra Fabric commit');
    await act(async () => { registry.end(first, 2); });
    assert.equal(observed.length, coveredRenders);
    await act(async () => { registry.end(second, 3); });
    assert.equal(root.root.findByType(Activity).props.active, false);
    await act(async () => root.unmount());
    const unmountedRenders = observed.length;
    await act(async () => { registry.begin(first, 4); registry.end(first, 4); });
    assert.equal(observed.length, unmountedRenders);
  } finally { if (root) await act(async () => root.unmount()); }
});
