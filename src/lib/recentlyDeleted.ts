/** App-only undo documents. This never deletes audio or files on a server. */
import type { Song, Playlist } from '@/api/subsonic';
import { mediaCacheDatabase } from './mediaCacheDb';
import { hashKey } from './localLibrary';
import { normalizeSmartRule } from './smartRules';
import { personalOwner } from '@/store/playlistRecovery';
import { notifyRecentlyDeleted } from '@/store/recentlyDeleted';
import { safeScraperProfile, validateScraperProfile } from './metadata/config';
import { captureLyricOwner } from './lyricOwner';

export type RecentlyDeletedKind = 'playlist' | 'smart-playlist' | 'scraper-profile';
export interface DeletedPlaylist { version: 1; originalId: string; name: string; comment?: string; public?: boolean; songs: Song[]; }
export interface RecentlyDeletedItem { id: string; kind: RecentlyDeletedKind; title: string; deletedAt: number; payload: unknown; restoredId?: string; confirmed: boolean; }
type Owner = ReturnType<typeof personalOwner>;
export interface RecentlyDeletedTicket { id: string; owner: Owner; }
const generations = new Map<string, number>(), queues = new Map<string, Promise<unknown>>(), ready = new WeakMap<object, Promise<void>>();
export function recentlyDeletedOwner(): Owner {
  const owner = personalOwner(), generation = generations.get(owner.profile) ?? 0, epoch = captureLyricOwner(owner.profile);
  const current = () => owner.current() && epoch() && (generations.get(owner.profile) ?? 0) === generation;
  return { ...owner, current, check: () => { owner.check(); if (!current()) throw new Error('Library changed. Reopen this page.'); } };
}
function serial<T>(owner: Owner, work: () => Promise<T>): Promise<T> {
  const task = (queues.get(owner.profile) ?? Promise.resolve()).catch(() => {}).then(() => { owner.check(); return work(); });
  queues.set(owner.profile, task); void task.finally(() => { if (queues.get(owner.profile) === task) queues.delete(owner.profile); }).catch(() => {}); return task;
}
async function database(profile: string) {
  const db = await mediaCacheDatabase(hashKey(profile)); let pending = ready.get(db);
  if (!pending) { pending = db.execAsync(`CREATE TABLE IF NOT EXISTS recently_deleted(source TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,deleted_at INTEGER NOT NULL,payload TEXT NOT NULL,committed INTEGER NOT NULL DEFAULT 0,restored_id TEXT,PRIMARY KEY(source,id));`).catch((error) => { ready.delete(db); throw error; }); ready.set(db, pending); }
  await pending; return db;
}
const identity = (value: unknown): value is string => typeof value === 'string' && !!value && value.length <= 2048 && !/[\u0000-\u001f]/.test(value);
function safeSong(value: Song): Song {
  if (!value || !identity(value.id) || typeof value.title !== 'string') throw new Error('Invalid deleted playlist');
  const result: Song = { id: value.id, title: value.title.slice(0, 1000) };
  for (const key of ['artist', 'album', 'albumArtist', 'artistId', 'albumId', 'genre'] as const)
    if (typeof value[key] === 'string') Object.assign(result, { [key]: value[key].slice(0, 1000) });
  for (const key of ['duration', 'year', 'track', 'discNumber'] as const)
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) Object.assign(result, { [key]: value[key] });
  return result;
}
export function deletedPlaylistSnapshot(playlist: Playlist, songs: readonly Song[]): DeletedPlaylist {
  if (!identity(playlist.id) || !playlist.name.trim() || songs.length > 10000 || (playlist.songCount ?? songs.length) !== songs.length) throw new Error('A complete playlist is required before deletion');
  return { version: 1, originalId: playlist.id, name: playlist.name.slice(0, 500), comment: playlist.comment?.slice(0, 5000), public: playlist.public, songs: songs.map(safeSong) };
}
export function validateRecentlyDeletedPayload(kind: RecentlyDeletedKind, raw: unknown): unknown {
  if (kind === 'smart-playlist') { const value = normalizeSmartRule(raw); if (!value) throw new Error('Invalid smart playlist'); return value; }
  if (kind === 'scraper-profile') return safeScraperProfile(validateScraperProfile(raw));
  if (kind !== 'playlist') throw new Error('Invalid deleted item');
  const value = raw as DeletedPlaylist;
  if (!value || value.version !== 1 || !identity(value.originalId) || typeof value.name !== 'string' || !value.name.trim() || !Array.isArray(value.songs) || value.songs.length > 10000) throw new Error('Invalid deleted playlist');
  return deletedPlaylistSnapshot({ id: value.originalId, name: value.name, comment: value.comment, public: value.public, songCount: value.songs.length }, value.songs);
}
export function prepareRecentlyDeleted(input: { kind: RecentlyDeletedKind; title: string; payload: unknown }, owner = recentlyDeletedOwner()): Promise<RecentlyDeletedTicket> {
  const payload = JSON.stringify(validateRecentlyDeletedPayload(input.kind, input.payload));
  if (!input.title.trim() || payload.length > (input.kind === 'scraper-profile' ? 131072 : 4_000_000)) throw new Error('Deleted item is too large');
  const id = `trash_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  return serial(owner, async () => {
    const db = await database(owner.profile); owner.check();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const usage = await tx.getFirstAsync<{ count: number; bytes: number }>('SELECT COUNT(*) count, COALESCE(SUM(length(payload)),0) bytes FROM recently_deleted WHERE source=?', owner.source); owner.check();
      if ((usage?.count ?? 0) >= 200 || (usage?.bytes ?? 0) + payload.length > 20_000_000) throw new Error('Recently deleted is full. Permanently delete older items first.');
      await tx.runAsync('INSERT INTO recently_deleted(source,id,kind,title,deleted_at,payload) VALUES(?,?,?,?,?,?)', owner.source, id, input.kind, input.title.trim().slice(0, 500), Date.now(), payload); owner.check();
    }); return { id, owner };
  });
}
export function commitRecentlyDeleted(ticket: RecentlyDeletedTicket): Promise<void> {
  return serial(ticket.owner, async () => { const db = await database(ticket.owner.profile); ticket.owner.check();
    await db.withExclusiveTransactionAsync(async (tx) => { await tx.runAsync('UPDATE recently_deleted SET committed=1 WHERE source=? AND id=?', ticket.owner.source, ticket.id); ticket.owner.check(); }); notifyRecentlyDeleted(); });
}
export function cancelRecentlyDeleted(ticket: RecentlyDeletedTicket): Promise<void> { return permanentlyDeleteRecentlyDeleted(ticket.id, ticket.owner); }
export async function listRecentlyDeleted(owner = recentlyDeletedOwner()): Promise<RecentlyDeletedItem[]> {
  await queues.get(owner.profile)?.catch(() => {}); owner.check(); const db = await database(owner.profile); owner.check();
  const rows = await db.getAllAsync<{ id: string; kind: RecentlyDeletedKind; title: string; deleted_at: number; payload: string; restored_id: string | null; committed: number }>('SELECT id,kind,title,deleted_at,payload,restored_id,committed FROM recently_deleted WHERE source=? ORDER BY deleted_at DESC LIMIT 200', owner.source); owner.check();
  return rows.map((row) => ({ id: row.id, kind: row.kind, title: row.title, deletedAt: row.deleted_at, restoredId: row.restored_id ?? undefined, confirmed: row.committed === 1, payload: validateRecentlyDeletedPayload(row.kind, JSON.parse(row.payload)) }));
}
export function permanentlyDeleteRecentlyDeleted(id: string | undefined, owner = recentlyDeletedOwner()): Promise<void> {
  return serial(owner, async () => { const db = await database(owner.profile); owner.check(); await db.withExclusiveTransactionAsync(async (tx) => {
    if (id === undefined) await tx.runAsync('DELETE FROM recently_deleted WHERE source=?', owner.source);
    else await tx.runAsync('DELETE FROM recently_deleted WHERE source=? AND id=?', owner.source, id); owner.check();
  }); notifyRecentlyDeleted(); });
}
/** Restore operations for the same item are serialized, including remote work. */
const restoring = new Map<string, Promise<string>>();
export function restoreRecentlyDeleted(id: string, owner = recentlyDeletedOwner()): Promise<string> {
  const key = JSON.stringify([owner.profile, owner.source, id]), pending = restoring.get(key); if (pending) return pending;
  const task = (async () => {
    const item = (await listRecentlyDeleted(owner)).find((entry) => entry.id === id); if (!item) throw new Error('Deleted item not found'); owner.check();
    const checkpoint = async (restoredId: string) => { await serial(owner, async () => { const db = await database(owner.profile); owner.check(); await db.withExclusiveTransactionAsync(async (tx) => { await tx.runAsync('UPDATE recently_deleted SET restored_id=? WHERE source=? AND id=?', restoredId, owner.source, id); owner.check(); }); }); item.restoredId = restoredId; };
    let restoredId = item.restoredId;
    if (item.kind === 'smart-playlist') {
      const { saveSmartRule } = await import('./listeningDb'); owner.check();
      const value = normalizeSmartRule(item.payload)!; restoredId ??= `smart_restored_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await checkpoint(restoredId); await saveSmartRule(owner.profile, { ...value, id: restoredId }, owner.current); owner.check();
    } else if (item.kind === 'scraper-profile') {
      const { restoreScraperProfile } = await import('./metadata/repository'); owner.check();
      if (!restoredId) { restoredId = `restored_${item.id.slice(0, 65)}`; await checkpoint(restoredId); }
      await restoreScraperProfile(item.payload, owner.current, restoredId); owner.check();
    } else {
      const api = await import('@/api/data'); owner.check(); const value = item.payload as DeletedPlaylist;
      // The title explicitly distinguishes a restored list from the deleted server list.
      const title = `${value.name} (Restored)`;
      if (!restoredId) restoredId = await api.createPlaylistFromSongs(title, value.songs, { allowEmpty: true, onCreated: checkpoint });
      else {
        const current = await api.getPlaylist(restoredId); owner.check();
        if (current.playlist.name !== title || current.playlist.readonly) throw new Error('The restored playlist changed. Reopen it before retrying.');
        if (current.songs.length && (current.songs.length !== value.songs.length || current.songs.some((song, at) => song.id !== value.songs[at].id))) throw new Error('The restored playlist changed. Reopen it before retrying.');
        if (!current.songs.length && value.songs.length) { await api.reorderPlaylist(restoredId, value.songs.map((song) => song.id), []); owner.check(); }
      }
      owner.check(); if (value.comment !== undefined || value.public !== undefined) await api.updatePlaylist(restoredId, { comment: value.comment, public: value.public }); owner.check();
    }
    owner.check(); await permanentlyDeleteRecentlyDeleted(id, owner); return restoredId!;
  })(); restoring.set(key, task); void task.finally(() => { if (restoring.get(key) === task) restoring.delete(key); }).catch(() => {}); return task;
}
export async function clearRecentlyDeletedProfile(profile: string): Promise<void> {
  generations.set(profile, (generations.get(profile) ?? 0) + 1); await queues.get(profile)?.catch(() => {});
  const db = await database(profile); await db.runAsync('DELETE FROM recently_deleted'); notifyRecentlyDeleted();
}
