import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function harness() {
  const captures: { event: unknown; host: unknown }[] = [];
  const exports: Record<string, any> = {};
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSX,
    'react-native': { Pressable: 'Pressable' },
    '@/lib/menuOrigin': { captureMenuTrigger: (event: unknown, host: unknown) => captures.push({ event, host }) },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/MenuTriggerPressable.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { Button: exports.MenuTriggerPressable, captures };
}

test('three buttons in one toolbar capture their own native hosts, never the shared responder or icon', async () => {
  const { Button, captures } = harness();
  const controls = ['sort', 'download', 'more'];
  const hosts = controls.map((id, tag) => ({ id, tag: tag + 11 }));
  const refs = controls.map(() => React.createRef<any>());
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(React.createElement('Toolbar', {}, ...controls.map((id, index) =>
      React.createElement(Button, { key: id, ref: refs[index], testID: id, accessibilityRole: 'button' }, id))), {
      createNodeMock: (element) => hosts.find((host) => host.id === (element.props as { testID?: string }).testID) ?? { tag: 999 },
    }); });
    const buttons = tree.root.findAllByType('Pressable' as any);
    assert.equal(buttons.length, 3);
    buttons.forEach((button, index) => {
      const event = { currentTarget: { tag: 999 }, nativeEvent: { target: 888, pageX: 100, pageY: 50 } };
      button.props.onPressIn(event);
      assert.equal(captures[index].event, event);
      assert.equal(captures[index].host, hosts[index]);
      assert.equal(refs[index].current, hosts[index]);
      assert.equal(button.props.collapsable, false, 'Fabric must retain an individual host for the anchor');
    });
  } finally { await act(async () => tree?.unmount()); }
  refs.forEach((ref) => assert.equal(ref.current, null));
});

test('exact source binding preserves styling, accessibility, handlers and callback-ref cleanup', async () => {
  const { Button, captures } = harness();
  const host = { tag: 22 }, events: unknown[] = [];
  const style = { height: 44, width: 44 }, hitSlop = { left: 8, right: 8 };
  let cleaned = 0, mounted: unknown, tree!: ReactTestRenderer;
  const ref = (value: unknown) => { mounted = value; return () => { cleaned++; }; };
  const onPress = (event: unknown) => { events.push(event); };
  try {
    await act(async () => { tree = create(React.createElement(Button, { ref, style, hitSlop, disabled: false,
      accessibilityRole: 'button', accessibilityLabel: 'Sort', onPress, onPressIn: (event: unknown) => events.push(event) }), {
      createNodeMock: () => host,
    }); });
    const button = tree.root.findByType('Pressable' as any);
    assert.equal(mounted, host); assert.equal(button.props.style, style); assert.equal(button.props.hitSlop, hitSlop);
    assert.equal(button.props.accessibilityLabel, 'Sort'); assert.equal(button.props.disabled, false);
    assert.equal(button.props.onPress, onPress);
    const press = { nativeEvent: { target: 99 } };
    button.props.onPressIn(press); button.props.onPress(press);
    assert.equal(captures.length, 1); assert.equal(captures[0].host, host);
    assert.deepEqual(events, [press, press]);
  } finally { await act(async () => tree?.unmount()); }
  assert.equal(cleaned, 1, 'React 19 callback-ref cleanup must be retained');
});
