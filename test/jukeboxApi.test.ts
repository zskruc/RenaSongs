import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function source(names: string[]): string {
  const text = readFileSync(new URL('../src/api/subsonic.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('subsonic.ts', text, ts.ScriptTarget.Latest, true);
  return names.map((name) => tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name
    || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === name))!.getText(tree)).join('\n');
}
function evaluate(text: string, context: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, URLSearchParams, ...context });
  return exports;
}

test('jukebox set/add encode repeated IDs individually, in order, without changing ordinary parameters', () => {
  const api = evaluate(source(['buildUrl']) + '\nexport { buildUrl };', { authParams: () => new URLSearchParams({ u: 'test' }) });
  const result = new URL(api.buildUrl({ serverUrl: 'https://server.test' }, 'jukeboxControl.view', { action: 'set', id: ['a', 'b c', 'a'], index: 2, absent: undefined }));
  assert.deepEqual(result.searchParams.getAll('id'), ['a', 'b c', 'a']);
  assert.equal(result.searchParams.get('action'), 'set'); assert.equal(result.searchParams.get('index'), '2'); assert.equal(result.searchParams.has('absent'), false);
});

test('jukebox queue reconciliation accepts an empty server queue and rejects malformed identity data', async () => {
  let reply: unknown = { jukeboxPlaylist: {} };
  const api = evaluate(source(['parseJukeboxStatus', 'jukeboxGet']), { request: async () => reply });
  assert.deepEqual(Array.from((await api.jukeboxGet({})).ids), []);
  reply = { jukeboxPlaylist: { currentIndex: 1, position: 7, playing: true, entry: [{ id: 'a' }, { id: 'b' }] } };
  const result = await api.jukeboxGet({}); assert.deepEqual(Array.from(result.ids), ['a', 'b']); assert.equal(result.currentIndex, 1);
  reply = { jukeboxPlaylist: { entry: [{ title: 'missing ID' }] } };
  await assert.rejects(api.jukeboxGet({}), /Invalid jukebox queue/);
});
