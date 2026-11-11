import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createStore } from 'zustand/vanilla';
import * as models from '../src/lib/metadata/models';
import * as runLock from '../src/lib/metadata/runLock';
import * as jobs from '../src/lib/metadata/jobs';
import * as config from '../src/lib/metadata/config';
import * as registry from '../src/lib/metadata/artworkRegistry';
import { lyricRecordingKey } from '../src/lib/lyricDocuments';

function harness() {
  const first = { username: 'A' }, auth = createStore<any>(() => ({ auth: first, offline: false, autoOffline: false, offlineSource: null }));
  let epoch = 0, calls = 0, flushes = 0, releases = 0, applyGate: Promise<void> | undefined, inside = false;
  const song = { id: 's', title: 'Song', artist: 'Artist', duration: 100 }, candidate = { id: 'p:1', externalId: '1', provider: 'itunes', fields: { title: 'Corrected' }, confident: true };
  const records = new Map<string, any>(), writes: any[] = [];
  const scope = () => ({ profile: auth.getState().auth.username, source: 'server' });
  const operation = (selected = scope(), signal?: AbortSignal, extra = () => true) => { const token = epoch; return { scope: selected, signal, current: () => epoch === token && selected.profile === scope().profile && extra() }; };
  const repository = { metadataOperation: operation,
    saveMetadataRecord: async (kind: string, id: string, value: unknown, owner: any) => { models.metadataCheck(owner); records.set(`${owner.scope.profile}:${kind}:${id}`, JSON.parse(JSON.stringify(value))); },
    readMetadataRecord: async (kind: string, id: string, owner: any) => { models.metadataCheck(owner); return records.get(`${owner.scope.profile}:${kind}:${id}`); },
    listMetadataRecords: async (kind: string, owner: any) => { models.metadataCheck(owner); return [...records].filter(([key]) => key.startsWith(`${owner.scope.profile}:${kind}:`)).map(([key, value]) => ({ id: key.split(':').slice(2).join(':'), value })); },
  };
  const dependencies: Record<string, unknown> = { zustand: { create: (fn: any) => createStore(fn) }, './auth': { useAuthStore: auth }, '@/api/data': { getSong: async () => song },
    '@/lib/backgroundWork': { acquireBackgroundWork: async () => ({ active: () => true, update() {}, release: async () => { releases++; } }) },
    '@/lib/lyricDocuments': { lyricRecordingKey }, '@/lib/localCustomizations': { customizationScope: scope, publishLocalCustomizationChanges: () => { flushes++; } },
    './localMetadata': { scopeKey: (value: any) => `${value.profile}|${value.source}`, useLocalMetadata: { getState: () => ({ hydrate: async () => {} }) } },
    '@/lib/sourceSongMetadata': { sourceSong: (value: unknown) => value }, '@/lib/metadata/jobs': jobs,
    '@/lib/metadata/apply': { applyMetadataCandidate: async (...args: any[]) => { inside = true; if (applyGate) await applyGate; assert.equal(args[6], false); assert.ok(args[4].current()); writes.push(args); } },
    '@/lib/metadata/providers': { searchMetadata: async () => { calls++; return { candidates: [candidate], issues: [] }; }, resolveMetadataCandidateForFields: async () => candidate },
    '@/lib/metadata/artwork': { fetchMetadataArtwork: async () => {} }, '@/lib/metadata/repository': repository, '@/lib/metadata/models': models, '@/lib/metadata/config': config,
    '@/lib/metadata/artworkRegistry': registry, '@/lib/metadata/runLock':runLock };
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/store/metadataScraping.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, Math, AbortController, require(name: string) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return { store: exports.useMetadataScraping, records, song, writes, calls: () => calls, flushes: () => flushes, releases: () => releases, inside: () => inside,
    gate: (value: Promise<void>) => { applyGate = value; }, aba: () => { epoch++; auth.setState({ auth: { username: 'B' } }); auth.setState({ auth: first }); } };
}
const until = async (predicate: () => boolean) => { const end = Date.now() + 1000; while (!predicate()) { if (Date.now() > end) throw new Error('Expected milestone not reached'); await new Promise<void>((resolve) => setTimeout(resolve, 1)); } };
test('real metadata store hydrates interrupted tasks as paused without starting network work', async () => {
  const h = harness(), job = { ...jobs.createMetadataJob([h.song], 'Interrupted', ['title'], true), status: 'running' };
  h.records.set(`A:job:${job.id}`, job); await h.store.getState().hydrate();
  assert.equal(h.store.getState().jobs[0].status, 'paused'); assert.equal(h.calls(), 0); assert.equal(h.writes.length, 0);
});
test('real metadata store pauses only after an accepted write drains, releases its lease and flushes the final short batch', async () => {
  const h = harness(); let release!: () => void; h.gate(new Promise<void>((resolve) => { release = resolve; }));
  const id = await h.store.getState().start([h.song], 'Batch', ['title'], true); await until(h.inside);
  let stopped = false; const stopping = h.store.getState().stop(id).then(() => { stopped = true; });
  await new Promise<void>((resolve) => setTimeout(resolve, 5)); assert.equal(stopped, false);
  release(); await stopping; assert.equal(h.writes.length, 1); assert.ok(h.flushes() > 0); assert.equal(h.releases(), 1);
  assert.equal(h.records.get(`A:job:${id}`).status, 'paused');
});
test('actual store owner fence aborts an old account and a captured target never revives after ABA', async () => {
  const h = harness(); h.store.getState().open({ kind: 'song', id: h.song.id, songs: [h.song] });
  const old = h.store.getState().target; assert.equal(old.current(), true); h.aba();
  assert.equal(old.current(), false); assert.equal(h.store.getState().target, null); assert.equal(h.store.getState().scope, '');
});
