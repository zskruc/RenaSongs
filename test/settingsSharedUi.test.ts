import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { GLASS_SWITCH_SIZE } from '../src/lib/glassSwitchSize';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function flatten(style: any): any {
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style ?? {};
}

function harness() {
  let version = 0;
  const listeners = new Set<() => void>();
  const palette = { background: '#141619', surface: '#1e2026', surfaceHighlight: '#2a2c33', border: '#2b2d34',
    text: '#ffffff', textSecondary: '#a0a3ab', textMuted: '#72757d', accent: '#1db954', control: '#2b2d34', knob: '#ffffff', danger: '#e03131' };
  const useTheme = () => {
    React.useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version);
    return palette;
  };
  const passthrough = ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  const dependencies: Record<string, any> = {
    react: React, 'react/jsx-runtime': JSX,
    'react-native': { Modal: ({ visible, children, ...props }: any) => visible ? React.createElement('Modal', props, children) : null,
      View: 'View', Text: 'Text', ScrollView: 'Scroll', Pressable: 'Pressable', StyleSheet: { hairlineWidth: 0.5, absoluteFill: { position: 'absolute' }, flatten } },
    'react-native-safe-area-context': { useSafeAreaFrame: () => ({ width: 400, height: 850 }), useSafeAreaInsets: () => ({ top: 28, bottom: 16 }) },
    '@/components/Icon': { __esModule: true, default: 'Icon' },
    '@/components/glass': { GlassPressable: 'GlassButton', GlassSlider: 'GlassSlider', GlassSwitch: 'GlassSwitch', GlassTextInput: 'GlassInput',
      GlassBackdrop: () => { throw new Error('Settings rows must not sample their background separately'); },
      GlassSurface: () => { throw new Error('Settings panels must not allocate another glass renderer'); } },
    './SettingAnchor': { SettingAnchor: passthrough, SettingsAnchorProvider: passthrough },
    './BackChevron': { BackChevron: 'Back' },
    './MenuGlassCard': { MenuGlassPanel: 'GlassMenu', menuGlassScrimColor: () => '#00000044' },
    './glass/StaticGlassBackdropContext': { DynamicGlassBackdrop: passthrough, StaticGlassBackdropProvider: 'StaticSource' },
    './SettingsScrollPaddingContext': { SettingsScrollPaddingContext: React.createContext(0) },
    '@/hooks/useAccent': { useAccent: () => useTheme().accent },
    '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 160 }, '@/hooks/useScreenSize': { CONTENT_MAX_WIDTH: 720 },
    '@/theme': { colors: palette, useTheme, useThemeMode: () => { useTheme(); return version ? 'light' : 'dark'; },
      spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }, radius: { sm: 6, lg: 16, pill: 999 },
      fontSize: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 }, tracking: { heading: -0.1, title: -0.3 }, SCREEN_BOTTOM_PADDING: 160,
      themed: (factory: (colors: typeof palette) => any) => new Proxy({}, { get: (_, key) => factory(palette)[key] }) },
  };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/SettingsUI.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, setTimeout, clearTimeout, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  } });
  return { UI: exports, palette,
    light() { Object.assign(palette, { surface: '#f2f3f5', text: '#111111', textSecondary: '#555555' }); version++; listeners.forEach((listener) => listener()); },
    createNodeMock: () => ({ measureInWindow: (done: (...values: number[]) => void) => done(16, 90, 368, 60) }),
  };
}

test('grouped settings keep one flat panel and aligned row boundaries, including fragments and conditional rows', async () => {
  const { UI } = harness(); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(UI.SettingsGroup, { title: 'Sound', description: 'Playback processing' },
      React.createElement(React.Fragment, null, false, React.createElement(UI.SettingRow, { label: 'Equalizer', onPress() {} }),
        React.createElement(UI.SwitchList, { options: [{ label: 'Replay gain', value: false, onChange() {} }, { label: 'Crossfade', value: false, onChange() {} }] })))); });
    const views = root.root.findAllByType('View' as any);
    assert.equal(views.filter((view) => flatten(view.props.style).backgroundColor === '#1e2026').length, 1);
    assert.equal(views.filter((view) => flatten(view.props.style).height === 0.5).length, 2, 'one divider per actual boundary');
    const rows = root.root.findAllByType('Pressable' as any);
    const styles = rows.map((row) => flatten(row.props.style({ pressed: false })));
    for (const style of styles) {
      assert.equal(style.minHeight, 60);
      assert.equal(style.paddingHorizontal, 16);
      assert.equal(style.marginLeft, undefined, 'separators never shift the label');
      assert.equal(style.height, undefined, 'large text can grow instead of clipping');
    }
    assert.equal(styles[1].minHeight, GLASS_SWITCH_SIZE.touchHeight + styles[1].paddingVertical * 2);
    assert.equal(root.root.findAllByType('Text' as any).find((node) => node.props.children === 'Sound')?.props.accessibilityRole, 'header');
  } finally { await act(async () => root?.unmount()); }
});

test('disabled destinations remain readable and inaccessible actions remain disabled; full-row switch still toggles', async () => {
  const { UI } = harness(); let root!: ReactTestRenderer; const changes: boolean[] = [];
  try {
    await act(async () => { root = create(React.createElement(UI.SettingsGroup, null,
      React.createElement(UI.SettingRow, { label: 'Server', description: 'Unavailable while offline', disabled: true, onPress() {} }),
      React.createElement(UI.SwitchList, { options: [{ label: 'Normalize', value: false, onChange: (value: boolean) => changes.push(value) }] }))); });
    const rows = root.root.findAllByType('Pressable' as any);
    assert.equal(rows[0].props.disabled, true);
    assert.deepEqual(plain(rows[0].props.accessibilityState), { disabled: true });
    assert.equal(rows[0].props.accessibilityHint, 'Unavailable while offline');
    await act(async () => rows[1].props.onPress());
    assert.deepEqual(changes, [true]);
    assert.equal(root.root.findByType('GlassSwitch' as any).props.importantForAccessibility, 'no-hide-descendants');
  } finally { await act(async () => root?.unmount()); }
});

test('theme changes update panel and label together without changing glass controls or their saved values', async () => {
  const h = harness(), { UI } = h; let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(UI.SettingsGroup, { title: 'Appearance' },
      React.createElement(UI.SettingRow, { label: 'Colors', right: 'Automatic' }),
      React.createElement(UI.SwitchList, { options: [{ label: 'Glass', value: true, onChange() {} }] }))); });
    await act(async () => h.light());
    assert.equal(root.root.findAllByType('View' as any).filter((view) => flatten(view.props.style).backgroundColor === '#f2f3f5').length, 1);
    const label = root.root.findAllByType('Text' as any).find((node) => node.props.children === 'Colors')!;
    assert.equal(flatten(label.props.style).color, '#111111');
    assert.equal(root.root.findByType('GlassSwitch' as any).props.value, true);
  } finally { await act(async () => root?.unmount()); }
});

test('selectors still open their anchored glass menu and apply only the selected value', async () => {
  const h = harness(), { UI } = h; let root!: ReactTestRenderer; const changes: unknown[] = [];
  try {
    await act(async () => { root = create(React.createElement(UI.SelectList, { label: 'Theme', value: 'system',
      options: [{ value: 'system', label: 'Automatic' }, { value: 'dark', label: 'Dark' }], onChange: (value: unknown) => changes.push(value) }), { createNodeMock: h.createNodeMock }); });
    await act(async () => root.root.findByType('Pressable' as any).props.onPress());
    assert.equal(root.root.findAllByType('GlassMenu' as any).length, 1);
    const dark = root.root.findAllByType('Pressable' as any).find((node) => node.findAllByType('Text' as any).some((text) => text.props.children === 'Dark'))!;
    await act(async () => dark.props.onPress());
    assert.deepEqual(changes, ['dark']);
    assert.equal(root.root.findAllByType('GlassMenu' as any).length, 0);
  } finally { await act(async () => root?.unmount()); }
});

test('slider drag previews without saving every frame and text input preserves its commit boundary', async () => {
  const { UI } = harness(); let root!: ReactTestRenderer; const sliderChanges: number[] = [], edits: string[] = [], commits: string[] = [];
  try {
    await act(async () => { root = create(React.createElement(UI.SettingsGroup, null,
      React.createElement(UI.SliderRow, { label: 'Crossfade', value: 3, max: 10, formatValue: (value: number) => `${value}s`, onChange: (value: number) => sliderChanges.push(value) }),
      React.createElement(UI.TextRow, { label: 'Home title', value: 'Music', maxLength: 40, onChange: (value: string) => edits.push(value), onEndEditing: (value: string) => commits.push(value) }))); });
    await act(async () => root.root.findByType('GlassSlider' as any).props.onValueChange(5));
    assert.deepEqual(sliderChanges, []);
    assert.ok(root.root.findAllByType('Text' as any).some((node) => node.props.children === '5s'));
    await act(async () => root.root.findByType('GlassSlider' as any).props.onSlidingComplete(5));
    assert.deepEqual(sliderChanges, [5]);
    const input = root.root.findByType('GlassInput' as any);
    await act(async () => input.props.onChangeText('我的音乐'));
    assert.deepEqual(edits, ['我的音乐']); assert.deepEqual(commits, []);
    await act(async () => input.props.onEndEditing({ nativeEvent: { text: '我的音乐' } }));
    assert.deepEqual(commits, ['我的音乐']);
  } finally { await act(async () => root?.unmount()); }
});
