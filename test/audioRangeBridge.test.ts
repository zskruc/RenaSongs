import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function resolver() {
  class Asset {
    uri: string; localUri?: string; name = 'asset'; type = 'mp3';
    constructor(source: { uri: string }) { this.uri = source.uri; }
    static fromModule(id: number) { return new Asset({ uri: `asset://fixture/${id}` }); }
    static fromURI(uri: string) { return new Asset({ uri }); }
    async downloadAsync() { this.localUri = 'file:///app/cached-audio.mp3'; }
  }
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../node_modules/expo-audio/src/utils/resolveSource.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require(name: string) { assert.equal(name, 'expo-asset'); return { Asset }; } });
  return exports;
}

test('actual current source resolver keeps both physical clip bounds and session identity without mutating input', () => {
  const api = resolver();
  const source = Object.freeze({ uri: 'file:///app/whole-album.flac', clipStartSec: 81.25, clipEndSec: 162.5,
    mediaId: 'cue:album:02', metadata: { title: 'Second track', durationMs: 81250 }, headers: { Authorization: 'fixture' } });
  assert.equal(api.resolveSource(source), source);
  assert.equal(api.resolveSource(source).clipStartSec, 81.25);
  assert.equal(api.resolveSource(source).clipEndSec, 162.5);
});

test('actual asset/download resolvers preserve clip bounds when changing only the physical URI', async () => {
  const api = resolver();
  const source = { assetId: 7, clipStartSec: 20, clipEndSec: 40, mediaId: 'cue:two' };
  const resolved = api.resolveSource(source);
  assert.equal(resolved.uri, 'asset://fixture/7'); assert.equal(resolved.clipStartSec, 20); assert.equal(resolved.clipEndSec, 40);
  assert.equal(source.assetId, 7); assert.ok(!Object.hasOwn(source, 'uri'));
  const downloaded = await api.resolveSourceWithDownload({ uri: 'https://fixture.test/album.flac', clipStartSec: 5, clipEndSec: 9 });
  assert.equal(downloaded.uri, 'file:///app/cached-audio.mp3'); assert.equal(downloaded.clipStartSec, 5); assert.equal(downloaded.clipEndSec, 9);
});

for (const path of ['src/Audio.types.ts', 'build/Audio.types.d.ts']) test(`public ${path} declares clip bounds on the actual AudioSource object branch`, () => {
  const source = ts.createSourceFile(path, readFileSync(new URL(`../node_modules/expo-audio/${path}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const alias = source.statements.find((node): node is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(node) && node.name.text === 'AudioSource');
  assert.ok(alias && ts.isUnionTypeNode(alias.type));
  const object = alias.type.types.find(ts.isTypeLiteralNode); assert.ok(object);
  for (const name of ['clipStartSec', 'clipEndSec']) {
    const property: ts.PropertySignature | undefined = object.members.find((node): node is ts.PropertySignature => ts.isPropertySignature(node) && node.name.getText(source) === name);
    assert.ok(property?.questionToken && property.type?.kind === ts.SyntaxKind.NumberKeyword, `${name} must be accepted on replace/setNextSource input`);
  }
});
