/** Calendar and display models derived only from the recorded listening ledger. */
import type { ListeningReport } from './listeningDb';
import type { ListeningContentKind } from './contentKind';

export type ListeningRankTab = 'songs' | 'artists' | 'albums';
export interface ListeningRankItem {
  key: string;
  kind: ListeningRankTab;
  id?: string;
  title: string;
  subtitle?: string;
  song: ListeningReport['top'][number]['song'];
  seconds: number;
  plays: number;
}
export function listeningRankItems(report: ListeningReport | undefined, tab: ListeningRankTab, kind: ListeningContentKind): ListeningRankItem[] {
  if (!report) return [];
  if (tab === 'artists' && kind === 'music') return report.artistRanks.slice(0, 30).map((row) => ({ ...row, key: `artist:${row.key}`, kind: 'artists', title: row.name }));
  if (tab === 'albums' && kind === 'music') return report.albumRanks.slice(0, 30).map((row) => ({ ...row, key: `album:${row.key}`, kind: 'albums', title: row.name, subtitle: row.artist }));
  return report.top.slice(0, 30).map((row) => ({ ...row, key: `song:${row.song.id}`, kind: 'songs', id: row.song.id, title: row.song.title, subtitle: row.song.artist }));
}
const durationFormats = new Map<string, Intl.NumberFormat>();
export function listeningDurationParts(seconds: number, language: string): { value: string; unit: 'Hours' | 'Minutes' | 'Seconds' } {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const unit = safe >= 3600 ? 'Hours' : safe >= 60 ? 'Minutes' : 'Seconds';
  const value = unit === 'Hours' ? safe / 3600 : unit === 'Minutes' ? Math.floor(safe / 60) : Math.floor(safe);
  const digits = unit === 'Hours' ? 1 : 0, key = `${language}|${digits}`;
  let formatter = durationFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(language, { maximumFractionDigits: digits }); durationFormats.set(key, formatter);
    if (durationFormats.size > 32) durationFormats.delete(durationFormats.keys().next().value!);
  }
  return { value: formatter.format(value), unit };
}
/** Legacy imports may contain a syntactically shaped but impossible calendar date. */
export function validListeningDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [year, month, number] = day.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, number));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === number;
}
export function calendarMonthShift(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(year, number - 1 + delta, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
export function listeningCalendarCells(month: string, days: ListeningReport['days'], from: string, until: string) {
  const [year, number] = month.split('-').map(Number);
  if (!validListeningDay(`${month}-01`)) return [];
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const totals = new Map(days.map((row) => [row.day, row]));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, number - 1, 1 - offset + index));
    const key = date.toISOString().slice(0, 10);
    const row = totals.get(key);
    return { key, date: date.getUTCDate(), insideMonth: key.slice(0, 7) === month,
      enabled: key.slice(0, 7) === month && key >= from && key < until,
      seconds: row?.seconds ?? 0, plays: row?.plays ?? 0 };
  });
}
export function listeningDateLabel(key: string, language: string): string {
  if (/^\d{4}(?:-\d{4})?$/.test(key)) return key.replace('-', '–');
  const monthly = key.length === 7;
  const date = new Date(`${key}${monthly ? '-01' : ''}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return key;
  return new Intl.DateTimeFormat(language, monthly ? { year: 'numeric', month: 'short' } : { month: 'short', day: 'numeric' }).format(date);
}

/** Actual blended cell color with black/white text chosen for readable contrast. */
export function listeningHeatmapTone(accent: string, surface: string, fraction: number) {
  const rgb = (hex: string, fallback: number[]) => /^#[0-9a-f]{6}$/i.test(hex)
    ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) : fallback;
  const base = rgb(surface, [30, 32, 38]), ink = rgb(accent, [29, 185, 84]);
  const alpha = 0.16 + 0.74 * Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const mixed = base.map((value, i) => Math.round(value + (ink[i] - value) * alpha));
  const linear = mixed.map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return { backgroundColor: `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`,
    color: (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF' };
}
