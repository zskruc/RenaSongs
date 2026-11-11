/** Short-lived, account-owned ID handoff to the bulk metadata chooser. */
import type { Song } from '@/api/subsonic';
import { captureCustomizationOwner } from '@/lib/localCustomizations';
import { useAuthStore } from './auth';

let sequence = 0, subscribed = false;
let selection: { key: string; ids: string[]; current: () => boolean } | undefined;

function installOwnerFence() {
  if (subscribed) return;
  subscribed = true;
  useAuthStore.subscribe((next, before) => {
    if (next.auth !== before.auth || next.offline !== before.offline
      || next.offlineSource !== before.offlineSource || next.autoOffline !== before.autoOffline) selection = undefined;
  });
}

/** Keeps every unique song ID; full Song records, URLs and artwork are never retained. */
export function createSelectedMetadataSongs(songs: readonly Pick<Song, 'id'>[]): string {
  installOwnerFence();
  const current = captureCustomizationOwner();
  if (!current()) throw new Error('Metadata selection owner changed');
  if (!songs.length || songs.some((song) => typeof song.id !== 'string' || !song.id.length || song.id.length > 2048 || /[\u0000-\u001f]/.test(song.id))) {
    throw new Error('Invalid metadata song selection');
  }
  const ids = [...new Set(songs.map((song) => song.id))];
  const key = `metadata-selection-${Date.now().toString(36)}-${++sequence}`;
  selection = { key, ids, current };
  return key;
}

/** A copied ID list remains readable until task creation succeeds or this owner leaves. */
export function readSelectedMetadataSongs(key: string): string[] | null {
  if (!selection || selection.key !== key) return null;
  if (!selection.current()) { selection = undefined; return null; }
  return [...selection.ids];
}

export function clearSelectedMetadataSongs(key?: string): void {
  if (key === undefined || selection?.key === key) selection = undefined;
}
