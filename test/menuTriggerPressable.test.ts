import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { createMenuOriginTracker } from '../src/lib/menuOriginState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function harness(nativeGroup = true, origin?: Record<string, any>) {
  const captures: { event: unknown; host: unknown; group: unknown }[] = [];
  const activations: { event: unknown; host: unknown; group: unknown }[] = [];
  const exports: Record<string, any> = {};
  const dependencies: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': JSX,
    'react-native': { Pressable: 'Pressable' },
    '../../modules/liquid-glass': { isMenuTriggerGroupAvailable: nativeGroup, MenuTriggerGroupView: 'NativeMenuTriggerGroup' },
    '@/lib/menuOrigin': {
      captureMenuTrigger: (event: unknown, host: unknown, group: unknown) => {
        captures.push({ event, host, group }); origin?.captureMenuTrigger(event, host, group);
      },
      captureMenuTriggerActivation: (event: unknown, host: unknown, group: unknown) => {
        activations.push({ event, host, group }); origin?.captureMenuTriggerActivation(event, host, group);
      },
    },
  };
  const group: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/MenuTriggerGroup.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: group, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  dependencies['./MenuTriggerGroup'] = group;
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/MenuTriggerPressable.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { Button: exports.MenuTriggerPressable, Group: group.MenuTriggerGroup, captures, activations };
}

function nativeGroupBridge(platform: string, supported: boolean) {
  const requested: (string | undefined)[] = [], api: Record<string, any> = {};
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (style === 42) return { height: 44, backgroundColor: '#223344', borderRadius: 999 };
    if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean).map(flatten));
    return style as Record<string, unknown> | undefined;
  };
  const dependencies: Record<string, any> = {
    react: { ...React, __esModule: true, default: React }, 'react/jsx-runtime': JSX,
    'react-native': { Platform: { OS: platform }, View: 'View', StyleSheet: { flatten },
      processColor: (value: unknown) => typeof value === 'string' ? 0x33223344 : value },
    expo: { requireOptionalNativeModule: () => ({ isSupported: true, menuTriggerGroupSupported: supported }),
      requireNativeView: (_module: string, name?: string) => { requested.push(name); return name ?? 'Material'; } },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../modules/liquid-glass/index.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: api, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { api, requested };
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
      assert.equal(captures[index].group, undefined, 'ordinary toolbars are never inferred to be source groups');
      assert.equal(refs[index].current, hosts[index]);
      assert.equal(button.props.collapsable, false, 'Fabric must retain an individual host for the anchor');
    });
  } finally { await act(async () => tree?.unmount()); }
  refs.forEach((ref) => assert.equal(ref.current, null));
});

test('an explicitly opted-in whole toolbar retains each button as through and captures one shared native group', async () => {
  const { Button, Group, captures } = harness();
  const source = { tag: 100 }, sourceRef = React.createRef<any>();
  const controls = ['sort', 'download', 'more'];
  const hosts = controls.map((id, index) => ({ id, tag: 11 + index }));
  const style = [{ height: 44, flexDirection: 'row' }, { backgroundColor: 'rgba(1,2,3,0.2)' }];
  const presses: string[] = [];
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(React.createElement(Group, { ref: sourceRef, style, testID: 'whole-toolbar' },
      ...controls.map((id) => React.createElement(Button, { key: id, testID: id, accessibilityLabel: id,
        onPress: () => presses.push(id) }, id))), {
      createNodeMock: (element) => element.type === 'NativeMenuTriggerGroup' ? source
        : hosts.find((host) => host.id === (element.props as { testID?: string }).testID),
    }); });
    const native = tree.root.findByType('NativeMenuTriggerGroup' as any);
    assert.equal(native.props.style, style, 'grouping cannot change the current background, dimensions or layout');
    assert.equal(native.props.collapsable, false);
    assert.equal(sourceRef.current, source);
    tree.root.findAllByType('Pressable' as any).forEach((button, index) => {
      const event = { currentTarget: { tag: 999 }, nativeEvent: { target: 888 } };
      button.props.onPressIn(event); button.props.onPress(event);
      assert.equal(captures[index].host, hosts[index], 'the source group must not replace the exact pressed button');
      assert.equal(captures[index].group, source, 'all three icons belong to the one explicitly registered group');
    });
    assert.deepEqual(presses, controls, 'real actions still execute once on their original Pressable path');
  } finally { await act(async () => tree?.unmount()); }
  assert.equal(sourceRef.current, null);
});

test('nested explicit groups choose their nearest owner and unsupported APKs never authorize a whole row', async () => {
  for (const nativeGroup of [true, false]) {
    const { Button, Group, captures } = harness(nativeGroup);
    const outer = { tag: 101 }, inner = { tag: 202 }, first = { tag: 11 }, second = { tag: 22 };
    let tree!: ReactTestRenderer;
    try {
      await act(async () => { tree = create(React.createElement(Group, { testID: 'outer' },
        React.createElement(Button, { testID: 'first' }),
        React.createElement(Group, { testID: 'inner' }, React.createElement(Button, { testID: 'second' }))), {
        createNodeMock: (element) => ({ outer, inner, first, second }[(element.props as { testID: 'outer' | 'inner' | 'first' | 'second' }).testID]),
      }); });
      const buttons = tree.root.findAllByType('Pressable' as any);
      buttons.forEach((button) => button.props.onPressIn({ nativeEvent: {} }));
      assert.equal(captures[0].host, first); assert.equal(captures[1].host, second);
      assert.equal(captures[0].group, nativeGroup ? outer : undefined);
      assert.equal(captures[1].group, nativeGroup ? inner : undefined);
    } finally { await act(async () => tree?.unmount()); }
  }
});

test('detaching a group clears its native refs before any late press-in can capture a recycled toolbar', async () => {
  const { Button, Group, captures } = harness();
  const group = { tag: 100 }, button = { tag: 11 };
  let tree!: ReactTestRenderer, pressIn!: (event: unknown) => void;
  await act(async () => { tree = create(React.createElement(Group, {}, React.createElement(Button)), {
    createNodeMock: (element) => element.type === 'NativeMenuTriggerGroup' ? group : button,
  }); });
  pressIn = tree.root.findByType('Pressable' as any).props.onPressIn;
  await act(async () => tree.unmount());
  pressIn({ nativeEvent: {} });
  assert.equal(captures[0].host, null);
  assert.equal(captures[0].group, null, 'late callbacks retain no native source-group View after unmount');
});

test('the real native group bridge requires its own APK capability and preserves the ordinary View fallback', async () => {
  for (const [platform, supported] of [['android', false], ['android', true], ['web', true]] as const) {
    const { api, requested } = nativeGroupBridge(platform, supported);
    const available = platform === 'android' && supported;
    assert.equal(api.isMenuTriggerGroupAvailable, available);
    assert.equal(requested.includes('MenuTriggerGroup'), available,
      'an old APK cannot load a native View name that it never registered');
    const style = { height: 44, width: 132 }, ref = React.createRef<any>(), host = { tag: 23 };
    let tree!: ReactTestRenderer;
    try {
      await act(async () => { tree = create(React.createElement(api.MenuTriggerGroupView, { ref, style, testID: 'source' }), {
        createNodeMock: () => host,
      }); });
      const view = tree.root.findByType((available ? 'MenuTriggerGroup' : 'View') as any);
      assert.equal(view.props.style, style); assert.equal(view.props.testID, 'source');
      assert.equal(view.props.collapsable, false); assert.equal(ref.current, host);
    } finally { await act(async () => tree?.unmount()); }
    assert.equal(ref.current, null);
  }
});

test('group foreground takeover authorizes only an explicit static solid fill and resets when style gains another painted layer', async () => {
  const { api } = nativeGroupBridge('android', true);
  const cases: { style: unknown; expected: number | null }[] = [
    { style: [{ width: 132, height: 44 }, { backgroundColor: 'rgba(34,51,68,0.2)', borderRadius: 999 }], expected: 0x33223344 },
    { style: 42, expected: 0x33223344 },
    { style: { backgroundColor: 'transparent', borderRadius: 999, borderWidth: 0, elevation: 0, shadowOpacity: 0 }, expected: 0x33223344 },
    { style: { backgroundColor: '#223344', borderRadius: 999, borderTopLeftRadius: 48 }, expected: 0x33223344 },
    { style: { backgroundColor: '#223344', borderRadius: 4 }, expected: null },
    { style: { backgroundColor: '#223344', borderRadius: 999, borderTopLeftRadius: 4 }, expected: null },
    { style: { height: 44 }, expected: null },
    { style: { backgroundColor: { dynamic: { light: '#fff', dark: '#000' } } }, expected: null },
    { style: { backgroundColor: '#223344', borderRadius: 999, backgroundImage: 'linear-gradient(red,blue)' }, expected: null },
    { style: { backgroundColor: '#223344', borderRadius: 999, experimental_backgroundImage: [{ type: 'linearGradient' }] }, expected: null },
    { style: { backgroundColor: '#223344', borderRadius: 999, boxShadow: [{ offsetX: 0, offsetY: 1, color: '#000' }] }, expected: null },
    { style: { backgroundColor: '#223344', borderRadius: 999, borderTopWidth: 1 }, expected: null },
    { style: { backgroundColor: '#223344', borderRadius: 999, shadowOpacity: 0.2 }, expected: null },
    { style: { backgroundColor: '#223344', borderRadius: 999, elevation: 2 }, expected: null },
    { style: { backgroundColor: '#223344', borderRadius: 999, filter: [{ blur: 2 }] }, expected: null },
  ];
  let tree!: ReactTestRenderer;
  try {
    for (const { style, expected } of cases) {
      await act(async () => {
        const child = React.createElement(api.MenuTriggerGroupView, { style });
        if (tree) tree.update(child); else tree = create(child);
      });
      const view = tree.root.findByType('MenuTriggerGroup' as any);
      assert.equal(view.props.style, style, 'the actual toolbar visual style must stay untouched');
      assert.equal(view.props.sourceFillColor, expected, 'unknown or composite paint cannot be replaced by an invented solid source');
    }
  } finally { await act(async () => tree?.unmount()); }
});

test('real grouped activation refreshes a long-held press, handles keyboard/a11y refs and rejects moved or multi-touch origins', async () => {
  let now = 100;
  const origin: Record<string, any> = {};
  const dependencies: Record<string, any> = {
    'react-native': { findNodeHandle: (view: { tag?: number }) => view?.tag ?? null, UIManager: {} },
    '../../modules/liquid-glass': { measureNativeMenuOrigin: async () => [80, 180, 44, 44, 22] },
    './menuOriginState': { createMenuOriginTracker: (measure: (tag: number) => Promise<unknown>) => createMenuOriginTracker(measure, () => now) },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/menuOrigin.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: origin, setTimeout, clearTimeout, Promise,
    require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  const { Button, Group } = harness(true, origin);
  const source = { tag: 500 }, through = { tag: 40 };
  const selected: (unknown[] | null)[] = [];
  let tree!: ReactTestRenderer;
  const event = (touches = [{}], changedTouches = [{}], y = 200) => ({
    currentTarget: { tag: 999 }, nativeEvent: { pageX: 100, pageY: y, target: 888, touches, changedTouches },
  });
  try {
    await act(async () => { tree = create(React.createElement(Group, {}, React.createElement(Button, {
      onPress: () => { const rect = origin.takeMenuOrigin(); selected.push(rect ? Array.from(rect) : null); },
    })), { createNodeMock: (element) => element.type === 'NativeMenuTriggerGroup' ? source : through }); });
    const button = tree.root.findByType('Pressable' as any);
    button.props.onPressIn(event());
    now += 5000;
    assert.equal(origin.takeMenuOrigin(), null, 'old pointer leases genuinely expire during a long hold');
    button.props.onPress(event([], [{}]));
    assert.deepEqual(selected[0]?.slice(5), [40, 500], 'UP must restore exact source/through identity before the real action opens');
    button.props.onPressIn(event());
    origin.captureMenuTouchMove(event([{}], [{}], 240));
    assert.equal(origin.takeMenuOrigin(), null, 'a cancelled/moved gesture cannot leave a pending group source');
    assert.equal(selected.length, 1, 'no actual onPress means no cancelled-pointer action');
    button.props.onPress({ nativeEvent: { touches: [], changedTouches: [] } });
    assert.deepEqual(selected[1]?.slice(5), [40, 500], 'keyboard/a11y uses declared current refs, never an older touch');
    button.props.onPress(event([{}, {}], [{}, {}]));
    assert.equal(selected[2], null, 'multi-touch cannot authorize group capture even if an activation is delivered');
  } finally { await act(async () => tree?.unmount()); }
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
