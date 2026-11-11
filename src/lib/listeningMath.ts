/** Conservative listening-time accounting: position seeks are never listening time. */
import type { Song } from '@/api/subsonic';

export function localDay(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export interface ListeningSample {
  profile: string;
  song?: Song;
  playing: boolean;
  buffering: boolean;
  position: number;
  speed: number;
  at: number;
}
export interface ListeningCredit {
  profile: string;
  day: string;
  song: Song;
  seconds: number;
  plays: number;
  at: number;
}

/** Per-track sessions qualify after 30 real seconds, or half of a short song. */
export function createListeningMeter(publish: (credit: ListeningCredit) => void) {
  let previous: ListeningSample | undefined;
  let session = '', heard = 0, counted = false;
  return {
    reset() { previous = undefined; session = ''; heard = 0; counted = false; },
    sample(sample: ListeningSample) {
      const old = previous;
      previous = sample;
      const song = sample.song;
      if (!song?.id || !sample.profile || (song.url && !song.vod)) { session = ''; return; }
      const identity = JSON.stringify([sample.profile, song.id]);
      // Position alone cannot distinguish repeat-one from a seek back to zero.
      // A continuous same-song visit is one qualified session; server/local
      // all-time play counters retain their own independent playback semantics.
      if (session !== identity) { session = identity; heard = 0; counted = false; return; }
      if (!old || old.profile !== sample.profile || old.song?.id !== song.id
        || !old.playing || old.buffering || sample.buffering) return;
      const elapsed = (sample.at - old.at) / 1000;
      const advanced = sample.position - old.position;
      const speed = Number.isFinite(old.speed) && old.speed > 0 ? old.speed : 1;
      // Frozen JS/backlogged beats, clocks changing, seeks and reversals fail closed.
      if (!(elapsed > 0 && elapsed <= 6 && advanced > 0)
        || Math.abs(advanced - elapsed * speed) > Math.max(0.8, elapsed * speed * 0.35)) return;
      const seconds = Math.min(elapsed, advanced / speed);
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      heard += seconds;
      const threshold = Math.min(30, Math.max(1, (song.duration ?? 60) / 2));
      const plays = !counted && heard >= threshold ? 1 : 0;
      if (plays) counted = true;
      publish({ profile: sample.profile, day: localDay(sample.at), song, seconds, plays, at: sample.at });
    },
  };
}

export type ListeningPeriod = 'week' | 'month' | 'year' | 'all';
export function listeningRange(period: ListeningPeriod, year: number, at = Date.now()) {
  const now = new Date(at);
  if (period === 'year') return { from: `${year}-01-01`, until: `${year + 1}-01-01` };
  if (period === 'all') return { from: '1970-01-01', until: localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()) };
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (period === 'week' ? 6 : 29));
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { from: localDay(start.getTime()), until: localDay(end.getTime()) };
}

export interface ListeningDay { day: string; seconds: number; plays?: number }
export interface ListeningBar { key: string; label: string; seconds: number; plays: number }

export function listeningBars(days: ListeningDay[], period: ListeningPeriod, year: number, at = Date.now()): ListeningBar[] {
  const totals = new Map<string, { seconds: number; plays: number }>();
  for (const row of days) {
    if (dayNumber(row.day) === undefined) continue;
    const key = period === 'year' ? row.day.slice(0, 7) : row.day;
    const old = totals.get(key) ?? { seconds: 0, plays: 0 };
    totals.set(key, { seconds: old.seconds + positive(row.seconds), plays: old.plays + positive(row.plays ?? 0) });
  }
  if (period === 'all') {
    const currentYear = new Date(at).getFullYear(), range = listeningRange(period, year, at);
    const recorded = [...totals].filter(([day]) => day >= range.from && day < range.until);
    const firstYear = Math.min(currentYear, ...recorded.map(([day]) => Number(day.slice(0, 4))));
    const step = Math.max(1, Math.ceil((currentYear - firstYear + 1) / 20));
    return Array.from({ length: Math.ceil((currentYear - firstYear + 1) / step) }, (_, index) => {
      const first = firstYear + index * step, last = Math.min(currentYear, first + step - 1);
      const key = first === last ? String(first) : `${first}-${last}`;
      const value = recorded.reduce((total, [day, row]) => Number(day.slice(0, 4)) >= first && Number(day.slice(0, 4)) <= last
        ? { seconds: total.seconds + row.seconds, plays: total.plays + row.plays } : total, { seconds: 0, plays: 0 });
      return { key, label: first === last ? key : `${first}–${last}`, ...value };
    });
  }
  if (period === 'year') return Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { key, label: String(i + 1), ...(totals.get(key) ?? { seconds: 0, plays: 0 }) };
  });
  const range = listeningRange(period, year, at);
  const date = new Date(`${range.from}T12:00:00`);
  return Array.from({ length: period === 'week' ? 7 : 30 }, () => {
    const key = localDay(date.getTime());
    date.setDate(date.getDate() + 1);
    return { key, label: key.slice(5), ...(totals.get(key) ?? { seconds: 0, plays: 0 }) };
  });
}

function positive(value: number): number { return Number.isFinite(value) && value > 0 ? value : 0; }
const DAY_MS = 86_400_000;
/** Calendar arithmetic uses day numbers rather than 24-hour local durations:
 * a daylight-saving change must not add or remove a report's calendar day. */
function dayNumber(day: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const [year, month, date] = day.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, date));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== date) return;
  return value.getTime() / DAY_MS;
}

export interface ListeningInsights {
  activeDays: number;
  totalDays: number;
  /** Average over active recorded days, not missing, future or pre-install days. */
  dailyAverageSeconds: number;
  busiestDay?: { day: string; seconds: number; plays: number };
  longestStreak: number;
}

/** Insights use only the selected report's real daily samples. Missing days
 * remain zero; neither earlier history nor listening hours are reconstructed. */
export function listeningInsights(days: ListeningDay[], from: string, until: string): ListeningInsights {
  const start = dayNumber(from), end = dayNumber(until);
  if (start === undefined || end === undefined || end <= start) return { activeDays: 0, totalDays: 0, dailyAverageSeconds: 0, longestStreak: 0 };
  const totals = new Map<string, { day: string; seconds: number; plays: number; ordinal: number }>();
  for (const row of days) {
    const ordinal = dayNumber(row.day);
    if (ordinal === undefined || ordinal < start || ordinal >= end) continue;
    const old = totals.get(row.day) ?? { day: row.day, seconds: 0, plays: 0, ordinal };
    old.seconds += positive(row.seconds); old.plays += positive(row.plays ?? 0); totals.set(row.day, old);
  }
  const active = [...totals.values()].filter((row) => row.seconds > 0 || row.plays > 0).sort((a, b) => a.ordinal - b.ordinal);
  let longestStreak = 0, streak = 0, previous: number | undefined;
  let busiest: typeof active[number] | undefined;
  for (const row of active) {
    streak = previous !== undefined && row.ordinal === previous + 1 ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak); previous = row.ordinal;
    if (!busiest || row.seconds > busiest.seconds || (row.seconds === busiest.seconds && row.plays > busiest.plays)) busiest = row;
  }
  return { activeDays: active.length, totalDays: end - start,
    dailyAverageSeconds: active.length ? active.reduce((total, row) => total + row.seconds, 0) / active.length : 0,
    busiestDay: busiest ? { day: busiest.day, seconds: busiest.seconds, plays: busiest.plays } : undefined, longestStreak };
}
