import { runMetadataScript, decodeScraperLyrics } from '@/lib/metadataScript';
import { parseLrc } from '@/lib/lrc';
import { parseTtml } from '@/lib/ttml';
import { validLyricDocument } from '@/lib/lyricDocuments';
import { scraperCredentials } from './repository';
import { expandMetadataTemplate, jsonMetadataPath, type MetadataEndpoint, type ScraperProfile } from './config';
import { metadataRequest } from './request';
import { metadataCheck, metadataText, metadataUrl, type ScrapeCandidate, type ScrapeOperation, type ScrapeRequest } from './models';
import { isMetadataCancelled } from './models';
import { parseRelativeMetadataLyrics } from './relativeLyrics';
import type { SongLyrics } from '@/api/subsonic';

type Json = Record<string, unknown>;
async function endpoint(profile: ScraperProfile, key: 'search' | 'detail' | 'cover' | 'lyrics', variables: Record<string, string>, operation: ScrapeOperation): Promise<unknown> {
  const config = profile[key]; if (!config) return null;
  const credentials = await scraperCredentials(profile.id, operation, profile); metadataCheck(operation);
  const replacements = { ...credentials.secrets, ...variables };
  const location = new URL(expandMetadataTemplate(config.url, replacements));
  for (const [name, value] of Object.entries(config.params ?? {})) location.searchParams.set(name, expandMetadataTemplate(value, replacements, false));
  const headers = { ...config.headers, ...credentials.headers?.[key] };
  const body = config.body === undefined ? undefined : expandMetadataTemplate(typeof config.body === 'string' ? config.body : JSON.stringify(config.body), replacements, false);
  if (body && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  const text = await metadataRequest(`custom:${profile.id}`, location.href, operation, { method: config.method, headers, body, interval: profile.rateLimitMs });
  metadataCheck(operation);
  if (config.script) {
    const parsed = await runMetadataScript(config.script, text, { externalId: variables.id, secrets: credentials.secrets }); metadataCheck(operation); return parsed;
  }
  if (config.format && config.format !== 'json') return text;
  return JSON.parse(text);
}
const defaultPaths: NonNullable<MetadataEndpoint['fields']> = { id: 'id', title: 'title', artist: 'artist', albumArtist: 'albumArtist', album: 'album', year: 'year',
  track: 'trackNumber', discNumber: 'discNumber', genres: 'genres', duration: 'durationMs', cover: 'coverUrl', lyrics: 'lrcContent' };
export function customMetadataCandidate(profile: ScraperProfile, value: unknown, config: MetadataEndpoint, fallbackId?: string): ScrapeCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const paths = { ...defaultPaths, ...config.fields }, field = (name: keyof typeof paths) => jsonMetadataPath(value, paths[name]!);
  const rawId = field('id') ?? fallbackId;
  const id = typeof rawId === 'string' || typeof rawId === 'number' && Number.isFinite(rawId) ? metadataText(String(rawId), 200) : undefined, title = metadataText(field('title'));
  if (!id || !title) return null;
  const integer = (name: keyof typeof paths) => { const n = Number(field(name)); return Number.isInteger(n) && n > 0 && n <= 99999 ? n : undefined; };
  const duration = Number(field('duration'));
  const rawGenres = field('genres'), genres = (Array.isArray(rawGenres) ? rawGenres : typeof rawGenres === 'string' ? rawGenres.split(/[;,]/) : [])
    .slice(0, 30).flatMap((entry) => metadataText(typeof entry === 'string' ? entry : entry?.name, 100) ? [{ name: metadataText(typeof entry === 'string' ? entry : entry?.name, 100)! }] : []);
  const lyricText = metadataText(field('lyrics'), 1_000_000), lyrics = lyricText ? config.format === 'ttml' || lyricText.includes('<tt') ? parseTtml(lyricText) : parseLrc(lyricText) : null;
  return { id: `${profile.id}:${id}`, provider: profile.id, externalId: id, fields: { title, artist: metadataText(field('artist')), albumArtist: metadataText(field('albumArtist')),
    album: metadataText(field('album')), year: integer('year'), track: integer('track'), discNumber: integer('discNumber'), genres },
    duration: Number.isFinite(duration) && duration > 0 ? duration / (paths.duration === 'duration' ? 1 : 1000) : undefined,
    coverUrl: metadataUrl(field('cover')), ...(lyrics && validLyricDocument(lyrics) ? { lyrics } : {}) };
}
export async function searchCustomMetadata(profile: ScraperProfile, request: ScrapeRequest, operation: ScrapeOperation): Promise<ScrapeCandidate[]> {
  const variables = { query: [request.title, request.artist, request.album].filter(Boolean).join(' '), title: request.title, artist: request.artist ?? '', album: request.album ?? '', duration: String(request.duration ?? 0), limit: String(request.limit ?? 15) };
  const config = profile.search ?? profile.lyrics!;
  const result = await endpoint(profile, profile.search ? 'search' : 'lyrics', variables, operation);
  if (!profile.search) {
    const lyrics = await customLyrics(profile, result, config, operation);
    return lyrics && validLyricDocument(lyrics) ? [{ id: `${profile.id}:direct`, provider: profile.id, externalId: 'direct', fields: { title: request.title, artist: request.artist }, duration: request.duration, lyrics }] : [];
  }
  const list = config.items ? jsonMetadataPath(result, config.items) : result;
  return (Array.isArray(list) ? list : list ? [list] : []).slice(0, 30).flatMap((entry) => customMetadataCandidate(profile, entry, config) ?? []);
}
export async function detailCustomMetadata(profile: ScraperProfile, candidate: ScrapeCandidate, operation: ScrapeOperation): Promise<ScrapeCandidate> {
  let updated = candidate;
  if (profile.detail) {
    const data = await endpoint(profile, 'detail', { id: candidate.externalId }, operation);
    updated = customMetadataCandidate(profile, data, profile.detail, candidate.externalId) ?? candidate;
  }
  if (profile.cover) {
    const data = await endpoint(profile, 'cover', { id: candidate.externalId }, operation);
    const first = Array.isArray(data) ? data[0] : data;
    const cover = metadataUrl(jsonMetadataPath(first, profile.cover.fields?.cover ?? 'coverUrl'));
    if (cover) updated = { ...updated, coverUrl: cover };
  }
  if (profile.lyrics) {
    const data = await endpoint(profile, 'lyrics', { id: candidate.externalId }, operation);
    const lyrics = await customLyrics(profile, data, profile.lyrics, operation);
    if (lyrics && validLyricDocument(lyrics)) updated = { ...updated, lyrics };
  }
  return updated;
}
async function customLyrics(profile: ScraperProfile, data: unknown, config: MetadataEndpoint, operation: ScrapeOperation): Promise<SongLyrics | null> {
  if (data && typeof data === 'object' && ((data as Json)._fetchEncryptedLyrics === true || (data as Json)._fetchLyrics === true)) {
    const credentials = await scraperCredentials(profile.id, operation, profile); metadataCheck(operation);
    const secrets = credentials.secrets ?? {}, variables = (data as Json).vars;
    const variants = (Array.isArray(variables) ? variables : [variables]).slice(0, 5);
    let best: SongLyrics | null = null, longest = 0;
    for (const raw of variants) {
      metadataCheck(operation);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const values = Object.fromEntries(Object.entries(raw).filter(([key, value]) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) && (typeof value === 'string' || typeof value === 'number')).map(([key, value]) => [key, String(value)]));
      let lyrics: SongLyrics | null = null;
      try {
        if (secrets.lyricsFetchUrl && secrets.lyricsContentField && secrets.lyricsMagicHex && secrets.lyricsXorKeyHex) {
          const location = expandMetadataTemplate(secrets.lyricsFetchUrl, values);
          const text = await metadataRequest(`custom:${profile.id}`, location, operation, { interval: profile.rateLimitMs });
          const binary = jsonMetadataPath(JSON.parse(text), secrets.lyricsContentField);
          if (typeof binary === 'string' && binary.length <= 3_000_000) {
            try {
              const plain = await decodeScraperLyrics(binary, secrets.lyricsMagicHex, secrets.lyricsXorKeyHex); metadataCheck(operation);
              lyrics = parseRelativeMetadataLyrics(plain);
            } catch (error) { metadataCheck(operation); if (isMetadataCancelled(error)) throw error; }
          }
        }
        if (!lyrics && profile.lyricsFallback && (profile.lyricsFallback.requiredVariables ?? []).every((key) => !!values[key])) {
          const fallback = profile.lyricsFallback, location = expandMetadataTemplate(fallback.url, values);
          const text = await metadataRequest(`custom:${profile.id}`, location, operation, { interval: profile.rateLimitMs });
          const content = jsonMetadataPath(JSON.parse(text), fallback.contentField);
          if (typeof content === 'string' && content.length <= 2_000_000) {
            const plain = fallback.encoding === 'base64UTF8' ? new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content), (character) => character.charCodeAt(0))) : content;
            lyrics = parseLrc(plain);
          }
        }
      } catch (error) { if (isMetadataCancelled(error) || !best) throw error; break; }
      const length = lyrics?.lines.reduce((count, line) => count + line.value.length, 0) ?? 0;
      if (lyrics && validLyricDocument(lyrics) && length > longest) { best = lyrics; longest = length; }
    }
    return best;
  }
  const text = typeof data === 'string' ? data : metadataText((data as Json)?.wordLevelLrc, 1_000_000)
    ?? metadataText(jsonMetadataPath(data, config.fields?.lyrics ?? 'lrcContent'), 1_000_000) ?? metadataText((data as Json)?.plainText, 1_000_000);
  return text ? config.format === 'ttml' || text.includes('<tt') ? parseTtml(text) : parseLrc(text) : null;
}
