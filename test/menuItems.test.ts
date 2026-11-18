import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

import { MenuItemRegistry } from '../src/lib/menuItems';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const option = (action: () => void, keepOpen = false) => ({ tag: 42, enabled: true, selected: false, keepOpen, action });

test('one explicit option activates once and retains its caller-owned exit', () => {
  const r = new MenuItemRegistry(), owner = {};
  let chosen = 0, mounted = true;
  r.setSession(11, true);
  r.register('choice', owner, option(() => { chosen++; }));
  assert.equal(r.select({ sessionId: 11, rowId: 'choice', gestureId: 1 }), true);
  assert.equal(chosen, 1); assert.equal(mounted, true, 'selection must not unmount its visual shell');
  assert.equal(r.select({ sessionId: 11, rowId: 'choice', gestureId: 1 }), false);
  assert.equal(r.press('choice', owner), false, 'a second RN/native delivery cannot repeat the closing action');
  r.setSession(11, false); mounted = false;
  assert.equal(r.select({ sessionId: 11, rowId: 'choice', gestureId: 2 }), false);
});

test('keep-open options accept successive gestures exactly once while replacement and disposal reject old events', () => {
  const r = new MenuItemRegistry(), owner = {}; let chosen = 0;
  r.setSession(21, true); r.register('speed', owner, option(() => chosen++, true));
  const event = { sessionId: 21, rowId: 'speed', gestureId: 4 };
  assert.equal(r.select(event), true); assert.equal(r.select(event), false);
  assert.equal(r.select({ ...event, gestureId: 5 }), true); assert.equal(chosen, 2);
  r.setSession(22, true);
  assert.equal(r.select({ ...event, gestureId: 6 }), false);
  assert.equal(r.select({ ...event, sessionId: 22, gestureId: 1 }), true);
  r.dispose();
  assert.equal(r.select({ ...event, sessionId: 22, gestureId: 2 }), false);
  assert.equal(chosen, 3);
});

test('disabled, removed and replaced rows cannot be selected; callback-only updates do not republish geometry', () => {
  const r = new MenuItemRegistry(), owner = {}, replacement = {}; let chosen = 0, published = 0;
  r.setSession(1, true); r.subscribe(() => published++);
  r.register('row', owner, option(() => chosen++));
  r.register('row', owner, option(() => chosen += 10));
  assert.equal(published, 1);
  r.register('row', owner, { ...option(() => chosen++), enabled: false });
  assert.equal(r.select({ sessionId: 1, rowId: 'row', gestureId: 1 }), false);
  r.unregister('row', owner);
  r.register('row', replacement, option(() => chosen += 100));
  r.unregister('row', owner);
  assert.equal(r.press('row', owner), false);
  assert.equal(r.press('row', replacement), true); assert.equal(chosen, 100);
});

test('bounded native descriptors retain an ordinary RN path beyond their limit and never retain View instances', () => {
  const r = new MenuItemRegistry(); r.setSession(1, true);
  const owners = Array.from({ length: 300 }, () => ({})); let chosen = 0;
  for (let i = 0; i < 300; i++) r.register(String(i), owners[i], option(() => chosen++));
  assert.equal(r.getSnapshot().length, 256);
  assert.equal(r.press('256', owners[256]), true); assert.equal(chosen, 1);
  assert.equal(r.press('255', owners[255]), false, 'the native cap cannot bypass the same closing gate');
  r.setSession(2, true);
  r.unregister('256', owners[256]);
  assert.equal(r.press('256', owners[256]), false);
  const replacement = {}; r.register('256', replacement, option(() => chosen += 10));
  assert.equal(r.press('256', owners[256]), false);
  assert.equal(r.press('256', replacement), true); assert.equal(chosen, 11);
  assert.deepEqual(Object.keys(r.getSnapshot()[0]).sort(), ['enabled', 'fullWidth', 'id', 'keepOpen', 'selected', 'tag']);
});

function wrapper() {
  const exports: Record<string, any> = {};
  const deps: Record<string, any> = { react: React, 'react/jsx-runtime': JSX,
    'react-native': { Pressable: 'Pressable', findNodeHandle: (node: { tag: number }) => node.tag },
    '@/lib/menuItems': { MenuItemRegistry } };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/MenuMorphItem.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (id: string) => { assert.ok(id in deps, id); return deps[id]; } });
  return exports;
}

test('real opt-in row preserves ref, accessibility, normal presses and latest handler without registering arbitrary siblings', async () => {
  const { MenuMorphItem, MenuItemsContext } = wrapper(), registry = new MenuItemRegistry();
  registry.setSession(9, true);
  let root!: ReactTestRenderer, chosen = 0; const ref = React.createRef<any>();
  const body = (disabled = false) => React.createElement(MenuItemsContext.Provider, { value: registry },
    React.createElement(MenuMorphItem, { ref, menuItemId: 'speed', keepOpen: true, fullWidth: false, disabled,
      accessibilityRole: 'radio', accessibilityLabel: 'Speed', selected: true, onPress: () => chosen++ }, '1.5×'),
    React.createElement('Input', { value: 'never a menu row' }));
  try {
    await act(async () => { root = create(body(), { createNodeMock: () => ({ tag: 70 }) }); });
    assert.equal(ref.current.tag, 70); assert.equal(registry.getSnapshot().length, 1);
    const row = root.root.findByType('Pressable' as any);
    assert.equal(row.props.accessibilityRole, 'radio'); assert.equal(row.props.accessibilityLabel, 'Speed');
    assert.equal(registry.getSnapshot()[0].fullWidth, false);
    await act(async () => row.props.onPress()); assert.equal(chosen, 1);
    await act(async () => { registry.select({ sessionId: 9, rowId: 'speed', gestureId: 1 }); });
    await act(async () => { registry.select({ sessionId: 9, rowId: 'speed', gestureId: 1 }); }); assert.equal(chosen, 2);
    await act(async () => root.update(body(true)));
    assert.equal(registry.select({ sessionId: 9, rowId: 'speed', gestureId: 2 }), false);
  } finally { await act(async () => root?.unmount()); }
  assert.equal(registry.getSnapshot().length, 0); assert.equal(ref.current, null);
});
