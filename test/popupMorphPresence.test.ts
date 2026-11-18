import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Native completion is deliberately asynchronous: no duration timers can
 * stand in for the acknowledgement that the actual exit has finished. */
function harness() {
  const exits: (() => void)[] = [];
  const colors = { text: '#fff', textSecondary: '#ccc', textMuted: '#999', accent: '#0f0', danger: '#f00', onAccent: '#000' };
  const dependencies: Record<string, any> = {
    react: React, 'react/jsx-runtime': JSX,
    'react-native': { Modal: 'Modal', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
      StyleSheet: { absoluteFill: {} } },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
    '@/components/glass': { GlassPressable: 'Button' },
    '@/components/MenuMorphItem': { MenuMorphItem: 'Button' },
    './MenuGlassCard': { MENU_GLASS_RADIUS: 28, MenuGlassCardFrame: 'Frame', MenuGlassCardHeader: 'Header' },
    'reanimated-color-picker': { __esModule: true, default: 'ColorPicker', HueSlider: 'HueSlider', Panel1: 'Panel' },
    '@/i18n': { useT: () => (text: string) => text },
    '@/theme': { colors, themed: (make: (colors: object) => unknown) => make(colors), radius: { md: 12, pill: 999, lg: 16 },
      spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }, fontSize: { md: 16, lg: 20 }, tracking: { heading: 0 } },
    './useBottomSheetAnim': { useBottomSheetAnim: (open: boolean, _onClose: unknown, _kind: string, session: number) => ({
      dismiss: (complete: () => void) => exits.push(complete), motion: { open, sessionId: session, ready: true },
      onModalShow() {}, backdropStyle: {}, sheetStyle: {}, onSheetLayout() {},
    }) },
  };
  function load(file: string) {
    const api: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports: api, requestAnimationFrame: (callback: () => void) => { callback(); return 1; }, cancelAnimationFrame() {},
      require(name: string) { assert.ok(Object.hasOwn(dependencies, name), `Unexpected popup import ${name}`); return dependencies[name]; } });
    return api;
  }
  const presence = load('hooks/usePopupMorphPresence.ts');
  dependencies['@/hooks/usePopupMorphPresence'] = presence;
  return { usePopupMorphPresence: presence.usePopupMorphPresence, Dialog: load('components/Dialog.tsx').Dialog,
    ColorPickerDialog: load('components/ColorPickerDialog.tsx').ColorPickerDialog, exits };
}

const nodeMock = () => ({ focus() {}, blur() {} });
function namedButton(root: ReactTestRenderer, label: string) {
  return root.root.findAllByType('Button' as any).find((node) => node.findAllByType('Text' as any).some((text) => text.props.children === label))!;
}

test('controlled hide keeps the dialog content and native window until exit completes without cancelling twice', async () => {
  const h = harness(); let root!: ReactTestRenderer; let cancelled = 0;
  const props = { visible: true, title: 'Rename', input: { initialValue: 'Saved name' }, confirmLabel: 'Save', onCancel: () => cancelled++, onConfirm() {} };
  try {
    await act(async () => { root = create(React.createElement(h.Dialog, props), { createNodeMock: nodeMock }); });
    assert.equal(root.root.findByType('Modal' as any).props.animationType, 'none');
    await act(async () => root.update(React.createElement(h.Dialog, { ...props, visible: false, title: '', input: undefined })));
    assert.equal(h.exits.length, 1);
    assert.equal(root.root.findByType('Header' as any).props.title, 'Rename');
    assert.equal(root.root.findByType('TextInput' as any).props.value, 'Saved name');
    assert.equal(cancelled, 0);
    await act(async () => h.exits[0]());
    assert.equal(root.toJSON(), null);
    assert.equal(cancelled, 0);
  } finally { await act(async () => root?.unmount()); }
});

test('confirm, cancel and native back are serialized; input is committed exactly once after the morph', async () => {
  for (const inline of [false, true, 'menu'] as const) {
    const h = harness(); let root!: ReactTestRenderer; const calls: string[] = [];
    try {
      await act(async () => { root = create(React.createElement(h.Dialog, {
        visible: true, title: 'Rename', input: { initialValue: '' }, confirmLabel: 'Save', inline: inline === true, inlineMenu: inline === 'menu',
        onCancel: () => calls.push('cancel'), onConfirm: (value: string) => calls.push(value),
      }), { createNodeMock: nodeMock }); });
      await act(async () => root.root.findByType('TextInput' as any).props.onChangeText('  New title  '));
      await act(async () => {
        namedButton(root, 'Save').props.onPress({ nativeEvent: {} });
        root.root.findByType('Header' as any).props.onClose();
      });
      assert.deepEqual(calls, []);
      assert.equal(h.exits.length, 1);
      assert.equal(root.root.findByType('Frame' as any).props.motion.ready, true);
      await act(async () => { h.exits[0](); h.exits[0](); });
      assert.deepEqual(calls, ['New title']);
      assert.equal(root.toJSON(), null);
    } finally { await act(async () => root?.unmount()); }
  }
});

test('rapid reopen and replacing a visible dialog discard the preceding destructive callback', async () => {
  for (const replace of [false, true]) {
    const h = harness(); let root!: ReactTestRenderer; const actions: string[] = [];
    const props = { visible: true, title: 'Delete first song', confirmLabel: 'Delete', onCancel() {}, onConfirm: () => actions.push('old') };
    try {
      await act(async () => { root = create(React.createElement(h.Dialog, props)); });
      await act(async () => namedButton(root, 'Delete').props.onPress());
      if (!replace) await act(async () => root.update(React.createElement(h.Dialog, { ...props, visible: false })));
      await act(async () => root.update(React.createElement(h.Dialog, { ...props, visible: true, title: replace ? 'Delete next song' : props.title, onConfirm: () => actions.push('new') })));
      await act(async () => h.exits[0]());
      assert.deepEqual(actions, []);
      assert.equal(root.root.findByType('Modal' as any).props.visible, true);
      await act(async () => namedButton(root, 'Delete').props.onPress());
      await act(async () => h.exits[1]());
      assert.deepEqual(actions, ['new']);
    } finally { await act(async () => root?.unmount()); }
  }
});

test('unmount suppresses native completions and event objects never become post-close callbacks', async () => {
  const h = harness(); let root!: ReactTestRenderer; let popup: any; let actions = 0;
  function Probe() { popup = h.usePopupMorphPresence(true); return React.createElement('Probe', { mounted: popup.mounted }); }
  await act(async () => { root = create(React.createElement(Probe)); });
  await act(async () => popup.close({ nativeEvent: { target: 42 } }));
  await act(async () => h.exits[0]());
  assert.equal(root.root.findByType('Probe' as any).props.mounted, false);
  await act(async () => root.unmount());
  await act(async () => { root = create(React.createElement(Probe)); });
  await act(async () => popup.close(() => actions++));
  await act(async () => root.unmount());
  assert.doesNotThrow(() => h.exits[1]());
  assert.equal(actions, 0);
});

test('color edits are captured for Save and kept local until exit acknowledgement', async () => {
  const h = harness(); let root!: ReactTestRenderer; const saved: string[] = [];
  try {
    await act(async () => { root = create(React.createElement(h.ColorPickerDialog, { initialColor: '#123456', onCancel() {}, onSave: (hex: string) => saved.push(hex) })); });
    await act(async () => root.root.findByType('TextInput' as any).props.onChangeText('abcdef'));
    await act(async () => namedButton(root, 'Save').props.onPress());
    assert.deepEqual(saved, []);
    assert.ok(root.root.findByType('ColorPicker' as any));
    await act(async () => h.exits[0]());
    assert.deepEqual(saved, ['#ABCDEF']);
    assert.equal(root.toJSON(), null);
  } finally { await act(async () => root?.unmount()); }
});

test('live dialog status text updates do not replace or restart its popup session', async () => {
  const h = harness(); let root!: ReactTestRenderer;
  const props = { visible: true, title: 'Download', message: '1 of 20', confirmLabel: 'Cancel', onCancel() {}, onConfirm() {} };
  try {
    await act(async () => { root = create(React.createElement(h.Dialog, props)); });
    const session = root.root.findByType('Frame' as any).props.motion.sessionId;
    await act(async () => root.update(React.createElement(h.Dialog, { ...props, message: '2 of 20' })));
    assert.equal(root.root.findByType('Frame' as any).props.motion.sessionId, session);
    assert.ok(root.root.findAllByType('Text' as any).some((node) => node.props.children === '2 of 20'));
    assert.equal(h.exits.length, 0);
  } finally { await act(async () => root?.unmount()); }
});

test('a local selection runs on the tap once, retaining native presence and deferring only owner cleanup', async () => {
  const h = harness(); let root!: ReactTestRenderer; let popup: any;
  const changes: string[] = [], cleanup: string[] = [];
  function Probe() { popup = h.usePopupMorphPresence(true); return React.createElement('Probe', { mounted: popup.mounted }); }
  try {
    await act(async () => { root = create(React.createElement(Probe)); });
    await act(async () => {
      assert.equal(popup.select(() => changes.push('dark'), () => cleanup.push('closed')), true);
      assert.equal(popup.select(() => changes.push('light')), false);
      popup.close(() => cleanup.push('cancel'));
    });
    assert.deepEqual(changes, ['dark']);
    assert.deepEqual(cleanup, []);
    assert.equal(root.root.findByType('Probe' as any).props.mounted, true);
    assert.equal(h.exits.length, 1);
    await act(async () => { h.exits[0](); h.exits[0](); });
    assert.deepEqual(changes, ['dark']);
    assert.deepEqual(cleanup, ['closed']);
    assert.equal(root.root.findByType('Probe' as any).props.mounted, false);
  } finally { await act(async () => root?.unmount()); }
});

test('cancelled and replaced local selections reject stale handlers without changing or closing the new session', async () => {
  const h = harness(); let root!: ReactTestRenderer; let popup: any; const changes: string[] = [];
  function Probe({ visible, owner }: { visible: boolean; owner: string }) {
    popup = h.usePopupMorphPresence(visible, owner);
    return React.createElement('Probe', { mounted: popup.mounted });
  }
  try {
    await act(async () => { root = create(React.createElement(Probe, { visible: true, owner: 'A' })); });
    const staleSelect = popup.select, staleClose = popup.close;
    await act(async () => popup.close());
    assert.equal(staleSelect(() => changes.push('cancelled')), false);
    await act(async () => root.update(React.createElement(Probe, { visible: true, owner: 'B' })));
    await act(async () => { h.exits[0](); });
    assert.equal(staleSelect(() => changes.push('old owner')), false);
    assert.equal(staleClose(), false);
    assert.equal(root.root.findByType('Probe' as any).props.mounted, true);
    assert.equal(h.exits.length, 1);
    await act(async () => popup.select(() => changes.push('B')));
    assert.deepEqual(changes, ['B']);
    await act(async () => h.exits[1]());
    assert.equal(root.root.findByType('Probe' as any).props.mounted, false);
  } finally { await act(async () => root?.unmount()); }
});
