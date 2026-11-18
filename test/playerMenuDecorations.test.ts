import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

import { MenuMorphSession } from '../src/lib/menuMorph';
import { MenuPresentationRegistry } from '../src/lib/menuPresentation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function load(file: string, dependencies: Record<string, any>) {
  const api: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports: api, require(name: string) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected decorative lifecycle import ${name}`);
    return dependencies[name];
  } });
  return api;
}

function environment() {
  const registry = new MenuPresentationRegistry();
  const listeners = new Set<(value: string) => void>();
  const appState = { currentState: 'active', addEventListener(_name: string, callback: (value: string) => void) {
    listeners.add(callback); return { remove() { listeners.delete(callback); } };
  } };
  const dependencies: Record<string, any> = {
    react: React, 'react/jsx-runtime': JSX,
    'react-native': { View: 'View', Text: 'Text', ScrollView: 'ScrollView', AppState: appState,
      StyleSheet: { absoluteFill: { position: 'absolute' }, create: (styles: unknown) => styles } },
    '@/lib/menuPresentation': { menuPresentations: registry },
  };
  const menuHook = load('hooks/useMenuPresentationActive.ts', dependencies);
  dependencies['@/hooks/useMenuPresentationActive'] = menuHook;
  return { registry, dependencies, menuHook,
    foreground(state: string) { appState.currentState = state; for (const listener of listeners) listener(state); } };
}

test('the actual AMLL background retains its image and native host while aggregate menu leases pause/resume only its clock', async () => {
  const h = environment();
  const art = { resolves: 0 };
  const auth = Object.assign((select: (state: object) => unknown) => select({ offline: false }),
    { getState: () => ({ offline: false }) });
  Object.assign(h.dependencies, {
    'expo-image': { Image: {} }, '@/api/data': { CACHED_COVER: 'cached:' },
    '@/components/RouteImageResources': { useRouteImageLease: () => ({ active: true }) },
    '@/store/auth': { useAuthStore: auth },
    '../../modules/amll-background': { AmllBackgroundView: 'NativeBackground' },
    '../../modules/amll-background/artworkSource': { resolveArtworkLocalUri: async () => {
      art.resolves++; return 'file:///current-artwork.jpg';
    } },
  });
  const { AmllPlayerBackground } = load('components/AmllPlayerBackground.tsx', h.dependencies);
  const first = new MenuMorphSession(h.registry), second = new MenuMorphSession(h.registry);
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(React.createElement(AmllPlayerBackground, { uri: 'cover', active: true })); });
    const native = tree.root.findByType('NativeBackground' as any);
    assert.equal(native.props.active, true);
    assert.equal(native.props.localUri, 'file:///current-artwork.jpg');
    const style = native.props.style;
    let firstId = 0, secondId = 0;
    await act(async () => { firstId = first.begin(); });
    assert.equal(native.props.active, false);
    assert.equal(tree.root.findByType('NativeBackground' as any), native, 'pausing must retain the currently painted native host');
    assert.equal(native.props.localUri, 'file:///current-artwork.jpg');
    assert.equal(native.props.style, style);
    await act(async () => { first.complete(firstId, true); first.close(); secondId = second.begin(); });
    assert.equal(native.props.active, false, 'opening completion and retained closing do not resume an obscured clock');
    await act(async () => { first.complete(firstId, false); });
    assert.equal(native.props.active, false, 'the other visible menu still owns coverage');
    await act(async () => { second.close(); second.complete(secondId + 1, false); });
    assert.equal(native.props.active, false, 'a stale native acknowledgement cannot resume the background');
    await act(async () => { second.complete(secondId, false); });
    assert.equal(native.props.active, true);
    assert.equal(art.resolves, 1, 'menu transitions cannot restart artwork lookup/decode or replace its retained frame');
    await act(async () => { tree.update(React.createElement(AmllPlayerBackground, { uri: 'cover', active: false })); });
    await act(async () => { firstId = first.begin(); first.close(); first.complete(firstId, false); });
    assert.equal(native.props.active, false, 'closing a menu cannot start an otherwise paused playback background');
    await act(async () => { tree.update(React.createElement(AmllPlayerBackground, { uri: 'cover', active: true })); h.foreground('background'); });
    assert.equal(native.props.active, false);
    await act(async () => h.foreground('active'));
    assert.equal(native.props.active, true);
  } finally { await act(async () => tree?.unmount()); first.invalidate(); second.invalidate(); }
});

test('the actual menu hook and marquee pause a long paused-song title through closing and resume the same painted offset', async () => {
  const h = environment();
  type Animation = { kind: string; target?: number; config?: { duration?: number }; animations?: Animation[] };
  const values: { value: number; animation?: Animation; get(): number; set(next: number | Animation): void }[] = [];
  Object.assign(h.dependencies, {
    'expo-router': { useFocusEffect: (effect: React.EffectCallback) => React.useEffect(effect, [effect]) },
    'react-native-worklets': { scheduleOnUI: (run: () => void) => run() },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' },
      useSharedValue(initial: number) {
        const reference = React.useRef<typeof values[number] | null>(null);
        if (!reference.current) {
          const value = { value: initial, animation: undefined as Animation | undefined,
            get() { return this.value; }, set(next: number | Animation) {
              if (typeof next === 'number') { this.value = next; this.animation = undefined; }
              else this.animation = next;
            } };
          reference.current = value; values.push(value);
        }
        return reference.current;
      },
      useAnimatedStyle: (read: () => unknown) => ({ read }),
      cancelAnimation: (value: typeof values[number]) => { value.animation = undefined; },
      withTiming: (target: number, config: object) => ({ kind: 'timing', target, config }),
      withDelay: () => ({ kind: 'delay' }), withRepeat: () => ({ kind: 'repeat' }),
      withSequence: (_reduceMotion: string, ...animations: Animation[]) => ({ kind: 'sequence', animations }),
      Easing: { linear: 'linear' }, ReduceMotion: { Never: 'never' },
    },
  });
  h.dependencies['@/hooks/useForegroundEffect'] = load('hooks/useForegroundEffect.ts', h.dependencies);
  const { MarqueeText } = load('components/MarqueeText.tsx', h.dependencies);
  const session = new MenuMorphSession(h.registry);
  function PausedPlayer() {
    const menuActive = h.menuHook.useMenuPresentationActive();
    return React.createElement('PausedPlayer', { playing: false }, React.createElement(MarqueeText,
      { text: 'Above the Chinese Restaurant — long paused title', enabled: true, active: !menuActive }));
  }
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(React.createElement(PausedPlayer)); });
    await act(async () => {
      tree.root.findAllByType('View' as any)[0].props.onLayout({ nativeEvent: { layout: { width: 120 } } });
      tree.root.findAllByType('Text' as any).find((node) => node.props.onLayout)!
        .props.onLayout({ nativeEvent: { layout: { width: 300 } } });
    });
    const offset = values[0];
    const animation = (): Animation | undefined => offset.animation;
    assert.equal(offset.animation?.kind, 'repeat', 'a paused song still allows reading its overflowing title');
    offset.value = -78;
    const painted = tree.root.findByType('AnimatedView' as any);
    let id = 0;
    await act(async () => { id = session.begin(); });
    assert.equal(offset.animation, undefined);
    assert.equal(offset.get(), -78);
    assert.equal(tree.root.findByType('AnimatedView' as any), painted, 'menu coverage retains the measured overflow tree');
    assert.equal(tree.root.findByType('PausedPlayer' as any).props.playing, false);
    await act(async () => { session.complete(id, true); session.close(); session.complete(id + 1, false); });
    assert.equal(offset.animation, undefined, 'requesting close or receiving stale completion must keep the marquee paused');
    await act(async () => { session.complete(id, false); });
    assert.equal(offset.get(), -78);
    assert.equal(animation()?.kind, 'sequence');
    assert.equal(animation()?.animations?.[0].config?.duration, 9000, 'resume travels remaining 270 pixels at the existing 30px/s');
  } finally { await act(async () => tree?.unmount()); session.invalidate(); }
});

test('regular player wires all marquee and animated-artwork sites to one decorative lease without changing playback controls', () => {
  const source = ts.createSourceFile('player.tsx', readFileSync(new URL('../src/app/player.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'ResonusPlayerScreen')!;
  const marquees: ts.JsxOpeningLikeElement[] = [], animatedCovers: ts.JsxOpeningLikeElement[] = [];
  const expressions: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(source) === 'MarqueeText') marquees.push(node);
      if (node.tagName.getText(source) === 'Cover' && node.attributes.getText(source).includes('autoplay={rel')) animatedCovers.push(node);
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useImageAnimation')
      expressions.push(node.arguments[1].getText(source));
    ts.forEachChild(node, visit);
  }
  visit(screen);
  assert.equal(marquees.length, 4);
  for (const node of marquees) {
    const attributes = node.attributes.getText(source);
    assert.match(attributes, /active=\{decorativeActive\}/);
    assert.match(attributes, /enabled=\{marqueeTitles\}/, 'menu coverage cannot toggle overflow/ellipsis presentation');
  }
  assert.equal(animatedCovers.length, 1);
  assert.match(animatedCovers[0].attributes.getText(source), /autoplay=\{rel === 0 && decorativeActive\}/);
  assert.deepEqual(expressions, ['decorativeActive && isAnimatedCover']);
  assert.match(screen.getText(source), /const decorativeActive = isFocused && !menuActive/);
  assert.match(screen.getText(source), /PlayerSystemVolume[^>]*active=\{isFocused\}/);
});
