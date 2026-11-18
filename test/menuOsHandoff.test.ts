import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { MenuMorphSession } from '../src/lib/menuMorph';
import { MenuRequestScope } from '../src/lib/menuRequest';
import { MenuItemRegistry } from '../src/lib/menuItems';

/** Execute the production action, not a reconstructed implementation. */
function action(name: 'saveToFolder' | 'sendToApp' | 'exportM3u', folder: string | null = 'folder') {
  const file = name === 'exportM3u' ? 'MediaMenuSheet.tsx' : 'SongMenuSheet.tsx';
  const source = ts.createSourceFile(file, readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node; ts.forEachChild(node, visit); };
  visit(source); assert.ok(declaration);
  const requests = new MenuRequestScope(), native = new MenuMorphSession(); const id = native.begin();
  const calls = { picker: 0, share: 0, exports: 0, closes: 0, toasts: 0 };
  let mounted = true;
  const context: Record<string, any> = { exports: {}, requests, actionClosing: { current: false },
    song: { id: 'song' }, dlUri: 'local-song', playlist: { id: 'playlist' }, local: true,
    metadataOwner: () => true, isOpenSession: () => mounted,
    beginRequest: () => requests.begin(),
    closeNow: () => { if (!mounted) return false; mounted = false; calls.closes++; return true; },
    dismiss: (after: () => void) => native.close(after),
    pickFolder: async () => { calls.picker++; return folder; },
    exportToFolder: async () => { calls.exports++; return 'song.flac'; },
    exportPlaylistFile: async () => { calls.exports++; },
    shareSongFile: async () => { calls.share++; return true; },
    toast: () => calls.toasts++, t: (text: string) => text,
  };
  runInNewContext(ts.transpileModule(`${declaration.getText(source)}\nexports.run = ${name};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { calls, requests, native, id, run: context.exports.run as () => Promise<void>, mounted: () => mounted };
}

for (const name of ['saveToFolder', 'sendToApp', 'exportM3u'] as const) {
  test(`${name} retains its card, hands over after native completion once, and rejects stale ownership`, async () => {
    const h = action(name); await h.run();
    assert.equal(h.mounted(), true); assert.equal(h.calls.picker + h.calls.share, 0);
    assert.equal(h.native.complete(h.id, false), true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(h.calls.closes, 1); assert.equal(h.calls.picker + h.calls.share, 1);
    assert.equal(h.native.complete(h.id, false), false);
    assert.equal(h.calls.picker + h.calls.share, 1);
    const stale = action(name); await stale.run(); stale.requests.dispose();
    stale.native.complete(stale.id, false); await Promise.resolve();
    assert.equal(stale.calls.picker + stale.calls.share + stale.calls.closes, 0);
  });
}
test('cancelled folder choice never exports or announces success', async () => {
  const h = action('saveToFolder', null); await h.run(); h.native.complete(h.id, false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.calls.picker, 1); assert.equal(h.calls.exports, 0); assert.equal(h.calls.toasts, 0);
});

for (const name of ['askDownload', 'askExport'] as const) {
  test(`${name} lookup failures retain an interactive menu for retry and another option`, async () => {
    const text = readFileSync(new URL('../src/components/MediaMenuSheet.tsx', import.meta.url), 'utf8');
    const source = ts.createSourceFile('MediaMenuSheet.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let declaration: ts.FunctionDeclaration | undefined, keepOpen = false;
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'Action' &&
        node.attributes.getText(source).includes(`void ${name}()`))
        keepOpen = node.attributes.properties.some((prop) => ts.isJsxAttribute(prop) && prop.name.getText(source) === 'keepOpen');
      ts.forEachChild(node, visit);
    };
    visit(source); assert.ok(declaration);
    const requests = new MenuRequestScope(), registry = new MenuItemRegistry(), owner = {};
    let attempts = 0, notices = 0, prompts = 0, other = 0, work: Promise<void> | undefined;
    const context: Record<string, any> = { exports: {}, item: {}, files: { song: 'uri' },
      isOpenSession: () => true, beginRequest: () => requests.begin(), ownsConfirmation: (ticket: number) => requests.owns(ticket),
      fetchSongs: async () => { if (++attempts === 1) throw new Error('offline'); return [{ id: 'song' }]; },
      setPending: () => prompts++, setPendingExport: () => prompts++, totalBytes: () => 1,
      toast: () => notices++, t: (value: string) => value, close: () => assert.fail('failure must not close its menu'),
    };
    runInNewContext(ts.transpileModule(`${declaration.getText(source)}\nexports.run = ${name};`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    registry.setSession(4, true);
    registry.register('lookup', owner, { tag: 1, enabled: true, selected: false, keepOpen,
      action: () => { work = context.exports.run(); } });
    registry.register('other', {}, { tag: 2, enabled: true, selected: false, keepOpen: true, action: () => other++ });
    assert.equal(registry.select({ sessionId: 4, rowId: 'lookup', gestureId: 1 }), true); await work;
    assert.equal(notices, 1); assert.equal(prompts, 0);
    assert.equal(registry.select({ sessionId: 4, rowId: 'other', gestureId: 2 }), true); assert.equal(other, 1);
    assert.equal(registry.select({ sessionId: 4, rowId: 'lookup', gestureId: 3 }), true); await work;
    assert.equal(attempts, 2); assert.equal(prompts, 1);
  });
}
