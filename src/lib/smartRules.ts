/** Local rules. Missing dates/years cannot satisfy a date/year restriction. */
import type { Song } from '@/api/subsonic';

export interface SmartRule {
  id: string;
  name: string;
  favorites: boolean;
  noPlays: boolean;
  minRating: number;
  fromYear?: number;
  untilYear?: number;
  genre: string;
  artist: string;
  addedDays: number;
  limit: number;
  sort: 'title' | 'newest' | 'most-played';
  /** Additional bounded groups; the legacy/basic filters always remain AND. */
  groupMatch?: 'all' | 'any';
  groups?: SmartRuleGroup[];
}
export type SmartCondition =
  | { field: 'favorite'; operator: 'is'; value: boolean }
  | { field: 'plays' | 'rating' | 'year'; operator: 'equals' | 'at-least' | 'at-most'; value: number }
  | { field: 'genre' | 'artist'; operator: 'contains' | 'not-contains'; value: string }
  | { field: 'added-days'; operator: 'within'; value: number };
export interface SmartRuleGroup { match: 'all' | 'any'; conditions: SmartCondition[]; }
export function normalizeSmartGroups(raw: unknown): SmartRuleGroup[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 8) return null;
  const groups: SmartRuleGroup[] = [];
  for (const group of raw) {
    if (!group || !['all', 'any'].includes(group.match) || !Array.isArray(group.conditions) || group.conditions.length > 12) return null;
    const conditions: SmartCondition[] = [];
    for (const condition of group.conditions) {
      if (!condition || typeof condition !== 'object') return null;
      const { field, operator, value } = condition;
      if (field === 'favorite' && operator === 'is' && typeof value === 'boolean') conditions.push({ field, operator, value });
      else if (['plays', 'rating', 'year'].includes(field) && ['equals', 'at-least', 'at-most'].includes(operator)
        && typeof value === 'number' && Number.isInteger(value) && value >= (field === 'year' ? 1000 : 0) && value <= (field === 'rating' ? 5 : field === 'year' ? 3000 : 1_000_000)) conditions.push({ field, operator, value } as SmartCondition);
      else if ((field === 'genre' || field === 'artist') && ['contains', 'not-contains'].includes(operator) && typeof value === 'string' && value.trim() && value.length <= 100) conditions.push({ field, operator, value: value.trim() } as SmartCondition);
      else if (field === 'added-days' && operator === 'within' && typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3650) conditions.push({ field, operator, value });
      else return null;
    }
    if (conditions.length) groups.push({ match: group.match, conditions });
  }
  return groups;
}
export function smartRuleNeedsFavorites(rule: SmartRule): boolean { return rule.favorites || !!rule.groups?.some((group) => group.conditions.some((condition) => condition.field === 'favorite')); }
export const EMPTY_RULE: Omit<SmartRule, 'id' | 'name'> = {
  favorites: false, noPlays: false, minRating: 0, genre: '', artist: '', addedDays: 0, limit: 100, sort: 'title',
};
export function normalizedMusicText(value: string | undefined): string {
  return (value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function normalizeSmartRule(value: unknown): SmartRule | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<SmartRule>;
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const year = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1000 && n <= 3000 ? n : undefined;
  const fromYear = year(raw.fromYear), untilYear = year(raw.untilYear);
  const groups = normalizeSmartGroups(raw.groups);
  if (!groups || raw.groupMatch !== undefined && raw.groupMatch !== 'all' && raw.groupMatch !== 'any') return null;
  if (raw.fromYear !== undefined && fromYear === undefined || raw.untilYear !== undefined && untilYear === undefined) return null;
  if (fromYear && untilYear && fromYear > untilYear) return null;
  return { id: raw.id.slice(0, 200), name: raw.name.trim().slice(0, 100), favorites: raw.favorites === true,
    noPlays: raw.noPlays === true, minRating: Math.max(0, Math.min(5, Math.floor(Number(raw.minRating) || 0))),
    fromYear, untilYear, genre: typeof raw.genre === 'string' ? raw.genre.trim().slice(0, 100) : '',
    artist: typeof raw.artist === 'string' ? raw.artist.trim().slice(0, 100) : '',
    addedDays: [7, 30, 90, 365].includes(raw.addedDays ?? 0) ? raw.addedDays! : 0,
    limit: [50, 100, 200, 500].includes(raw.limit ?? 0) ? raw.limit! : 100,
    sort: raw.sort === 'newest' || raw.sort === 'most-played' ? raw.sort : 'title',
    ...(groups.length ? { groups, groupMatch: raw.groupMatch === 'any' ? 'any' : 'all' } : {}) };
}
export function songAddedAt(song: Song): number {
  if (typeof song.addedAt === 'number' && Number.isFinite(song.addedAt)) return song.addedAt;
  const created = (song as Song & { created?: string }).created;
  const parsed = typeof created === 'string' ? Date.parse(created) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function evaluateSmartRule(songs: readonly Song[], rule: SmartRule, options: {
  now?: number; counts?: Record<string, number>; favoriteIds?: ReadonlySet<string>; current?: () => boolean;
} = {}): Promise<Song[]> {
  const now = options.now ?? Date.now(), genre = normalizedMusicText(rule.genre), artist = normalizedMusicText(rule.artist);
  const result: Song[] = [];
  // Compile normalized text once, not once per song or while scrolling.
  const groups = (rule.groups ?? []).map((group) => ({ ...group, conditions: group.conditions.map((condition) =>
    condition.field === 'genre' || condition.field === 'artist' ? { ...condition, value: normalizedMusicText(condition.value) } : condition) }));
  function matchesCondition(song: Song, condition: SmartCondition): boolean {
    if (condition.field === 'favorite') return (!!song.starred || !!options.favoriteIds?.has(song.id)) === condition.value;
    if (condition.field === 'genre' || condition.field === 'artist') {
      const raw = condition.field === 'artist' ? song.artist : [song.genre, ...(song.genres ?? []).map((item) => item.name)].filter(Boolean).join(' ');
      // Unknown metadata cannot prove a negative text rule either.
      const value = normalizedMusicText(raw); return !!value && (condition.operator === 'contains' ? value.includes(condition.value) : !value.includes(condition.value));
    }
    if (condition.field === 'added-days') { const added = songAddedAt(song); return added > 0 && added >= now - condition.value * 86_400_000 && added <= now; }
    if (typeof condition.value !== 'number') return false;
    const value = condition.field === 'plays' ? Math.max(song.playCount ?? 0, options.counts?.[song.id] ?? 0) : condition.field === 'rating' ? song.userRating ?? 0 : song.year;
    if (value == null || !Number.isFinite(value)) return false;
    return condition.operator === 'equals' ? value === condition.value : condition.operator === 'at-least' ? value >= condition.value : value <= condition.value;
  }
  const matchesGroups = (song: Song) => !groups.length || (rule.groupMatch === 'any' ? groups.some((group) => group.match === 'any'
    ? group.conditions.some((condition) => matchesCondition(song, condition)) : group.conditions.every((condition) => matchesCondition(song, condition)))
    : groups.every((group) => group.match === 'any' ? group.conditions.some((condition) => matchesCondition(song, condition)) : group.conditions.every((condition) => matchesCondition(song, condition))));
  const compare = (a: Song, b: Song) => rule.sort === 'newest' ? songAddedAt(b) - songAddedAt(a) || a.id.localeCompare(b.id)
    : rule.sort === 'most-played' ? Math.max(b.playCount ?? 0, options.counts?.[b.id] ?? 0) - Math.max(a.playCount ?? 0, options.counts?.[a.id] ?? 0) || a.id.localeCompare(b.id)
      : (a.title ?? '').localeCompare(b.title ?? '') || a.id.localeCompare(b.id);
  for (let start = 0; start < songs.length; start += 300) {
    if (options.current && !options.current()) throw new Error('Analysis cancelled');
    for (const song of songs.slice(start, start + 300)) {
      if (rule.favorites && !song.starred && !options.favoriteIds?.has(song.id)) continue;
      if (rule.noPlays && Math.max(song.playCount ?? 0, options.counts?.[song.id] ?? 0) > 0) continue;
      if ((song.userRating ?? 0) < rule.minRating) continue;
      if (rule.fromYear && (!song.year || song.year < rule.fromYear)) continue;
      if (rule.untilYear && (!song.year || song.year > rule.untilYear)) continue;
      if (genre && !normalizedMusicText([song.genre, ...(song.genres ?? []).map((item) => item.name)].filter(Boolean).join(' ')).includes(genre)) continue;
      if (artist && !normalizedMusicText(song.artist).includes(artist)) continue;
      if (rule.addedDays && !(songAddedAt(song) >= now - rule.addedDays * 86_400_000 && songAddedAt(song) <= now)) continue;
      if (!matchesGroups(song)) continue;
      // Bounded top-K insertion avoids a blocking full-library sort and retains
      // at most the requested result limit, even on a six-figure library.
      let low = 0, high = result.length;
      while (low < high) { const middle = (low + high) >>> 1; if (compare(song, result[middle]) < 0) high = middle; else low = middle + 1; }
      if (low < rule.limit) { result.splice(low, 0, song); if (result.length > rule.limit) result.pop(); }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (options.current && !options.current()) throw new Error('Analysis cancelled');
  return result;
}

export interface DuplicateGroup { id: string; title: string; artist: string; versions: boolean; songs: Song[] }
function baseTitle(song: Song): string {
  return normalizedMusicText(song.title
    .replace(/\([^)]*(?:live|remaster|acoustic|instrumental|demo|edit|mix|version|mono|stereo|现场|重制|伴奏)[^)]*\)|\[[^\]]*(?:live|remaster|acoustic|instrumental|demo|edit|mix|version|mono|stereo|现场|重制|伴奏)[^\]]*\]/gi, '')
    .replace(/\s[-–—]\s.*(?:live|remaster|acoustic|instrumental|demo|edit|mix|version|mono|stereo|现场|重制|伴奏).*$/i, ''));
}
async function responsiveSort<T>(input: T[], compare: (a: T, b: T) => number, current: () => boolean): Promise<T[]> {
  if (input.length <= 1000) return input.sort(compare);
  let sorted = input.slice(), buffer = new Array<T>(input.length);
  for (let start = 0; start < sorted.length; start += 1000) {
    sorted.splice(start, Math.min(1000, sorted.length - start), ...sorted.slice(start, start + 1000).sort(compare));
    if (!current()) throw new Error('Analysis cancelled');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  for (let width = 1000; width < sorted.length; width *= 2) {
    let work = 0;
    for (let start = 0; start < sorted.length; start += width * 2) {
      const middle = Math.min(start + width, sorted.length), end = Math.min(start + width * 2, sorted.length);
      let a = start, b = middle;
      for (let at = start; at < end; at++) {
        buffer[at] = a < middle && (b >= end || compare(sorted[a], sorted[b]) <= 0) ? sorted[a++] : sorted[b++];
        if (++work % 16_384 === 0) { if (!current()) throw new Error('Analysis cancelled'); await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
      }
    }
    [sorted, buffer] = [buffer, sorted];
  }
  return sorted;
}
/** Title/artist metadata suggestions, never an audio-fingerprint or deletion decision. */
export async function findDuplicateCandidates(songs: readonly Song[], current: () => boolean = () => true): Promise<DuplicateGroup[]> {
  const groups = new Map<string, Song[]>();
  const seen = new Set<string>();
  for (let start = 0; start < songs.length; start += 300) {
    if (!current()) throw new Error('Analysis cancelled');
    for (const song of songs.slice(start, start + 300)) {
      if (seen.has(song.id)) continue;
      seen.add(song.id);
      const title = baseTitle(song), artist = normalizedMusicText(song.artist);
      if (!title || !artist || artist === 'unknown artist') continue;
      const key = JSON.stringify([artist, title]);
      const list = groups.get(key);
      if (list) list.push(song); else groups.set(key, [song]);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const result: DuplicateGroup[] = [];
  let examined = 0;
  for (const [key, list] of groups) {
    if (++examined % 200 === 0) { if (!current()) throw new Error('Analysis cancelled'); await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
    if (list.length < 2) continue;
    const sorted = await responsiveSort(list, (a, b) => (b.bitDepth ?? 0) - (a.bitDepth ?? 0) || (b.samplingRate ?? 0) - (a.samplingRate ?? 0) || (b.bitRate ?? 0) - (a.bitRate ?? 0) || a.id.localeCompare(b.id), current);
    const known = list.map((song) => song.duration).filter((value): value is number => typeof value === 'number' && value > 0);
    let minimum = Infinity, maximum = -Infinity;
    for (const duration of known) { minimum = Math.min(minimum, duration); maximum = Math.max(maximum, duration); }
    const durationDiffers = known.length !== list.length || maximum - minimum > 2;
    const titles = new Set(list.map((song) => normalizedMusicText(song.title)));
    result.push({ id: key, title: list[0].title, artist: list[0].artist ?? '',
      versions: durationDiffers || titles.size > 1, songs: sorted });
  }
  if (!current()) throw new Error('Analysis cancelled');
  return responsiveSort(result, (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title), current);
}
