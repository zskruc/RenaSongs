import type { Song } from '@/api/backend';

/** Keep URLs and server requests bounded: the sleeping phone cannot refill this window. */
export const JUKEBOX_UPCOMING_LIMIT = 20;
export interface JukeboxEntry { song: Song; queueIndex: number }
export const playableOnJukebox = (song: Song) => !!song.id && !song.url && !song.localUri;

/**
 * The server locates its current item by ID when entries are removed. Stop at
 * duplicate IDs rather than making it jump to an earlier copy. Absolute app
 * indices preserve which occurrence is playing in the larger, unbounded queue.
 */
export function jukeboxUpcoming(current: Song, upcoming: readonly Song[], currentIndex: number, alreadyPlayed: readonly string[] = []): JukeboxEntry[] {
  const entries: JukeboxEntry[] = [], seen = new Set([current.id, ...alreadyPlayed]);
  for (const song of upcoming) {
    if (entries.length >= JUKEBOX_UPCOMING_LIMIT || !playableOnJukebox(song) || seen.has(song.id)) break;
    entries.push({ song, queueIndex: currentIndex + entries.length + 1 });
    seen.add(song.id);
  }
  return entries;
}

/** Current entry keeps playing; only the changed suffix is removed/appended. */
export function jukeboxTailPrefix(have: readonly JukeboxEntry[], want: readonly JukeboxEntry[]): number {
  let same = 0;
  while (same < have.length && same < want.length && have[same].song.id === want[same].song.id) same++;
  return same;
}
