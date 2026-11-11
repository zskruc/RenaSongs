import type { Song } from '@/api/subsonic';
import { songContentKind, isLocalPodcastSong, type ListeningContentKind } from './contentKind';
import { hashKey } from './localLibrary';
import { songAddedAt } from './smartRules';
export interface LocalPodcastShow { id: string; title: string; author?: string; songs: Song[]; }
export interface LocalPodcastProgress { positionSec: number; durationSec: number; played: boolean; updatedAt: number; }
export type LocalPodcastProgressMap = Record<string, LocalPodcastProgress>;
export function validateLocalPodcastProgress(raw: unknown): LocalPodcastProgressMap {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 6000) throw new Error('Invalid local podcast progress');
  const result: LocalPodcastProgressMap = Object.create(null);
  for (const [id, entry] of Object.entries(raw)) {
    const value = entry as LocalPodcastProgress;
    if (!id || id.length > 2048 || !value || !Number.isFinite(value.positionSec) || value.positionSec < 0 || !Number.isFinite(value.durationSec) || value.durationSec < 0
      || !Number.isFinite(value.updatedAt) || value.updatedAt < 0 || typeof value.played !== 'boolean') throw new Error('Invalid local podcast progress');
    result[id] = { positionSec: value.durationSec > 0 ? Math.min(value.positionSec, value.durationSec) : value.positionSec, durationSec: value.durationSec, played: value.played, updatedAt: value.updatedAt };
  } return result;
}
export async function groupLocalPodcasts(songs: readonly Song[], kind: (song: Song) => ListeningContentKind = songContentKind, current = () => true, display: (song: Song) => Song = (song) => song): Promise<LocalPodcastShow[]> {
  const groups = new Map<string, LocalPodcastShow>(), seen = new Set<string>();
  for (let at = 0; at < songs.length; at += 300) {
    if (!current()) throw new Error('Local podcast library changed');
    for (const original of songs.slice(at, at + 300)) {
      if (seen.has(original.id) || !isLocalPodcastSong(original, kind(original))) continue; seen.add(original.id);
      const song = display(original);
      const title = song.album?.trim() || song.artist?.trim() || '';
      const id = song.albumId ? `album:${song.albumId}` : `name:${hashKey(JSON.stringify([title, song.albumArtist ?? song.artist ?? '']))}`;
      const group = groups.get(id) ?? { id, title, author: song.albumArtist ?? song.artist, songs: [] };
      group.songs.push(song); groups.set(id, group);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (!current()) throw new Error('Local podcast library changed');
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}
export type LocalPodcastOrder = 'track' | 'newest' | 'oldest' | 'title';
export function orderLocalPodcastSongs(songs: readonly Song[], order: LocalPodcastOrder): Song[] {
  return songs.map((song, index) => ({ song, index })).sort((a, b) => {
    const delta = order === 'track' ? (a.song.discNumber ?? 1) - (b.song.discNumber ?? 1) || (a.song.track ?? Number.MAX_SAFE_INTEGER) - (b.song.track ?? Number.MAX_SAFE_INTEGER)
      : order === 'title' ? a.song.title.localeCompare(b.song.title)
        : songAddedAt(a.song) && songAddedAt(b.song) ? (songAddedAt(a.song) - songAddedAt(b.song)) * (order === 'newest' ? -1 : 1)
          : songAddedAt(a.song) ? -1 : songAddedAt(b.song) ? 1 : 0;
    return delta || a.index - b.index;
  }).map((row) => row.song);
}
