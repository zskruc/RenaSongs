/** Public metadata protocols; no music-server credentials or file write APIs. */
import type { Song } from '@/api/subsonic';
import { parseLrc } from '@/lib/lrc';
import { parseTtml } from '@/lib/ttml';
import { validLyricDocument } from '@/lib/lyricDocuments';
import { metadataJson, metadataRequest, MetadataRequestError } from './request';
import { isMetadataCancelled, metadataCheck, metadataText, metadataUrl, type MetadataSettings, type ScrapeCandidate, type ScrapeOperation, type ScrapeRelease, type ScrapeRequest, type ScrapeSearch, type ScrapeField } from './models';
import { orderMetadataCandidates } from './matching';
import { type ScraperProfile } from './config';
import { searchCustomMetadata, detailCustomMetadata } from './customProvider';

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const year = (value: unknown) => { const n = Number(String(value ?? '').slice(0, 4)); return Number.isInteger(n) && n >= 1000 && n <= 3000 ? n : undefined; };
const names = (value: unknown): { name: string }[] | undefined => Array.isArray(value)
  ? value.slice(0, 30).flatMap((item) => metadataText(typeof item === 'string' ? item : item?.name, 100) ? [{ name: metadataText(typeof item === 'string' ? item : item?.name, 100)! }] : []) : undefined;
const url = (base: string, params: Record<string, string | number | undefined>) => `${base}?${new URLSearchParams(Object.entries(params).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]]))}`;
type Json = Record<string, any>;
export function itunesMetadata(item: Json, country: string): ScrapeCandidate | null {
  if (!number(item.trackId) || !metadataText(item.trackName)) return null;
  const cover = metadataUrl(item.artworkUrl100 ?? item.artworkUrl60)?.replace(/\d+x\d+bb(?:-[a-z0-9]+)?\./i, '1200x1200bb.');
  return { id: `itunes:${country}:${item.trackId}`, provider: 'itunes', externalId: `${country}:${item.trackId}`,
    fields: { title: metadataText(item.trackName), artist: metadataText(item.artistName), albumArtist: metadataText(item.artistName), album: metadataText(item.collectionName),
      year: year(item.releaseDate), track: number(item.trackNumber), discNumber: number(item.discNumber), genres: names(item.primaryGenreName ? [item.primaryGenreName] : []) },
    duration: number(item.trackTimeMillis) === undefined ? undefined : item.trackTimeMillis / 1000, coverUrl: cover };
}
export function musicBrainzMetadata(item: Json, release?: Json): ScrapeCandidate | null {
  if (!/^[\da-f-]{36}$/i.test(String(item.id)) || !metadataText(item.title)) return null;
  const credits: Json[] = Array.isArray(item['artist-credit']) ? item['artist-credit'] : [];
  const artist = credits.map((credit) => (metadataText(credit.name ?? credit.artist?.name) ?? '') + (credit.joinphrase ?? '')).join('');
  const album = release ?? (Array.isArray(item.releases) ? item.releases[0] : undefined);
  return { id: `musicbrainz:${item.id}`, provider: 'musicbrainz', externalId: item.id,
    fields: { title: metadataText(item.title), artist: metadataText(artist), albumArtist: metadataText(artist), album: metadataText(album?.title),
      year: year(album?.date ?? item['first-release-date']), genres: names(item.genres ?? item.tags) }, duration: number(item.length) === undefined ? undefined : item.length / 1000,
    edition: metadataText(album?.disambiguation), coverUrl: album?.id ? `https://coverartarchive.org/release/${encodeURIComponent(album.id)}/front-1200` : undefined };
}
async function searchItunes(request: ScrapeRequest, operation: ScrapeOperation): Promise<ScrapeCandidate[]> {
  const countries = /\p{Script=Han}/u.test(request.artist ?? request.title) ? ['TW', 'US'] : ['US', 'TW'];
  const candidates: ScrapeCandidate[] = [];
  for (const country of countries) {
    const result = await metadataJson<{ results?: Json[] }>('itunes', url('https://itunes.apple.com/search', {
      term: [request.title, request.artist].filter(Boolean).join(' '), entity: 'song', media: 'music', country, limit: Math.min(30, request.limit ?? 15),
    }), operation);
    metadataCheck(operation);
    candidates.push(...(result.results ?? []).flatMap((item) => itunesMetadata(item, country) ?? []));
    if (orderMetadataCandidates(request, candidates).some((candidate) => candidate.confident)) break;
  }
  return candidates;
}
async function searchMusicBrainz(request: ScrapeRequest, operation: ScrapeOperation): Promise<ScrapeCandidate[]> {
  const escape = (value: string) => value.replace(/["\\]/g, '\\$&');
  const query = `recording:"${escape(request.title)}"${request.artist ? ` AND artist:"${escape(request.artist)}"` : ''}`;
  const result = await metadataJson<{ recordings?: Json[] }>('musicbrainz', url('https://musicbrainz.org/ws/2/recording/', { query, fmt: 'json', limit: Math.min(30, request.limit ?? 15) }), operation);
  return (result.recordings ?? []).flatMap((item) => musicBrainzMetadata(item) ?? []);
}
async function searchLrclib(request: ScrapeRequest, operation: ScrapeOperation): Promise<ScrapeCandidate[]> {
  const result = await metadataJson<Json[]>('lrclib', url('https://lrclib.net/api/search', { track_name: request.title, artist_name: request.artist }), operation);
  if (!Array.isArray(result)) throw new MetadataRequestError('invalid-response');
  return result.slice(0, 20).flatMap((item) => {
    const text = metadataText(item.syncedLyrics ?? item.plainLyrics, 1_000_000), lyrics = text ? parseLrc(text) : null;
    return lyrics && validLyricDocument(lyrics) ? [{ id: `lrclib:${item.id}`, externalId: String(item.id), provider: 'lrclib',
      fields: { title: metadataText(item.trackName), artist: metadataText(item.artistName), album: metadataText(item.albumName) }, duration: number(item.duration), lyrics }] : [];
  });
}
async function searchAmll(request: ScrapeRequest, operation: ScrapeOperation): Promise<ScrapeCandidate[]> {
  const result = await metadataJson<{ data?: { items?: Json[] } }>('amll', url('https://api.amll.dev/v1/lyrics/search', {
    musicName: request.title, artistName: request.artist?.split(/\s*[/;&、]\s*/)[0], pageSize: 30,
  }), operation);
  return (result.data?.items ?? []).slice(0, 20).flatMap((item) => number(item.id) !== undefined ? [{
    id: `amll:${item.id}`, provider: 'amll', externalId: String(item.id), fields: { title: metadataText(item.musicNames?.[0]),
      artist: metadataText(item.artistNames?.join(' / ')), album: metadataText(item.albumNames?.[0]) },
  }] : []);
}
export async function searchMetadata(song: Pick<Song, 'title' | 'artist' | 'album' | 'duration'>, settings: MetadataSettings, profiles: readonly ScraperProfile[], operation: ScrapeOperation,
  parts: 'metadata' | 'lyrics' | 'all' = 'all'): Promise<ScrapeSearch> {
  const candidates: ScrapeCandidate[] = [], issues: ScrapeSearch['issues'] = [];
  const order = [...new Set([...settings.order, ...profiles.map((profile) => profile.id)])];
  const enabled = new Set(settings.enabled);
  for (const id of order) {
    metadataCheck(operation);
    const profile = profiles.find((entry) => entry.id === id);
    if (!enabled.has(id) || profile?.enabled === false || parts === 'metadata' && ['lrclib', 'amll'].includes(id)
      || parts === 'lyrics' && ['itunes', 'musicbrainz'].includes(id)) continue;
    try {
      const request = { ...song, limit: 15 };
      const found = id === 'itunes' ? await searchItunes(request, operation) : id === 'musicbrainz' ? await searchMusicBrainz(request, operation)
        : id === 'lrclib' ? await searchLrclib(request, operation) : id === 'amll' ? await searchAmll(request, operation)
          : profile ? await searchCustomMetadata(profile, request, operation) : [];
      metadataCheck(operation); candidates.push(...found.slice(0, 25));
    } catch (error) {
      if (isMetadataCancelled(error)) throw error;
      issues.push({ provider: id, reason: error instanceof MetadataRequestError ? error.code : 'invalid-response' });
    }
  }
  return { candidates: orderMetadataCandidates(song, candidates).slice(0, 80), issues };
}
export async function detailMetadata(candidate: ScrapeCandidate, profiles: readonly ScraperProfile[], operation: ScrapeOperation): Promise<ScrapeCandidate> {
  metadataCheck(operation);
  if (candidate.provider === 'amll') {
    const data = await metadataJson<{ data?: { lyrics?: string } }>('amll', url('https://api.amll.dev/v1/lyrics/get', { id: candidate.externalId }), operation);
    const lyrics = data.data?.lyrics ? parseTtml(data.data.lyrics) : null;
    return { ...candidate, ...(lyrics && validLyricDocument(lyrics) ? { lyrics } : {}) };
  }
  if (candidate.provider === 'musicbrainz') {
    const item = await metadataJson<Json>('musicbrainz', `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(candidate.externalId)}?inc=artist-credits+releases+tags&fmt=json`, operation);
    return { ...candidate, ...musicBrainzMetadata(item) };
  }
  const profile = profiles.find((entry) => entry.id === candidate.provider);
  return profile ? detailCustomMetadata(profile, candidate, operation) : candidate;
}
/** Complementary providers keep their provenance; a metadata-only result cannot masquerade as a lyric success. */
export async function resolveMetadataCandidateForFields(candidates: readonly ScrapeCandidate[], fields: readonly ScrapeField[], profiles: readonly ScraperProfile[], operation: ScrapeOperation): Promise<ScrapeCandidate | undefined> {
  const trusted = candidates.filter((candidate) => candidate.confident);
  const lyricCapable = (candidate: ScrapeCandidate) => !!candidate.lyrics || candidate.provider === 'amll' || !!profiles.find((profile) => profile.id === candidate.provider)?.lyrics;
  const metadataFields = fields.filter((field) => field !== 'lyrics' && field !== 'cover');
  const first = metadataFields.length ? trusted.find((candidate) => metadataFields.some((field) => candidate.fields[field] !== undefined))
    : fields.includes('cover') ? trusted.find((candidate) => !!candidate.coverUrl) : trusted.find(lyricCapable);
  if (!first) return;
  let selected = await detailMetadata(first, profiles, operation); metadataCheck(operation);
  if (fields.includes('lyrics') && !selected.lyrics) {
    const other = trusted.find((candidate) => candidate.id !== first.id && lyricCapable(candidate));
    if (other) {
      const lyric = await detailMetadata(other, profiles, operation); metadataCheck(operation);
      if (lyric.lyrics) selected = { ...selected, lyrics: lyric.lyrics, lyricsSource: { provider: lyric.provider, externalId: lyric.externalId } };
    }
  }
  if (fields.every((field) => field === 'lyrics') && !selected.lyrics) return;
  return { ...selected, lyricsChecked: fields.includes('lyrics') };
}
export async function searchMetadataReleases(title: string, artist: string | undefined, provider: 'itunes' | 'musicbrainz', operation: ScrapeOperation): Promise<ScrapeRelease[]> {
  if (provider === 'itunes') {
    const countries = /\p{Script=Han}/u.test(artist ?? title) ? ['TW', 'US'] : ['US', 'TW']; const releases: ScrapeRelease[] = [];
    for (const country of countries) {
      const data = await metadataJson<{ results?: Json[] }>('itunes', url('https://itunes.apple.com/search', { term: [title, artist].filter(Boolean).join(' '), entity: 'album', media: 'music', country, limit: 15 }), operation);
      releases.push(...(data.results ?? []).flatMap((item) => item.collectionId && metadataText(item.collectionName) ? [{ id: `itunes:${country}:${item.collectionId}`,
        provider, externalId: `${country}:${item.collectionId}`, title: item.collectionName, artist: metadataText(item.artistName), year: year(item.releaseDate), count: number(item.trackCount),
        coverUrl: metadataUrl(item.artworkUrl100)?.replace(/100x100bb/, '1200x1200bb') }] : []));
      if (releases.length) break;
    }
    return releases;
  }
  const data = await metadataJson<{ releases?: Json[] }>('musicbrainz', url('https://musicbrainz.org/ws/2/release/', {
    query: `release:"${title.replace(/["\\]/g, '\\$&')}"${artist ? ` AND artist:"${artist.replace(/["\\]/g, '\\$&')}"` : ''}`, fmt: 'json', limit: 20,
  }), operation);
  return (data.releases ?? []).flatMap((item) => item.id && item.title ? [{ id: `musicbrainz:${item.id}`, provider, externalId: item.id,
    title: item.title, artist: metadataText(item['artist-credit']?.map((entry: Json) => entry.name ?? entry.artist?.name).join(' / ')), year: year(item.date),
    edition: metadataText([item.country, item.disambiguation, item.status].filter(Boolean).join(' · ')), count: number(item['track-count']) }] : []);
}
export async function metadataReleaseTracks(release: ScrapeRelease, operation: ScrapeOperation): Promise<ScrapeCandidate[]> {
  if (release.provider === 'itunes') {
    const [country, id] = release.externalId.split(':');
    const data = await metadataJson<{ results?: Json[] }>('itunes', url('https://itunes.apple.com/lookup', { id, country, entity: 'song', limit: 500 }), operation);
    return (data.results ?? []).flatMap((item) => itunesMetadata(item, country) ?? []);
  }
  if (release.provider !== 'musicbrainz') throw new MetadataRequestError('invalid-response');
  const data = await metadataJson<Json>('musicbrainz', `https://musicbrainz.org/ws/2/release/${encodeURIComponent(release.externalId)}?inc=recordings+artist-credits+tags&fmt=json`, operation);
  return (data.media ?? []).slice(0, 50).flatMap((disc: Json) => (disc.tracks ?? []).slice(0, 500).flatMap((track: Json) => {
    const candidate = musicBrainzMetadata({ ...track.recording, title: track.title ?? track.recording?.title, length: track.length ?? track.recording?.length,
      'artist-credit': track['artist-credit'] ?? track.recording?.['artist-credit'] ?? data['artist-credit'] }, data);
    return candidate ? [{ ...candidate, id: `${candidate.id}:${disc.position}:${track.position}`, fields: { ...candidate.fields, track: number(track.position), discNumber: number(disc.position) } }] : [];
  })).slice(0, 1000);
}
export async function downloadMetadataText(key: string, location: string, operation: ScrapeOperation): Promise<string> { return metadataRequest(key, location, operation); }
