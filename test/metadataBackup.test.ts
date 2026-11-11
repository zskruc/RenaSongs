import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as models from '../src/lib/metadata/models';
import * as archives from '../src/lib/metadata/archiveModels';
import * as imageHeader from '../src/lib/metadata/imageHeader';
import { validatePersonalBackup } from '../src/lib/personalBackupModels';

function load(path: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, Math, setTimeout, clearTimeout, Uint8Array, DataView, atob, require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } }); return exports;
}
const gif = Uint8Array.from([71, 73, 70, 56, 57, 97, 100, 0, 100, 0, 1, 2, 3]);
function harness() {
  let current = true;
  const files = new Map<string, Uint8Array>([['file:///app/metadata-artwork/hash/hash/original.gif', gif]]), records: any[] = [];
  const refs = [{ source: 'server', id: 'album:album', value: { uri: 'file:///app/metadata-artwork/hash/hash/original.gif', mime: 'image/gif', bytes: gif.length } }];
  const fs = { documentDirectory: 'file:///app/', cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' },
    getInfoAsync: async (uri: string) => ({ exists: files.has(uri), isDirectory: false, size: files.get(uri)?.length }), makeDirectoryAsync: async () => {},
    readAsStringAsync: async (uri: string) => Buffer.from(files.get(uri)!).toString('base64'), writeAsStringAsync: async (uri: string, body: string) => { files.set(uri, new Uint8Array(Buffer.from(body, 'base64'))); },
    copyAsync: async ({ from, to }: { from: string; to: string }) => { files.set(to, files.get(from)!.slice()); }, deleteAsync: async (uri: string) => { files.delete(uri); } };
  const operation = { scope: { profile: 'A', source: 'server' }, current: () => current };
  const repository = { metadataOperation: () => operation, readMetadataRecord: async () => undefined,
    saveMetadataRecord: async (...args: any[]) => { models.metadataCheck(args[3]); records.push(args); },
    metadataArtworkReferences: async () => refs,
    exportMetadataProfile: async () => ({ version: 1, entries: [] }), restoreMetadataProfile: async (_profile: unknown, _value: unknown, guard: () => boolean) => { assert.ok(guard()); } };
  const artwork = load('../src/lib/metadata/artwork.ts', { 'expo-file-system/legacy': fs, '@/lib/localLibrary': { hashKey: () => 'hash' },
    '@/api/netGate': { isManualOffline: () => false }, './models': models, './repository': repository, './imageHeader': imageHeader });
  const backup = load('../src/lib/metadata/backup.ts', { 'expo-file-system/legacy': fs, '@/lib/localLibrary': { hashKey: () => 'hash' },
    '@/lib/localCustomizations': { customizationScope: () => operation.scope }, './models': models, './archiveModels': archives, './repository': repository, './artwork': artwork });
  return { backup, files, records, refs, invalidate: () => { current = false; }, current: () => current };
}
test('metadata backup exports bounded original images and explicitly records omissions; restore produces fresh owned paths', async () => {
  const h = harness();
  const snapshot = await h.backup.exportMetadataBackup('A', h.current, 100000);
  assert.equal(snapshot.assets.length, 1); assert.equal(snapshot.assets[0].base64, Buffer.from(gif).toString('base64')); assert.equal(snapshot.assets[0].mime, 'image/gif');
  assert.ok(!JSON.stringify(snapshot).includes('file:///'));
  const excluded = await h.backup.exportMetadataBackup('A', h.current, 0);
  assert.equal(excluded.assets.length, 0); assert.equal(excluded.omitted[0].reason, 'backup-budget');
  await h.backup.restoreMetadataBackup('A', snapshot, h.current);
  assert.equal(h.records.length, 1); const uri = h.records[0][2].uri;
  assert.match(uri, /^file:\/\/\/app\/metadata-artwork\/hash\/hash\/album-/); assert.notEqual(uri, h.refs[0].value.uri); assert.deepEqual(h.files.get(uri), gif);
  h.invalidate(); await assert.rejects(h.backup.restoreMetadataBackup('A', snapshot, h.current)); assert.equal(h.records.length, 1);
});
test('backup validation rejects disguised bytes, remote/local URI injection and secret-bearing profiles before restore', () => {
  const asset = { source: 'server', kind: 'artist', id: 'artist', mime: 'image/gif', bytes: gif.length, base64: Buffer.from(gif).toString('base64') };
  const value = { version: 1, metadata: { version: 1, entries: [] }, assets: [asset], omitted: [] };
  assert.equal(archives.validateMetadataBackupSnapshot(value).assets[0].bytes, gif.length);
  assert.throws(() => archives.validateMetadataBackupSnapshot({ ...value, assets: [{ ...asset, bytes: gif.length + 1 }] }), /byte count/);
  assert.throws(() => archives.validateMetadataBackupSnapshot({ ...value, assets: [{ ...asset, mime: 'image/png' }] }), /image/);
  assert.throws(() => archives.validateMetadataBackupSnapshot({ ...value, assets: [{ ...asset, base64: 'https://secret.invalid/image' }] }));
  const unsafe = { version: 1, entries: [{ source: 'server', kind: 'provider', id: 'custom', value: { id: 'custom', name: 'Source', version: 1, capabilities: ['lyrics'], secrets: { token: 'private' }, lyrics: { url: 'https://example.test/lyrics', format: 'lrc' } } }] };
  assert.throws(() => archives.validateMetadataArchive(unsafe), /Credentials/);
});
test('existing personal backup format stays compatible and preserves the validated optional metadata block', () => {
  const old = { format: 'resonus-personal-backup', version: 1, createdAt: '2026-11-11', library: 'library', settings: {}, favorites: { songs: [], albums: [], artists: [] }, ratings: [], playlists: [], extras: {} };
  assert.equal(validatePersonalBackup(old, []).metadata, undefined);
  const metadata = { version: 1, metadata: { version: 1, entries: [] }, assets: [{ source: 'server', kind: 'album', id: 'a', mime: 'image/gif', bytes: gif.length, base64: Buffer.from(gif).toString('base64') }], omitted: [] };
  assert.equal(validatePersonalBackup({ ...old, metadata }, []).metadata?.assets[0].id, 'a');
});
