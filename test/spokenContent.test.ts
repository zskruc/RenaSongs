import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { songContentKind } from '../src/lib/contentKind';
import { isAudiobookSong } from '../src/lib/audiobook';
import type { Song } from '../src/api/subsonic';
test('the actual in-memory classifier honors current-source corrections, explicit music and RSS, without database reads', () => {
  const state = { ready: true, scope: 'A|server', songs: { song: { patch: { mediaKind: 'podcast' } } } };
  const imports = { '@/store/albumProgress': { isAudiobookTrack: isAudiobookSong }, '@/store/localMetadata': { scopeKey: (s: any) => `${s.profile}|${s.source}`, useLocalMetadata: { getState: () => state } },
    './localCustomizations': { customizationScope: () => ({ profile: 'A', source: 'server' }) }, './contentKind': { songContentKind } };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/currentContentKind.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (key: string) => { assert.ok(Object.hasOwn(imports, key), key); return imports[key as keyof typeof imports]; } });
  assert.equal(exports.getSongContentKind({ id: 'song', title: 'Song' }), 'podcast');
  state.scope = 'B|server'; assert.equal(exports.getSongContentKind({ id: 'song', title: 'Song' }), 'music');
  assert.equal(exports.getSongContentKind({ id: 'book', title: 'Book', genre: 'Audiobook' }), 'audiobook');
  assert.equal(exports.getSongContentKind({ id: 'rss', title: 'RSS', podcastChannelId: 'channel' }), 'podcast');
  assert.equal(exports.getSongContentKind({ id: 'cue:x:1', title: 'Cue', url: 'file:///music.flac', genre: 'Audiobook', mediaKind: 'music' }), 'music');
});
test('actual playback thresholds do not send spoken content or local CUE IDs to the NAS, but still count local CUE music', async () => {
  const tree = ts.createSourceFile('player.ts', readFileSync(new URL('../src/store/player.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = ['maybeScrobbleThreshold', 'reportState'].map((name) => tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)!.getText(tree)).join('\n');
  const counter: string[] = [], outbox: string[] = [], server: string[] = [], state: { queue: Song[]; index: number; durationSec: number } = { queue: [], index: 0, durationSec: 100 };
  const auth = { username: 'me' }, context: Record<string, any> = { exports: {}, scrobbledThisTrack: false, Date,
    isSpokenContent: (song: Song) => songContentKind(song) !== 'music', usePlayerStore: { getState: () => state }, useSettings: { getState: () => ({ scrobblePercent: 0, scrobbleSeconds: 1 }) },
    scrobbleThresholdSec: () => 1, usePlayCounts: { getState: () => ({ bump: (id: string) => counter.push(id) }) },
    useAuthStore: { getState: () => ({ auth, offline: false }) }, useOfflineQueue: { getState: () => ({ addPlay: (id: string) => outbox.push(id) }) },
    bump() {}, scrobble: async (_a: unknown, id: string) => { server.push(id); }, ensurePlaybackReportSupport: async () => true,
    noteOwnReport() {}, reportPlayback: async (_a: unknown, id: string) => { server.push(id); } };
  runInNewContext(ts.transpileModule(functions + '\nexports.threshold=maybeScrobbleThreshold;exports.report=reportState;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  for (const song of [{ id: 'book', title: 'Chapter', mediaKind: 'audiobook' }, { id: 'episode', title: 'Episode', mediaKind: 'podcast' }, { id: 'cue:x:1', title: 'Music', cueSourceId: 'file', url: 'file:///music.flac', mediaKind: 'music' }] as Song[]) {
    context.scrobbledThisTrack = false; state.queue = [song]; context.exports.threshold(60); context.exports.report('starting', song, 60);
  }
  await Promise.resolve(); assert.deepEqual(server, []); assert.deepEqual(outbox, []); assert.deepEqual(counter, ['cue:x:1']);
  context.scrobbledThisTrack = false; const song = { id: 'music', title: 'Music' }; state.queue = [song]; context.exports.threshold(60); await Promise.resolve(); assert.deepEqual(server, ['music']);
});
test('the real audiobook predicate honors scoped explicit classifications without making RSS inherit an album book tag', () => {
  const tree = ts.createSourceFile('albumProgress.ts', readFileSync(new URL('../src/store/albumProgress.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const method = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'isAudiobookTrack')!.getText(tree);
  const metadata: any = { ready: true, scope: 'A|server', songs: { file: { patch: { mediaKind: 'audiobook' } } } };
  const context: Record<string, any> = { exports: {}, useLocalMetadata: { getState: () => metadata }, customizationScope: () => ({ profile: 'A', source: 'server' }), scopeKey: (s: any) => `${s.profile}|${s.source}`,
    isAudiobookSong, isAudiobookAlbumId: (id: string) => id === 'book-album' };
  runInNewContext(ts.transpileModule(method + '\nexports.predicate=isAudiobookTrack', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  assert.equal(context.exports.predicate({ id: 'file', title: 'File' }), true);
  metadata.songs.file.patch.mediaKind = 'music'; assert.equal(context.exports.predicate({ id: 'file', title: 'File', albumId: 'book-album' }), false);
  metadata.scope = 'B|server'; assert.equal(context.exports.predicate({ id: 'file', title: 'File' }), false);
  assert.equal(context.exports.predicate({ id: 'rss', title: 'RSS', podcastChannelId: 'channel', albumId: 'book-album', mediaKind: 'audiobook' }), false);
  assert.equal(context.exports.predicate({ id: 'cue:test:1', title: 'Cue', cueSourceId: 'file', mediaKind: 'music', albumId: 'book-album' }), false);
});
