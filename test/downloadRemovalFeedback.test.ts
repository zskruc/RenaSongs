import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const first = { username: 'A' }, auth = createStore(() => ({ auth: first, offlineSource: null as object | null }));
  const notices: { message: string; action?: { run(): void } }[] = [], calls: string[][] = [];
  let work: () => Promise<number> = async () => 0;
  const api: Record<string, any> = {};
  const imports: Record<string, unknown> = {
    '@/i18n': { tg: (text: string, params?: { n: number }) => text.replace('{n}', String(params?.n)) },
    '@/store/auth': { useAuthStore: auth, profileScopeId: () => auth.getState().auth.username },
    '@/store/downloads': { useDownloads: { getState: () => ({ deleteSongs: (ids: string[]) => { calls.push(ids); return work(); } }) } },
    '@/store/podcastDownloads': { usePodcastDownloads: { getState: () => ({ deleteEpisodes: (ids: string[]) => { calls.push(ids); return work(); } }) } },
    '@/store/toast': { useToast: { getState: () => ({ show: (message: string, action?: { run(): void }) => notices.push({ message, action }) }) } },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/downloadRemoval.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: api, require: (name: string) => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { api, notices, calls, first, auth, work: (run: () => Promise<number>) => { work = run; } };
}

test('download feedback waits for completion and uses the actual unique catalog count', async () => {
  const h = harness(), gate = deferred<number>(); h.work(() => gate.promise);
  const removal = h.api.removeSongDownloads(['a', 'a', 'missing']);
  assert.equal(h.notices.length, 0);
  gate.resolve(1); await removal; assert.equal(h.notices[0].message, '1 songs deleted');
  h.work(async () => 0); await h.api.removeSongDownloads(['missing']);
  assert.equal(h.notices[1].message, 'Nothing here is downloaded');
  h.work(async () => 2); await h.api.removeEpisodeDownloads(['one', 'two']);
  assert.equal(h.notices[2].message, '2 episodes deleted');
});

test('failed deletion reports a failure and never offers success or Undo', async () => {
  const h = harness(); h.work(async () => { throw new Error('disk catalog unavailable'); });
  await h.api.removeSongDownloads(['a'], { label: 'Undo', run() { assert.fail(); } });
  assert.equal(h.notices.length, 1); assert.equal(h.notices[0].message, "Couldn't complete the action");
  assert.equal(h.notices[0].action, undefined);
});

test('late completion, late errors and Undo cannot affect another account or revive through ABA', async () => {
  for (const fail of [false, true]) {
    const h = harness(), gate = deferred<number>(); h.work(() => gate.promise);
    const work = h.api.removeSongDownloads(['a']);
    h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: h.first });
    if (fail) gate.reject(new Error('old failure')); else gate.resolve(1);
    await work; assert.equal(h.notices.length, 0);
  }
  const h = harness(); let redownloads = 0; h.work(async () => 1);
  await h.api.removeSongDownloads(['a'], { label: 'Undo', run() { redownloads++; } });
  assert.equal(h.notices[0].message, 'Download removed');
  h.notices[0].action!.run(); assert.equal(redownloads, 1);
  h.auth.setState({ auth: { username: 'B' } }); h.auth.setState({ auth: h.first });
  h.notices[0].action!.run(); assert.equal(redownloads, 1);
});

/** Exercise the real store action with controlled IO and queue ownership. */
function removalStore() {
  const source = readFileSync(new URL('../src/store/downloads.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('downloads.ts', source, ts.ScriptTarget.Latest, true);
  let action: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'deleteSongs') action = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(action);
  const owner = {}, state = { files: { a: 'file:///a', b: 'file:///b' } as Record<string, string>, dlBitRates: {} };
  const records = new Set(['a', 'b']), removedPaths: string[] = [], reads: string[] = [];
  let currentOwner: object = owner, wait: Promise<void> | undefined, epoch = 0;
  const exports: Record<string, any> = {};
  const globals = { exports, Set, get: () => state,
    set: (update: (value: typeof state) => Partial<typeof state>) => Object.assign(state, update(state)),
    useAuthStore: { getState: () => ({ auth: currentOwner }) }, activeServerDir: () => 'file:///account-A/',
    get removalEpoch() { return epoch; }, preflights: [], queue: { forget: () => {} }, resetCatalogCache: () => {},
    locked: async (run: () => Promise<void>) => { await wait; return run(); },
    serverDirs: async () => { assert.fail('should use captured account directory'); },
    Db: { removeFromCatalog: async (dir: string, ids: string[]) => {
      reads.push(dir); const songs = ids.filter((id) => records.delete(id)).map((id) => ({ id, localUri: `file:///${id}` }));
      return { songs, albums: [] };
    }, dropEmptyArtists: async () => [] },
    FileSystem: { deleteAsync: async (path: string) => { removedPaths.push(path); } },
    siblingLrcUri: () => null, forgetCover: () => {}, invalidate: () => {},
  };
  runInNewContext(ts.transpileModule(`exports.remove=${action.getText(ast)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, globals);
  return { api: exports, state, reads, removedPaths,
    wait: (promise: Promise<void>) => { wait = promise; }, switchOwner: () => { currentOwner = {}; epoch++; } };
}

test('music deletion filters missing and duplicate requests and returns the removed records', async () => {
  const h = removalStore(); assert.equal(await h.api.remove(['a', 'a', 'absent']), 1);
  assert.deepEqual(h.reads, ['file:///account-A/']); assert.deepEqual(h.removedPaths, ['file:///a']);
  assert.equal(h.state.files.b, 'file:///b'); assert.equal(await h.api.remove(['a', 'absent']), 0);
  assert.equal(h.reads.length, 1);
});

test('a queued deletion cannot select or modify the next account catalog', async () => {
  const h = removalStore(), gate = deferred<void>(); h.wait(gate.promise);
  const work = h.api.remove(['a']), rejected = assert.rejects(work, /owner changed/);
  h.switchOwner(); gate.resolve(); await rejected; assert.equal(h.reads.length, 0); assert.equal(h.removedPaths.length, 0);
});
