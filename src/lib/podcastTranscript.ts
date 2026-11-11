/** Publisher-supplied documents, parsed without inventing timings for plain text. */
import type { SongLyrics, PodcastTranscript } from '@/api/subsonic';
const MAX_LINES = 5000;
function text(value: string): string { return value.replace(/<[^>]{0,1000}>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim(); }
function stamp(value: string): number | undefined {
  const match = value.trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) return undefined;
  return ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4].padEnd(3, '0'));
}
export function parsePodcastTranscript(body: string, type = ''): SongLyrics {
  if (body.length > 1_500_000) throw new Error('Publisher transcript is too large');
  const source = body.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/json/i.test(type) || /^[\s]*[\[{]/.test(source)) {
    const value = JSON.parse(source) as unknown;
    const entries = Array.isArray(value) ? value : (value as { segments?: unknown[]; results?: unknown[] })?.segments ?? (value as { results?: unknown[] })?.results;
    if (!Array.isArray(entries)) throw new Error('Unsupported publisher transcript');
    const lines = entries.slice(0, MAX_LINES + 1).map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>, start = Number(row.startTime ?? row.start ?? row.offset);
      const content = row.body ?? row.text ?? row.value;
      if (typeof content !== 'string') return null;
      return { value: text(content), ...(Number.isFinite(start) && start >= 0 ? { start: Math.round(start * 1000) } : {}) };
    }).filter((line): line is NonNullable<typeof line> => !!line?.value);
    if (lines.length > MAX_LINES) throw new Error('Publisher transcript has too many lines');
    const synced = lines.length > 0 && lines.every((line) => line.start !== undefined);
    if (synced) lines.sort((a, b) => a.start! - b.start!);
    return { synced, lines: synced ? lines : lines.map((line) => ({ value: line.value })) };
  }
  const cues = source.split(/\n\s*\n/), timed: SongLyrics['lines'] = [];
  for (const cue of cues) {
    const rows = cue.split('\n'), at = rows.findIndex((line) => line.includes('-->'));
    if (at < 0 || /^(NOTE|STYLE|REGION)\b/.test(rows[0])) continue;
    const start = stamp(rows[at].split('-->')[0]);
    if (start === undefined) continue;
    const value = text(rows.slice(at + 1).join(' '));
    if (value) timed.push({ start, value });
    if (timed.length > MAX_LINES) throw new Error('Publisher transcript has too many lines');
  }
  if (timed.length) return { synced: true, lines: timed.sort((a, b) => a.start! - b.start!) };
  if (/vtt|subrip|srt/i.test(type) || /^(WEBVTT|\d+\n\d+:)/.test(source)) throw new Error('Publisher transcript has invalid timestamps');
  const lines = text(source.replace(/<\/(?:p|div|li|h\d)>/gi, '\n')).split('\n').map((value) => ({ value: value.trim() })).filter((line) => line.value);
  if (lines.length > MAX_LINES) throw new Error('Publisher transcript has too many lines');
  return { synced: false, lines };
}
export function preferredPodcastTranscripts(values: readonly PodcastTranscript[], language?: string): PodcastTranscript[] {
  const rank = (item: PodcastTranscript) => (/vtt|subrip|srt|json/i.test(item.type ?? item.url) ? 10 : 0) + (language && item.language?.startsWith(language.split('-')[0]) ? 2 : 0);
  return values.filter((item) => { try { return ['https:', 'http:'].includes(new URL(item.url).protocol); } catch { return false; } }).slice(0, 12).sort((a, b) => rank(b) - rank(a));
}
