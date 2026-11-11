/**
 * Offline action queue (outbox) per server profile.
 *
 * With a server account in offline mode, mutations (favorite, rate, edit
 * playlists…) don't reach the server: they are recorded here, reflected
 * immediately on the library mirror, and flushed to the server when going back
 * online (see auth.goOnline). The local profile (no account) doesn't use this
 * queue.
 *
 * It also carries what isn't a change to the library but still belongs to the
 * server: the songs listened to while there was no way to reach it.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';

import type { Song, StarType, SubsonicAuth } from '@/api/subsonic';
import { hashKey } from '@/lib/localLibrary';
import type { Remap } from '@/lib/navidromeRemap';
import { remapOutbox } from '@/lib/navidromeRemap';
import { primaryUrl } from '@/lib/serverUrls';
import { useAuthStore } from './auth';

const DIR = FileSystem.documentDirectory + 'offline-queue/';

/** Desired state of a favorite (last-write-wins by id). */
interface FavOp {
  type: StarType;
  starred: boolean;
}

/**
 * Desired state of a playlist after offline edits. Instead of a log of
 * add/remove/reorder, we store the final result (Subsonic rewrites the entire
 * playlist with `reorderPlaylist`, avoiding the mess of indices on sync). The
 * key can be a server id or a temporary id `tmp_…` (playlist created offline,
 * which gets its real id on sync).
 */
interface QueuePlaylist {
  /** Playlist created offline (key is a temporary id). */
  created?: boolean;
  /** Real id already allocated; verify new-list identity before retrying fill. */
  needsInitialVerification?: boolean;
  createdName?: string;
  /** Marked for deletion. */
  deleted?: boolean;
  name?: string;
  comment?: string;
  public?: boolean;
  /** Desired final tracklist (song ids); undefined = no change. */
  songIds?: string[];
}

/**
 * A listen that happened offline. Not last-write-wins like the rest of the
 * outbox: playing the same song twice is two listens, and each carries the
 * moment it happened so the server's history keeps its shape on upload.
 */
interface PlayOp {
  id: string;
  /** ms since epoch. */
  at: number;
}

interface QueueData {
  /** id → desired favorite state. */
  favs?: Record<string, FavOp>;
  /** Song id → desired rating (1-5; 0 = unrated). */
  ratings?: Record<string, number>;
  /** Playlist id (server or `tmp_…`) → desired state after editing it offline. */
  playlists?: Record<string, QueuePlaylist>;
  /** Metadata for songs added offline, to show them in playlists. */
  songMeta?: Record<string, Song>;
  /** Listens to scrobble on reconnect, oldest first. */
  plays?: PlayOp[];
  /** Retained intent for confirmed missing server objects; not automatically retried. */
  blockedFavs?: Record<string, FavOp>;
  blockedRatings?: Record<string, number>;
}

export type { PlayOp, QueuePlaylist };

/**
 * Ceiling on queued listens. A day and a half of music without a network is
 * already generous, and the alternative is a file that grows for as long as
 * the trip lasts. Past it the oldest ones go: they are the ones the server's
 * history misses the least.
 */
const PLAYS_MAX = 500;

/** The outbox file of an account; `loadedFile` equal to it means memory is its queue. */
export function outboxFileFor(auth: SubsonicAuth): string {
  return `${DIR}${hashKey(`${primaryUrl(auth)}|${auth.username}`)}.json`;
}

function activeFile(): string | null {
  const auth = useAuthStore.getState().auth;
  return auth ? outboxFileFor(auth) : null;
}

interface QueueState {
  data: QueueData;
  loadedFile: string | null;
  load: () => Promise<void>;
  /** Records the desired state of a favorite (offline). */
  setFav: (id: string, type: StarType, starred: boolean) => void;
  /** Clears the favorites queue (after flushing to server). */
  clearFavs: () => void;
  /** Records the desired rating for a song (offline). */
  setRating: (id: string, rating: number) => void;
  /** Clears the ratings queue (after flushing to server). */
  clearRatings: () => void;
  /** Merges changes into the desired state of a playlist. */
  setPlaylist: (id: string, patch: Partial<QueuePlaylist>) => void;
  /** Removes a playlist's queue entry (created-and-deleted, or after sync). */
  removePlaylistEntry: (id: string) => void;
  /** Stores song metadata to display them when editing playlists offline. */
  rememberSongs: (songs: Song[]) => void;
  /** Clears playlist edits (after flushing to server). */
  clearPlaylists: () => void;
  /** Rewrites every queued id, after the server migrated its own (#5824). */
  remapIds: (f: Remap) => void;
  /** Records a listen that happened offline. */
  addPlay: (id: string, at: number) => void;
  /** Drops the listens already uploaded, leaving the rest (and any that
   *  arrived while uploading) in the queue. */
  removePlays: (done: PlayOp[]) => void;
  /** Is there anything pending to sync? */
  isEmpty: () => boolean;
  error?: string;
  flushPersistence: () => Promise<void>;
  checkpointPlaylistCreated: (temporary: string, real: string, fallback: QueuePlaylist, owner?: SubsonicAuth) => Promise<QueuePlaylist>;
  acknowledgePlaylist: (id: string, expected: QueuePlaylist) => void;
  settleFavs: (original: Record<string, FavOp>, failed: [string, FavOp][], blocked: [string, FavOp][]) => void;
  settleRatings: (original: Record<string, number>, failed: [string, number][], blocked: [string, number][]) => void;
}

type PendingMutation = (data: QueueData) => QueueData;
interface FileEntry { file: string; data: QueueData; loaded: boolean; pending: PendingMutation[]; reading?: Promise<void> }
const entries = new Map<string, FileEntry>();
const retired = new Map<string, object | null>();
let writeLock: Promise<unknown> = Promise.resolve();

/** Waits before profile-directory deletion; an already-admitted native write
 * cannot subsequently recreate that profile's file. */
export async function stopOfflineQueueProfile(auth: SubsonicAuth): Promise<void> {
  const file = outboxFileFor(auth); retired.set(file, auth); entries.delete(file);
  await writeLock.catch(() => {});
}

export const useOfflineQueue = create<QueueState>((set) => {
  let watching = false;
  const selected = (entry: FileEntry) => activeFile() === entry.file && entries.get(entry.file) === entry;
  const publish = (entry: FileEntry) => { if (selected(entry)) set({ data: entry.data, loadedFile: entry.loaded ? entry.file : null, error: undefined }); };
  function active(): FileEntry | null {
    if (!watching) {
      watching = true;
      useAuthStore.subscribe((next, before) => {
        if (next.auth === before.auth) return;
        const file = activeFile(), entry = file ? entries.get(file) : undefined;
        set({ data: entry?.data ?? {}, loadedFile: entry?.loaded ? file : null, error: undefined });
      });
    }
    const file = activeFile(); if (!file) return null;
    const auth = useAuthStore.getState().auth;
    if (retired.get(file) === auth) throw new Error('Offline queue profile was deleted');
    retired.delete(file);
    let entry = entries.get(file);
    if (!entry) { entry = { file, data: {}, loaded: false, pending: [] }; entries.set(file, entry); }
    return entry;
  }
  const alive = (entry: FileEntry) => { if (entries.get(entry.file) !== entry) throw new Error('Offline queue profile was deleted'); };
  async function read(entry: FileEntry): Promise<void> {
    alive(entry); if (entry.loaded) return; if (entry.reading) return entry.reading;
    entry.reading = (async () => {
      const info = await FileSystem.getInfoAsync(entry.file); alive(entry);
      let disk: QueueData = {};
      if (info.exists) {
        const parsed: unknown = JSON.parse(await FileSystem.readAsStringAsync(entry.file)); alive(entry);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid offline queue file');
        disk = parsed as QueueData;
      }
      for (const apply of entry.pending) disk = apply(disk);
      entry.data = disk; entry.pending = []; entry.loaded = true; publish(entry);
    })().finally(() => { entry.reading = undefined; });
    return entry.reading;
  }
  function persist(entry: FileEntry): Promise<void> {
    const work = writeLock.catch(() => {}).then(async () => {
      await read(entry); alive(entry);
      // Take the merged value after hydration, not the empty pre-read snapshot.
      const text = JSON.stringify(entry.data);
      await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }); alive(entry);
      await FileSystem.writeAsStringAsync(entry.file, text); alive(entry);
    });
    writeLock = work;
    void work.catch(() => { if (selected(entry)) set({ error: 'Could not save pending changes' }); });
    return work;
  }
  function updateEntry(entry: FileEntry, apply: PendingMutation): FileEntry {
    alive(entry);
    entry.data = apply(entry.data); if (!entry.loaded) entry.pending.push(apply);
    publish(entry); void persist(entry); return entry;
  }
  function update(apply: PendingMutation): FileEntry | null { const entry = active(); return entry ? updateEntry(entry, apply) : null; }
  return {
    data: {}, loadedFile: null,
    load: async () => { const entry = active(); if (!entry) { set({ data: {}, loadedFile: null }); return; } await read(entry); publish(entry); },
    flushPersistence: async () => { const entry = active(); if (entry) await persist(entry); },
    setFav: (id, type, starred) => { update((data) => { const blockedFavs = { ...data.blockedFavs }; delete blockedFavs[id]; return { ...data, blockedFavs, favs: { ...data.favs, [id]: { type, starred } } }; }); },
    clearFavs: () => { update((data) => ({ ...data, favs: {} })); },
    setRating: (id, rating) => { update((data) => { const blockedRatings = { ...data.blockedRatings }; delete blockedRatings[id]; return { ...data, blockedRatings, ratings: { ...data.ratings, [id]: rating } }; }); },
    clearRatings: () => { update((data) => ({ ...data, ratings: {} })); },
    setPlaylist: (id, patch) => { const value = { ...patch }; update((data) => ({ ...data, playlists: { ...data.playlists, [id]: { ...data.playlists?.[id], ...value } } })); },
    removePlaylistEntry: (id) => { update((data) => { const playlists = { ...data.playlists }; delete playlists[id]; return { ...data, playlists }; }); },
    rememberSongs: (songs) => { const copied = songs.map((song) => ({ ...song })); update((data) => ({ ...data, songMeta: { ...data.songMeta, ...Object.fromEntries(copied.map((song) => [song.id, song])) } })); },
    clearPlaylists: () => { update((data) => ({ ...data, playlists: {}, songMeta: {} })); },
    addPlay: (id, at) => { update((data) => { const plays = [...(data.plays ?? []), { id, at }]; const seen = new Set<string>(); return { ...data, plays: plays.sort((a,b) => a.at-b.at).filter((play) => { const key = `${play.at}|${play.id}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(-PLAYS_MAX) }; }); },
    removePlays: (done) => { const sent = new Set(done.map((p) => `${p.at}|${p.id}`)); update((data) => ({ ...data, plays: (data.plays ?? []).filter((p) => !sent.has(`${p.at}|${p.id}`)) })); },
    remapIds: (f) => { update((data) => remapOutbox(data, f)); },
    checkpointPlaylistCreated: async (temporary, real, fallback, owner) => {
      if (!real || real === temporary) throw new Error('Invalid created playlist identity');
      // The create request may finish after an account switch. Its returned ID
      // belongs to the already-read original outbox, never the newly active one.
      const target = owner ? entries.get(outboxFileFor(owner)) : active();
      if (!target || owner && retired.get(target.file) === owner) throw new Error('Offline queue profile changed');
      let value!: QueuePlaylist;
      const entry = updateEntry(target, (data) => {
        const previous = data.playlists?.[temporary];
        value = { ...(previous ?? fallback), created: false, needsInitialVerification: true,
          createdName: fallback.name ?? '', ...(!previous ? { deleted: true } : {}) };
        const playlists = { ...data.playlists }; delete playlists[temporary]; playlists[real] = value;
        return { ...data, playlists };
      });
      if (!entry) throw new Error('Offline queue profile changed');
      await persist(entry); return value;
    },
    acknowledgePlaylist: (id, expected) => { update((data) => { if (data.playlists?.[id] !== expected) return data; const playlists = { ...data.playlists }; delete playlists[id]; return { ...data, playlists }; }); },
    settleFavs: (original, failed, blocked) => { update((data) => {
      const favs = { ...data.favs }, blockedFavs = { ...data.blockedFavs }, retries = new Map(failed), missing = new Map(blocked);
      for (const [id, expected] of Object.entries(original)) if (favs[id] === expected) { delete favs[id]; if (retries.has(id)) favs[id] = retries.get(id)!; if (missing.has(id)) blockedFavs[id] = missing.get(id)!; }
      return { ...data, favs, blockedFavs };
    }); },
    settleRatings: (original, failed, blocked) => { update((data) => {
      const ratings = { ...data.ratings }, blockedRatings = { ...data.blockedRatings }, retries = new Map(failed), missing = new Map(blocked);
      for (const [id, expected] of Object.entries(original)) if (ratings[id] === expected) { delete ratings[id]; if (retries.has(id)) ratings[id] = retries.get(id)!; if (missing.has(id)) blockedRatings[id] = missing.get(id)!; }
      return { ...data, ratings, blockedRatings };
    }); },
    isEmpty: () => { const entry = active(); const d = entry?.data ?? {}; return !Object.keys(d.favs ?? {}).length && !Object.keys(d.ratings ?? {}).length && !Object.keys(d.playlists ?? {}).length && !d.plays?.length; },
  };
});
