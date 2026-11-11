/** Imported copies are app-owned. Original documents and network storage are never removed. */
import * as FileSystem from 'expo-file-system/legacy';
import type { Song } from '@/api/subsonic';
import type { CustomizationScope } from './localCustomizations';
import { hashKey } from './localLibrary';
import { readListeningExtra, updateListeningExtra } from './listeningExtras';
import { usePlayerStore } from '@/store/player';
import { beginCueCleanupLease, beginCueImportLease, cueCleanupActive } from './cueDeletionLease';
export const cueImportDirectory = (scope: CustomizationScope) => `${FileSystem.documentDirectory}cue-audio/${hashKey(scope.profile + '|' + scope.source)}/`;
const keyOf = (scope: CustomizationScope) => JSON.stringify([scope.profile, scope.source]);
const jobs = new Map<string, Set<Promise<void>>>(), generations = new Map<string, number>(), stopping = new Map<string, number>();
function job(profile: string) {
  if (stopping.has(profile)) throw new Error('This profile is being removed.');
  const token = generations.get(profile) ?? 0;
  let finish!: () => void; const done = new Promise<void>((yes) => { finish = yes; });
  const active = jobs.get(profile) ?? new Set<Promise<void>>(); active.add(done); jobs.set(profile, active); let released = false;
  return { current: () => !stopping.has(profile) && token === (generations.get(profile) ?? 0), release: () => { if (released) return; released = true; active.delete(done); if (!active.size) jobs.delete(profile); finish(); } };
}
export function beginCueImport(scope: CustomizationScope): { current: () => boolean; release: () => void } {
  const task = job(scope.profile);
  try { const release = beginCueImportLease(keyOf(scope)); return { current: task.current, release: () => { release(); task.release(); } }; }
  catch (error) { task.release(); throw error; }
}
/** Hold the returned release until profile databases/files have been removed. */
export async function stopCueProfile(profile: string): Promise<() => void> {
  stopping.set(profile, (stopping.get(profile) ?? 0) + 1); generations.set(profile, (generations.get(profile) ?? 0) + 1);
  await Promise.all([...(jobs.get(profile) ?? [])]);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (stopping.get(profile) ?? 1) - 1;
    if (remaining) stopping.set(profile, remaining); else stopping.delete(profile);
  };
}
/** Record the source before native file creation, so profile deletion also
 * finds failed-copy remnants if a previous filesystem cleanup failed. */
export async function reserveCueImport(scope: CustomizationScope, current: () => boolean, trackCount = 0): Promise<void> {
  await updateListeningExtra<Song[]>('cue-catalog', (previous = []) => {
    if (!Array.isArray(previous) || previous.length + trackCount > 500) throw new Error('CUE library supports up to 500 tracks');
    return previous;
  }, scope, () => current() && !stopping.has(scope.profile) && !cueCleanupActive(keyOf(scope)));
}
export async function appendCueTracks(songs: Song[], scope: CustomizationScope, current: () => boolean) {
  const directory = cueImportDirectory(scope), owns = () => current() && !stopping.has(scope.profile) && !cueCleanupActive(keyOf(scope));
  if (!songs.length || songs.some((song) => !song.id.startsWith('cue:') || !song.cueSourceId || !song.localUri?.startsWith(directory) || song.url !== song.localUri
    || !Number.isFinite(song.cueStartSec) || song.cueStartSec! < 0 || song.cueEndSec !== undefined && (!Number.isFinite(song.cueEndSec) || song.cueEndSec <= song.cueStartSec!))) throw new Error('Invalid imported CUE tracks');
  return updateListeningExtra<Song[]>('cue-catalog', (previous = []) => {
    if (!Array.isArray(previous) || previous.length + songs.length > 500) throw new Error('CUE library supports up to 500 tracks');
    const ids = new Set(previous.map((song) => song.id)); for (const song of songs) { if (ids.has(song.id)) throw new Error('CUE track already exists'); ids.add(song.id); }
    return [...previous, ...songs];
  }, scope, owns);
}
export async function clearCueTracks(scope: CustomizationScope, current: () => boolean): Promise<void> {
  const task = job(scope.profile), directory = cueImportDirectory(scope);
  let release: (() => void) | undefined;
  try {
    release = beginCueCleanupLease(keyOf(scope), directory);
    const valid = () => current() && task.current();
    const songs = await readListeningExtra<Song[]>('cue-catalog', scope, valid) ?? [], ids = new Set(songs.map((song) => song.id));
    const owns = () => valid() && !usePlayerStore.getState().queue.some((song) => ids.has(song.id) || !!song.cueSourceId && [song.localUri, song.url].some((uri) => uri?.startsWith(directory)));
    if (!owns()) throw new Error('Remove CUE tracks from the playback queue before clearing their audio');
    // Keep the catalog until deletion succeeds. A failed unlink or DB commit
    // stays visible and can be retried; original documents are never touched.
    // Imports and new playback are excluded for this directory until finally.
    await FileSystem.deleteAsync(directory, { idempotent: true });
    if (!owns()) throw new Error('CUE cleanup was interrupted. Retry clearing the imported tracks.');
    await updateListeningExtra<Song[]>('cue-catalog', () => [], scope, owns);
  } finally { release?.(); task.release(); }
}
/** Account deletion visits source partitions before the media-cache database closes. */
export async function clearCueProfile(profile: string): Promise<void> {
  const { mediaCacheDatabase } = await import('./mediaCacheDb'); const db = await mediaCacheDatabase(hashKey(profile));
  const exists = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='listening_extras'");
  if (!exists) return;
  const rows = await db.getAllAsync<{ source: string }>("SELECT DISTINCT source FROM listening_extras WHERE key='cue-catalog'");
  for (const row of rows) await FileSystem.deleteAsync(cueImportDirectory({profile,source:row.source}), { idempotent: true });
}
