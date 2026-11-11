import { create } from 'zustand';
import { readListeningExtra, writeListeningExtra } from '@/lib/listeningExtras';
import { captureCustomizationOwner, customizationScope, type CustomizationScope } from '@/lib/localCustomizations';
import { validateLocalPodcastProgress, type LocalPodcastProgress, type LocalPodcastProgressMap } from '@/lib/localPodcasts';
import { useAuthStore } from './auth';
const KEY = 'local-podcast-progress-v1';
interface Entry { scope: CustomizationScope; data: LocalPodcastProgressMap; ready: boolean; task?: Promise<void>; }
const entries = new Map<string, Entry>(), queues = new Map<string, Promise<unknown>>(); let watching = false;
const versions = new Map<string, number>(); let sequence = 0;
const keyOf = (scope: CustomizationScope) => JSON.stringify([scope.profile, scope.source]);
export const useLocalPodcasts = create(() => ({ scope: '', ready: false, revision: 0, error: false, progress: {} as LocalPodcastProgressMap }));
function active() {
  if (!watching) { watching = true; useAuthStore.subscribe((next, old) => {
    if (next.auth !== old.auth || next.offlineSource !== old.offlineSource || next.offline !== old.offline || next.autoOffline !== old.autoOffline) {
      entries.clear(); versions.clear(); useLocalPodcasts.setState((state) => ({ scope: '', ready: false, progress: {}, error: false, revision: state.revision + 1 }));
    }
  }); }
  const scope = customizationScope(), key = keyOf(scope), owns = captureCustomizationOwner(scope);
  let entry = entries.get(key); if (!entry) { entry = { scope, data: {}, ready: false }; entries.set(key, entry); }
  const value = entry, current = () => owns() && entries.get(key) === value;
  const check = () => { if (!current()) throw new Error('Local podcast profile changed'); };
  const publish = (error = false) => { if (current()) useLocalPodcasts.setState((state) => ({ scope: key, progress: value.data, ready: value.ready, error, revision: state.revision + 1 })); };
  return { key, entry: value, current, check, publish };
}
async function read(value: ReturnType<typeof active>) {
  value.check(); if (value.entry.ready) return;
  value.entry.task ??= (async () => { const raw = await readListeningExtra(KEY, value.entry.scope, value.current); value.check(); value.entry.data = validateLocalPodcastProgress(raw); value.entry.ready = true; value.publish(); })()
    .catch((error) => { value.publish(true); throw error; }).finally(() => { value.entry.task = undefined; });
  await value.entry.task;
}
export async function loadLocalPodcastProgress(): Promise<LocalPodcastProgressMap> { const value = active(); await read(value); value.check(); return value.entry.data; }
export function localPodcastProgressVersion(id: string): number { return versions.get(`${keyOf(customizationScope())}|${id}`) ?? 0; }
export function saveLocalPodcastProgress(id: string, progress: LocalPodcastProgress, expectedVersion = localPodcastProgressVersion(id)): Promise<void> {
  const value = active();
  const sourceCurrent = value.current, sourceCheck = value.check, versionKey = `${value.key}|${id}`;
  value.current = () => sourceCurrent() && (versions.get(versionKey) ?? 0) === expectedVersion;
  value.check = () => { sourceCheck(); if (!value.current()) throw new Error('Local podcast progress changed'); };
  const task = (queues.get(value.key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await read(value); value.check();
    const next = validateLocalPodcastProgress({ ...value.entry.data, [id]: progress });
    await writeListeningExtra(KEY, next, value.entry.scope, value.current); value.check(); value.entry.data = next; value.publish();
  }).catch((error) => { value.entry.ready = false; value.publish(true); throw error; });
  queues.set(value.key, task); void task.finally(() => { if (queues.get(value.key) === task) queues.delete(value.key); }).catch(() => {}); return task;
}
export function markLocalPodcastPlayed(id: string, played: boolean, durationSec: number): Promise<void> {
  const version = ++sequence; versions.set(`${keyOf(customizationScope())}|${id}`, version);
  return saveLocalPodcastProgress(id, { positionSec: played ? durationSec : 0, durationSec, played, updatedAt: Date.now() }, version);
}
export function localPodcastProgressScope(): string { return keyOf(customizationScope()); }
export async function flushLocalPodcastProgress(): Promise<void> { await queues.get(keyOf(customizationScope())); }
export function invalidateLocalPodcastProgress(): void {
  const key = keyOf(customizationScope()); entries.delete(key);
  useLocalPodcasts.setState((state) => ({ scope: key, ready: false, progress: {}, revision: state.revision + 1 }));
}
