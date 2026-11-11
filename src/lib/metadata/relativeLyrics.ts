import type { SongLyrics, LyricLine } from '@/api/subsonic';
/** Pure relative-word format adapter. Millisecond times are kept exactly. */
export function parseRelativeMetadataLyrics(text: string): SongLyrics | null {
  if (text.length > 2_000_000) return null;
  const lines: LyricLine[] = []; let words = 0;
  for (const raw of text.split(/\r?\n/)) {
    const head = raw.match(/^\s*\[(\d+),(\d+)\]/); if (!head) continue;
    const start = Number(head[1]), duration = Number(head[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(duration) || start < 0 || duration < 0 || start + duration > 1_000_000_000) return null;
    const timed = [...raw.slice(head[0].length).matchAll(/<(\d+),(\d+),\d+>([^<]*)/g)].map((match) => ({ start: start + Number(match[1]), end: start + Number(match[1]) + Number(match[2]), value: match[3] }));
    words += timed.length;
    if (words > 50000 || timed.length > 2000 || timed.some((word, index) => !Number.isSafeInteger(word.end) || word.end > 1_000_000_000 || word.value.length > 16000 || index > 0 && word.start < timed[index - 1].start)) return null;
    const value = timed.map((word) => word.value).join(''); if (value.trim()) lines.push({ start, value, words: timed });
    if (lines.length > 5000) return null;
  }
  return lines.length ? { synced: true, lines } : null;
}
