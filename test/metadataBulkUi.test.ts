import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSXRuntime from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const song = (id: string) => ({ id, title: `Song ${id}`, artist: 'Artist', album: 'Album', duration: 200 });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
function load(path: string, dependencies: Record<string, unknown>, timers: { setTimeout: (...args: any[]) => unknown; clearTimeout: (id: any) => void }) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, Math, AbortController, ...timers,
    require(name: string) { assert.ok(Object.hasOwn(dependencies, name), `${path}: ${name}`); return dependencies[name]; } });
  return exports;
}
const palette = { text: '#fff', textSecondary: '#ccc', textMuted: '#aaa', surface: '#222', surfaceHighlight: '#333', accent: '#f05', border: '#555' };
const translate = (key: string, values?: Record<string, unknown>) => key.replace(/\{([^}]+)\}/g, (_, name: string) => String(values?.[name]));
function defaultJob(id = 'job-A') {
  return { id, title: `Task ${id}`, status: 'running', updatedAt: 1, enumerationDone: true,
    counts: { scanned: 80, queued: 80, processed: 5, applied: 3, needsReview: 1, failed: 1, skipped: 0 } };
}

function harness(params: Record<string, string> = {}, task = false, localize = translate) {
  let epoch = 0, currentParams = params, auth = { auth: { username: 'A' }, offline: false, offlineSource: null, autoOffline: false };
  const authListeners = new Set<() => void>(), storeListeners = new Set<() => void>();
  const timers = new Map<number, () => void>(); let nextTimer = 0;
  const timerBoundary = { setTimeout: (callback: () => void) => { const id = ++nextTimer; timers.set(id, callback); return id; }, clearTimeout: (id: number) => { timers.delete(id); } };
  const routes: any[] = [], starts: any[] = [], stops: any[] = [], resumes: any[] = [], pages: any[] = [], containers: any[] = [], taskReads: any[] = [], clears: string[] = [], targets: any[] = [];
  let selected: string[] | null = ['incoming-a', 'incoming-b'];
  let startReader = async () => 'created-job';
  let catalogReader = async (_scope: any, cursor: string | undefined, _operation: any, options: any) => options.search
    ? { songs: [song('search')], done: true, nextCursor: undefined }
    : cursor ? { songs: [song('c'), song('d')], done: false, nextCursor: 'last' }
      : { songs: [song('a'), song('b')], done: false, nextCursor: 'next' };
  let taskReader = async (_id: string, offset: number, limit: number, _operation: any) => Array.from({ length: limit }, (_, n) => ({ song: song(`row-${offset + n}`), status: 'queued' }));
  let stopReader = async (_id: string, _cancel: boolean) => {};
  let resumeReader = async (_id: string, _retry: boolean) => {};
  let state: any;
  const metadataOperation = (scope = { profile: 'A', source: 'server' }, signal?: AbortSignal, extra = () => true) => {
    const token = epoch;
    // Match repository.ts exactly: current() fences ownership; metadataCheck separately checks AbortSignal.
    return { scope, signal, current: () => token === epoch && extra() };
  };
  const publish = (patch: object) => { state = { ...state, ...patch }; for (const listener of storeListeners) listener(); };
  state = {
    jobs: task ? [defaultJob(params.id)] : [], hydrate: async () => {},
    start: async (...args: any[]) => { starts.push(plain(args)); return startReader(); },
    stop: async (id: string, cancel = false) => { stops.push([id, cancel]); await stopReader(id, cancel);
      publish({ jobs: state.jobs.map((job: any) => job.id === id ? { ...job, status: cancel ? 'cancelled' : 'paused', updatedAt: job.updatedAt + 1 } : job) }); },
    resume: async (id: string, retry = false) => { resumes.push([id, retry]); await resumeReader(id, retry);
      publish({ jobs: state.jobs.map((job: any) => job.id === id ? { ...job, status: 'running', updatedAt: job.updatedAt + 1 } : job) }); },
  };
  const useStore = Object.assign(() => React.useSyncExternalStore((listener) => { storeListeners.add(listener); return () => { storeListeners.delete(listener); }; }, () => state), { getState: () => state });
  const useAuth = (select: (value: typeof auth) => unknown) => React.useSyncExternalStore((listener) => { authListeners.add(listener); return () => { authListeners.delete(listener); }; }, () => select(auth));
  const dockEvents: any[] = [], animatedScrollBindings: object[] = [];
  // Reanimated's useEvent returns this object at runtime even though its
  // exported TypeScript overload disguises it as an ordinary callback.
  const dockHandler = { workletEventHandler: {
    eventNames: ['onScroll', 'onScrollBeginDrag', 'onScrollEndDrag', 'onMomentumScrollEnd'],
    worklet: (event: unknown) => { dockEvents.push(plain(event)); },
  } };
  const createAnimatedComponent = (Component: React.ComponentType<any>) => function AnimatedBoundary(props: any) {
    const normalized = { ...props };
    for (const value of Object.values(props)) {
      const processed = value as typeof dockHandler | undefined;
      if (!processed || typeof processed !== 'object' || !processed.workletEventHandler) continue;
      animatedScrollBindings.push(processed);
      for (const name of processed.workletEventHandler.eventNames) {
        // Stand in for native worklet registration/event delivery followed by
        // Reanimated's callable host listener. Native drawing is not simulated.
        normalized[name] = (event: { nativeEvent: object }) => processed.workletEventHandler.worklet({ ...event.nativeEvent, eventName: name });
      }
    }
    return React.createElement(Component, normalized);
  };
  function FlatList(props: any) {
    return React.createElement('List', props, props.ListHeaderComponent,
      props.data.map((item: any, index: number) => React.createElement(React.Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index }))), props.ListFooterComponent);
  }
  const dependencies: Record<string, any> = {
    react: React, 'react/jsx-runtime': JSXRuntime,
    'react-native': { Text: 'Text', TextInput: 'Input', View: 'View', ActivityIndicator: 'Spinner', FlatList, Pressable: 'Pressable' },
    'react-native-reanimated': { __esModule: true, default: { createAnimatedComponent } },
    'expo-image': { Image: 'Image' }, 'expo-router': { router: { push: (value: unknown) => routes.push(plain(value)) }, useLocalSearchParams: () => currentParams },
    '@/components/Icon': { __esModule: true, default: 'Icon' }, '@/components/glass': { GlassPressable: 'Button' },
    '@/components/SettingsUI': { SettingsPage: 'Page', SettingsGroup: 'Group', SettingRow: 'Row', SelectList: 'Select', SwitchList: 'Switches', settingsStyles: {} },
    '@/theme': { useTheme: () => palette, themed: (make: any) => make(palette), fontSize: { sm: 12, md: 16, lg: 20, xs: 10 }, spacing: { sm: 4, md: 8, lg: 12 } },
    '@/hooks/useLiquidDock': { useLiquidDockScrollHandler: () => dockHandler }, '@/hooks/useScreenBottomPadding': { useScreenBottomPadding: () => 160 },
    '@/i18n': { useT: () => localize }, '@/store/auth': { useAuthStore: useAuth }, '@/store/metadataBulk': { useMetadataBulk: useStore },
    '@/lib/metadata/repository': { metadataOperation }, '@/lib/metadata/models': { isMetadataCancelled: (error: unknown) => (error as Error)?.name === 'MetadataCancelled' },
    '@/lib/metadata/catalog': {
      readMetadataCatalogPage: (...args: any[]) => { pages.push(args); return catalogReader(...args as Parameters<typeof catalogReader>); },
      listMetadataContainers: async (...args: any[]) => { containers.push(args); return { items: [{ id: 'container', name: 'Chosen container' }], nextOffset: undefined }; },
    },
    '@/store/metadataBulkSelection': { readSelectedMetadataSongs: () => selected && [...selected], clearSelectedMetadataSongs: (key: string) => { clears.push(key); selected = null; } },
    '@/lib/metadata/bulkJobs': {
      loadBulkJob: async (id: string) => state.jobs.find((job: any) => job.id === id),
      readBulkJobItems: (...args: any[]) => { taskReads.push(args); return taskReader(...args as Parameters<typeof taskReader>); },
    },
    '@/store/metadataScraping': { openMetadataTarget: (value: unknown) => targets.push(plain(value)) },
  };
  const UI = load('../src/components/metadata/MetadataUI.tsx', dependencies, timerBoundary);
  dependencies['@/components/metadata/MetadataUI'] = UI;
  const Screen = load(task ? '../src/app/metadata/bulk-task.tsx' : '../src/app/metadata/bulk.tsx', dependencies, timerBoundary).default;
  return { Screen, UI, routes, starts, stops, resumes, pages, containers, taskReads, clears, targets, dockHandler, dockEvents, animatedScrollBindings,
    changeOwner: () => { epoch++; auth = { ...auth, auth: { username: epoch % 2 ? 'B' : 'A' } }; for (const listener of authListeners) listener(); },
    setParams: (value: typeof params) => { currentParams = value; },
    setSelected: (value: string[] | null) => { selected = value; },
    startReader: (value: typeof startReader) => { startReader = value; }, catalogReader: (value: typeof catalogReader) => { catalogReader = value; },
    taskReader: (value: typeof taskReader) => { taskReader = value; }, stopReader: (value: typeof stopReader) => { stopReader = value; }, resumeReader: (value: typeof resumeReader) => { resumeReader = value; },
    job: () => state.jobs[0], publishJob: (job: ReturnType<typeof defaultJob>) => publish({ jobs: [job] }),
    flushTimers: () => { const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback(); },
  };
}
const buttons = (root: ReactTestRenderer, label: string) => root.root.findAllByType('Button' as any).filter((node) => node.props.accessibilityLabel === label);
const button = (root: ReactTestRenderer, label: string) => { const found = buttons(root, label)[0]; assert.ok(found, `Missing button: ${label}`); return found; };
const list = (root: ReactTestRenderer) => root.root.findByType('List' as any);
const checks = (root: ReactTestRenderer) => root.root.findAllByType('Pressable' as any).filter((node) => node.props.accessibilityRole === 'checkbox');
const textIncludes = (root: ReactTestRenderer, text: string) => root.root.findAllByType('Text' as any).some((node) => String(node.props.children).includes(text));
const changeRange = (root: ReactTestRenderer, mode: string) => root.root.findByType('Select' as any).props.onChange(mode);


test('manual selection survives pagination and search and starts exactly those IDs without truncation or catalog reloads on checkbox changes', async () => {
  const h = harness(); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    await act(async () => { changeRange(root, 'manual'); });
    const calls = h.pages.length;
    await act(async () => { checks(root)[0].props.onPress(); }); assert.equal(h.pages.length, calls);
    await act(async () => { list(root).props.onEndReached(); list(root).props.onEndReached(); });
    assert.equal(h.pages.length, calls + 1); assert.equal(h.pages.at(-1)[1], 'next');
    await act(async () => { checks(root)[2].props.onPress(); });
    await act(async () => { root.root.findByType('Input' as any).props.onChangeText('query'); });
    await act(async () => { h.flushTimers(); });
    assert.equal(h.pages.at(-1)[3].search, 'query'); assert.equal(checks(root).length, 1);
    assert.equal(textIncludes(root, '2 songs selected'), true);
    await act(async () => { checks(root)[0].props.onPress(); });
    await act(async () => { button(root, 'Scrape 3 selected songs').props.onPress(); });
    assert.deepEqual(h.starts[0][0], { kind: 'selected', songIds: ['a', 'c', 'search'] });
    assert.equal(h.starts.length, 1); assert.equal(h.routes[0].params.id, 'created-job');
  } finally { await act(async () => root?.unmount()); }
});

test('all-music scope can start while its first preview page is pending and does not enumerate the library first', async () => {
  const h = harness(), preview = deferred<any>(); h.catalogReader(() => preview.promise); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    assert.equal(h.pages.length, 1); assert.equal(button(root, 'Start scraping').props.disabled, false);
    await act(async () => { button(root, 'Start scraping').props.onPress(); });
    assert.deepEqual(h.starts[0][0], { kind: 'all' }); assert.equal(h.pages.length, 1);
    assert.equal(h.routes.length, 1); preview.resolve({ songs: [song('late')], done: true });
  } finally { await act(async () => root?.unmount()); }
});

test('missing-fields range sends chosen fields to preview and task creation and always keeps overwrite off', async () => {
  const h = harness(); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    await act(async () => { root.root.findByType('Switches' as any).props.options[0].onChange(true); });
    await act(async () => { changeRange(root, 'missing'); button(root, 'Choose metadata fields').props.onPress(); });
    await act(async () => { root.root.findByType(h.UI.MetadataFields).props.onChange(['cover', 'lyrics']); });
    assert.deepEqual(plain(h.pages.at(-1)[0]), { kind: 'missing' }); assert.deepEqual(plain(h.pages.at(-1)[3].fields), ['cover', 'lyrics']);
    await act(async () => { button(root, 'Start scraping').props.onPress(); });
    assert.deepEqual(h.starts[0][0], { kind: 'missing' }); assert.deepEqual(h.starts[0][2], ['cover', 'lyrics']); assert.equal(h.starts[0][3], false);
  } finally { await act(async () => root?.unmount()); }
});

test('entity deep links preselect their exact album/artist/playlist identity and bypass container-list enumeration', async () => {
  for (const kind of ['album', 'artist', 'playlist']) {
    const h = harness({ kind, id: `${kind}-123`, title: `${kind} title` }); let root!: ReactTestRenderer;
    try {
      await act(async () => { root = create(React.createElement(h.Screen)); });
      const expected = { kind, id: `${kind}-123`, title: `${kind} title` };
      assert.deepEqual(plain(h.pages[0][0]), expected); assert.equal(h.containers.length, 0);
      await act(async () => { button(root, 'Start scraping').props.onPress(); }); assert.deepEqual(h.starts[0][0], expected);
    } finally { await act(async () => root?.unmount()); }
  }
});

test('expired selected-song handoff stays in manual mode and cannot silently start an all-music task', async () => {
  const h = harness({ kind: 'selected', selection: 'expired' }); h.setSelected(null); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    assert.equal(root.root.findByType('Select' as any).props.value, 'manual');
    assert.equal(textIncludes(root, 'The previous selection expired'), true);
    assert.equal(button(root, 'Scrape 0 selected songs').props.disabled, true);
    await act(async () => { button(root, 'Scrape 0 selected songs').props.onPress(); }); assert.equal(h.starts.length, 0);
    await act(async () => { checks(root)[0].props.onPress(); });
    await act(async () => { button(root, 'Scrape 1 selected songs').props.onPress(); });
    assert.deepEqual(h.starts[0][0], { kind: 'selected', songIds: ['a'] });
  } finally { await act(async () => root?.unmount()); }
});

test('setup start rejects same-frame duplicate taps, old-owner callbacks, and late successful start/page results after account ABA', async () => {
  const h = harness({ kind: 'selected', selection: 'selected-key' }), pending = deferred<string>(), page = deferred<any>();
  h.startReader(() => pending.promise); h.catalogReader(() => page.promise); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    const start = button(root, 'Scrape 2 selected songs').props.onPress;
    await act(async () => { start(); start(); }); assert.equal(h.starts.length, 1);
    await act(async () => { h.changeOwner(); h.changeOwner(); });
    await act(async () => { start(); pending.resolve('old-job'); page.resolve({ songs: [song('wrong-owner')], done: true }); });
    assert.equal(h.starts.length, 1); assert.equal(h.routes.length, 0); assert.equal(h.clears.length, 0);
    assert.equal(list(root).props.data.length, 0); assert.equal(textIncludes(root, 'The music source changed'), true);
  } finally { await act(async () => root?.unmount()); }
});

test('task controls use the route job identity and read only one bounded item page at a time', async () => {
  const h = harness({ id: 'task-route' }, true); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    assert.equal(h.taskReads.length, 1); assert.deepEqual(h.taskReads[0].slice(0, 3), ['task-route', 0, 25]);
    await act(async () => { button(root, 'Next page').props.onPress(); });
    assert.deepEqual(h.taskReads.at(-1).slice(0, 3), ['task-route', 25, 25]); assert.equal(list(root).props.data.length, 25);
    await act(async () => { button(root, 'Previous page').props.onPress(); }); assert.equal(h.taskReads.at(-1)[1], 0);
    await act(async () => { button(root, 'Pause task').props.onPress(); }); assert.deepEqual(h.stops, [['task-route', false]]);
    await act(async () => { button(root, 'Resume task').props.onPress(); }); assert.deepEqual(h.resumes, [['task-route', false]]);
    assert.equal(h.taskReads.every((entry) => entry[2] === 25), true);
    await act(async () => { button(root, 'Cancel task').props.onPress(); }); assert.deepEqual(h.stops.at(-1), ['task-route', true]);
    await act(async () => { button(root, 'Retry failed songs').props.onPress(); }); assert.deepEqual(h.resumes.at(-1), ['task-route', true]);
  } finally { await act(async () => root?.unmount()); }
});

test('task resume/retry reject obsolete account callbacks and same-frame duplicate starts', async () => {
  const h = harness({ id: 'task-route' }, true), resumed = deferred<void>(); let root!: ReactTestRenderer;
  h.resumeReader(() => resumed.promise);
  try {
    h.publishJob({ ...h.job(), status: 'paused' });
    await act(async () => { root = create(React.createElement(h.Screen)); });
    const resume = button(root, 'Resume task').props.onPress, retry = button(root, 'Retry failed songs').props.onPress;
    await act(async () => { resume(); resume(); }); assert.equal(h.resumes.length, 1);
    await act(async () => { h.changeOwner(); h.changeOwner(); resume(); retry(); });
    assert.equal(h.resumes.length, 1); resumed.resolve();
  } finally { await act(async () => root?.unmount()); }
});

test('late task-page results cannot overwrite the current page after its previous read was aborted', async () => {
  const h = harness({ id: 'task-route' }, true), oldPage = deferred<any>(), newPage = deferred<any>(); let root!: ReactTestRenderer;
  h.taskReader((_id, offset) => offset === 0 ? oldPage.promise : newPage.promise);
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    await act(async () => { button(root, 'Next page').props.onPress(); });
    await act(async () => { newPage.resolve([{ song: song('new-page'), status: 'queued' }]); });
    assert.equal(list(root).props.data[0].song.id, 'new-page');
    await act(async () => { oldPage.resolve([{ song: song('obsolete-page'), status: 'review' }]); });
    assert.equal(list(root).props.data[0].song.id, 'new-page');
    assert.equal(h.taskReads[0][3].signal.aborted, true); assert.equal(h.taskReads.length, 2);
  } finally { await act(async () => root?.unmount()); }
});

test('a late previous search page cannot replace the current search pagination cursor', async () => {
  const h = harness({ kind: 'selected', selection: 'selected-key' }), oldPage = deferred<any>(), freshPage = deferred<any>(); let root!: ReactTestRenderer;
  h.catalogReader((_scope, cursor, _operation, options) => cursor
    ? Promise.resolve({ songs: [song('next-search-page')], done: true, nextCursor: undefined })
    : options.search === 'new query' ? freshPage.promise : oldPage.promise);
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    await act(async () => { root.root.findByType('Input' as any).props.onChangeText('new query'); });
    await act(async () => { h.flushTimers(); });
    await act(async () => { freshPage.resolve({ songs: [song('fresh')], done: false, nextCursor: 'fresh-cursor' }); });
    await act(async () => { oldPage.resolve({ songs: [song('obsolete')], done: false, nextCursor: 'obsolete-cursor' }); });
    assert.equal(list(root).props.data[0].song.id, 'fresh');
    await act(async () => { button(root, 'Load more').props.onPress(); });
    assert.equal(h.pages.at(-1)[1], 'fresh-cursor'); assert.equal(h.pages.at(-1)[3].search, 'new query');
  } finally { await act(async () => root?.unmount()); }
});

test('task review callbacks retired by unmount cannot reopen a song editor', async () => {
  const h = harness({ id: 'task-route' }, true); let root!: ReactTestRenderer;
  h.taskReader(async () => [{ song: song('review-song'), status: 'review' }]);
  await act(async () => { root = create(React.createElement(h.Screen)); });
  const review = button(root, 'Review this song').props.onPress;
  await act(async () => { root.unmount(); });
  await act(async () => { review(); });
  assert.equal(h.routes.length, 0); assert.equal(h.targets.length, 0);
});

test('setup and task lists normalize the real processed scroll object before the React Native event boundary', async () => {
  for (const task of [false, true]) {
    const h = harness(task ? { id: 'scroll-task' } : { kind: 'selected', selection: 'selected-key' }, task); let root!: ReactTestRenderer;
    try {
      await act(async () => { root = create(React.createElement(h.Screen)); });
      assert.equal(typeof h.dockHandler, 'object');
      assert.equal(typeof list(root).props.onScroll, 'function', 'a plain RN FlatList cannot call Reanimated processed handler objects');
      assert.equal(h.animatedScrollBindings.includes(h.dockHandler), true, 'the dock handler must pass through Animated registration');
      const event = { nativeEvent: { contentOffset: { x: 0, y: 210 }, contentSize: { width: 400, height: 3000 }, layoutMeasurement: { width: 400, height: 800 }, timestamp: 100 } };
      await act(async () => {
        // This is what RN ScrollView._handleScroll does on the first real drag.
        assert.doesNotThrow(() => list(root).props.onScroll(event));
        assert.doesNotThrow(() => list(root).props.onScrollBeginDrag(event));
        assert.doesNotThrow(() => list(root).props.onScrollEndDrag(event));
      });
      assert.deepEqual(h.dockEvents.map((value) => value.eventName), ['onScroll', 'onScrollBeginDrag', 'onScrollEndDrag']);
      assert.equal(h.dockEvents[0].contentOffset.y, 210);
      assert.equal(list(root).props.scrollEventThrottle, 16);
      assert.equal(h.starts.length, 0); assert.equal(h.stops.length, 0); assert.equal(h.resumes.length, 0);
    } finally { await act(async () => root?.unmount()); }
  }
});

test('paused, cancelled and completed task headers show only their localized status while running tasks retain the current phase', async () => {
  const messages: Record<string, string> = { running: '运行中', paused: '已暂停', cancelled: '已取消', completed: '已完成',
    'Processing queued songs': '正在处理排队歌曲', 'Reading music in pages': '正在分页读取曲库' };
  const h = harness({ id: 'status-task' }, true, (key, values) => messages[key] ?? translate(key, values)); let root!: ReactTestRenderer;
  const labels = () => root.root.findAllByType('Text' as any).map((node) => [node.props.children].flat(Infinity).join(''));
  try {
    await act(async () => { root = create(React.createElement(h.Screen)); });
    for (const status of ['completed', 'cancelled', 'paused']) {
      for (const enumerationDone of [false, true]) {
        await act(async () => { h.publishJob({ ...h.job(), status, enumerationDone, updatedAt: h.job().updatedAt + 1 }); });
        assert.equal(labels().includes(messages[status]), true, `${status} must remain translated`);
        assert.equal(labels().some((text) => text.includes(messages['Processing queued songs']) || text.includes(messages['Reading music in pages'])), false,
          `${status} must not claim it is still processing or reading music`);
      }
    }
    for (const enumerationDone of [false, true]) {
      await act(async () => { h.publishJob({ ...h.job(), status: 'running', enumerationDone, updatedAt: h.job().updatedAt + 1 }); });
      const phase = messages[enumerationDone ? 'Processing queued songs' : 'Reading music in pages'];
      assert.equal(labels().includes(`${messages.running} · ${phase}`), true);
    }
  } finally { await act(async () => root?.unmount()); }
});
