import type { Song } from '@/api/subsonic';

/** Restore source order using the occurrences still present, never stale
 * original objects. New hand-queued occurrences remain at the end. */
export function unshuffleQueue(queue: Song[], original: Song[], currentIndex: number): { queue: Song[]; index: number } {
  const byObject = new Map<Song, number[]>(), byId = new Map<string, number[]>();
  queue.forEach((song, index) => {
    const exact = byObject.get(song) ?? []; exact.push(index); byObject.set(song, exact);
    if (!song.queued) { const ids = byId.get(song.id) ?? []; ids.push(index); byId.set(song.id, ids); }
  });
  const used = new Set<number>(), cursors = new Map<unknown, number>();
  const take = (key: unknown, candidates: number[] | undefined) => {
    if (!candidates) return -1;
    let cursor = cursors.get(key) ?? 0;
    while (cursor < candidates.length && used.has(candidates[cursor])) cursor++;
    cursors.set(key, cursor + 1);
    const found = candidates[cursor] ?? -1;
    if (found >= 0) used.add(found);
    return found;
  };
  // Reserve exact matches first, so one removed duplicate cannot consume the
  // still-playing occurrence that belonged later in the original list.
  const matches = original.map((song) => take(song, byObject.get(song)));
  original.forEach((song, index) => { if (matches[index] < 0) matches[index] = take(song.id, byId.get(song.id)); });
  const order = matches.filter((index) => index >= 0);
  queue.forEach((_song, index) => { if (!used.has(index)) order.push(index); });
  return { queue: order.map((index) => queue[index]), index: Math.max(0, order.indexOf(currentIndex)) };
}
