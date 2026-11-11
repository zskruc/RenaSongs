/** App-only scraping documents. Provider IDs never replace library/media IDs. */
import type { Song, SongLyrics } from '@/api/subsonic';
import type { CustomizationScope } from '@/lib/localCustomizations';

export const SCRAPE_FIELDS = ['title', 'artist', 'albumArtist', 'album', 'year', 'genres', 'track', 'discNumber', 'cover', 'lyrics', 'mediaKind'] as const;
export type ScrapeField = typeof SCRAPE_FIELDS[number];
export type MetadataKind = 'song' | 'album' | 'artist';
export interface ScrapedFields {
  title?: string; artist?: string; albumArtist?: string; album?: string;
  year?: number; genres?: { name: string }[]; track?: number; discNumber?: number;
  mediaKind?: 'music' | 'podcast' | 'audiobook';
}
export interface ScrapeCandidate {
  id: string; provider: string; externalId: string; fields: ScrapedFields;
  duration?: number; coverUrl?: string; lyrics?: SongLyrics;
  lyricsSource?: { provider: string; externalId: string };
  lyricsChecked?: boolean;
  edition?: string; score?: number; confident?: boolean; reasons?: string[];
}
export interface ScrapeRelease { id: string; provider: string; externalId: string; title: string; artist?: string; year?: number; count?: number; edition?: string; coverUrl?: string; }
export interface ScrapeRequest { title: string; artist?: string; album?: string; duration?: number; limit?: number; }
export interface ScrapeOperation { scope: CustomizationScope; current: () => boolean; signal?: AbortSignal; }
export interface MetadataTarget { scope: CustomizationScope; kind: MetadataKind; id?: string; title?: string; songs: Song[]; current?: () => boolean; }
export interface MetadataInsight { text: string; url: string; source: 'Wikipedia'; language: string; fetchedAt: number; }
export interface MetadataArtwork { uri: string; bytes: number; mime: string; updatedAt: number; }
export interface MetadataSettings { version: 1; onlyMissing: boolean; enabled: string[]; order: string[]; }
export const BUILTIN_PROVIDERS = ['itunes', 'musicbrainz', 'lrclib', 'amll'] as const;
export const DEFAULT_METADATA_SETTINGS: MetadataSettings = { version: 1, onlyMissing: true, enabled: ['itunes', 'musicbrainz', 'lrclib', 'amll'], order: [...BUILTIN_PROVIDERS] };
export function validMetadataSettings(raw: unknown): raw is MetadataSettings {
  const value = raw as MetadataSettings;
  const ids = (items: unknown) => Array.isArray(items) && items.length <= 100 && new Set(items).size === items.length
    && items.every((item) => typeof item === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(item));
  return !!value && value.version === 1 && typeof value.onlyMissing === 'boolean' && ids(value.enabled) && ids(value.order);
}
export function validMetadataInsight(raw: unknown): raw is MetadataInsight {
  const value = raw as MetadataInsight;
  return !!value && value.source === 'Wikipedia' && typeof value.text === 'string' && value.text.length > 0 && value.text.length <= 32000
    && typeof value.url === 'string' && /^https:\/\/[a-z-]+\.wikipedia\.org\/wiki\//.test(value.url) && !!metadataUrl(value.url)
    && typeof value.language === 'string' && /^[a-z-]{1,20}$/.test(value.language) && Number.isFinite(value.fetchedAt);
}
export interface ProviderIssue { provider: string; reason: 'network' | 'rate-limit' | 'invalid-response' | 'unsupported' | 'cancelled'; }
export interface ScrapeSearch { candidates: ScrapeCandidate[]; issues: ProviderIssue[]; }
export function metadataCheck(operation: Pick<ScrapeOperation, 'current' | 'signal'>): void {
  if (!operation.current() || operation.signal?.aborted) throw new MetadataCancelled();
}
export class MetadataCancelled extends Error { constructor() { super('Metadata operation cancelled'); this.name = 'MetadataCancelled'; } }
export function isMetadataCancelled(error: unknown): boolean { return error instanceof MetadataCancelled || error instanceof Error && error.name === 'AbortError'; }
export const metadataText = (value: unknown, max = 1024): string | undefined => typeof value === 'string' && value.trim()
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : undefined;
export function metadataUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192) return;
  try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return; return url.href; } catch { return; }
}
export function safeMetadataSong(song: Song): Song {
  // No auth URL, file location, embedded image or large raw tags in a task file.
  return { id: song.id, title: song.title, artist: song.artist, artistId: song.artistId, album: song.album,
    albumId: song.albumId, albumArtist: song.albumArtist, mediaKind: song.mediaKind, duration: song.duration, year: song.year, genre: song.genre, genres: song.genres?.slice(0, 30), track: song.track, discNumber: song.discNumber };
}
