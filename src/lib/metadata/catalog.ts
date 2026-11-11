/** Read-only, resumable enumeration for App-local metadata jobs. No server writes. */
import * as FileSystem from 'expo-file-system/legacy';
import { coverArtUrl, getAlbum, getAlbumList, getArtists, getCatalogSongPage, getPlaylist, getPlaylists, getSong } from '@/api/data';
import { getSong as getServerSong } from '@/api/backend';
import type { Song } from '@/api/subsonic';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useLibraries } from '@/store/libraries';
import { captureCustomizationOwner, readLocalCustomization } from '@/lib/localCustomizations';
import { validCustomizationValue, type LocalArtistAlias, type LocalLyricEdit, type LocalSongMetadata } from '@/lib/localCustomizationModels';
import { applySongDisplay, sourceSong } from '@/lib/localMetadata';
import { hashKey } from '@/lib/localLibrary';
import { cachedLyricCandidates } from '@/lib/lyricLibraryDb';
import { lyricRecordingKey, validLyricDocument } from '@/lib/lyricDocuments';
import { readSavedLyrics } from '@/lib/mediaCacheDb';
import { getOnDeviceLyricCandidates } from '@/lib/localLyrics';
import { ownedAudioUri } from '@/lib/ownedAudio';
import { readMetadataRecord } from './repository';
import { metadataCheck, SCRAPE_FIELDS, type MetadataArtwork, type ScrapeField, type ScrapeOperation } from './models';

export type BulkMetadataScope = { kind: 'all' } | { kind: 'missing' } | { kind: 'selected'; songIds: string[] }
  | { kind: 'album' | 'artist' | 'playlist'; id: string; title?: string };
export interface UnavailableMetadataSong { id: string; issue: string; }
export interface MetadataCatalogPage { songs: Song[]; nextCursor?: string; scanned: number; done: boolean; unavailable?: UnavailableMetadataSong[]; }
export interface MetadataCatalogOptions { search?: string; fields?: readonly ScrapeField[]; }
export interface MetadataContainer { id: string; name: string; subtitle?: string; coverArt?: string; }

const PAGE = 100;
// Protocols returning a complete album/playlist cannot be paged at transport
// level. They are sliced here; library enumeration never loads a complete list.
interface Cursor { version: 1; key: string; offset: number; folder: number; sources?: number; recent: string[]; }
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f]/.test(value);
const nonempty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const normalizeSearch = (value: string | undefined) => (value ?? '').normalize('NFKC').trim().toLocaleLowerCase().slice(0, 300);
function fieldsOf(fields: readonly ScrapeField[] = SCRAPE_FIELDS): ScrapeField[] {
  if (fields.some((field) => !SCRAPE_FIELDS.includes(field))) throw new Error('Invalid metadata fields');
  return SCRAPE_FIELDS.filter((field) => fields.includes(field));
}
function checkScope(scope: BulkMetadataScope) {
  if (!scope || !['all', 'missing', 'selected', 'album', 'artist', 'playlist'].includes(scope.kind)) throw new Error('Invalid metadata scope');
  if (scope.kind === 'selected') { if (!Array.isArray(scope.songIds) || scope.songIds.some((id) => !validId(id))) throw new Error('Invalid selected songs'); }
  else if ((scope.kind === 'album' || scope.kind === 'artist' || scope.kind === 'playlist') && !validId(scope.id)) throw new Error('Invalid metadata container');
}
/** Guard each await, including a folder filter or local-source change mid-read. */
function guarded(operation: ScrapeOperation): ScrapeOperation {
  metadataCheck(operation);
  const state = useAuthStore.getState(), libraries = useLibraries.getState();
  const owns = captureCustomizationOwner(operation.scope, operation.current);
  const result = { ...operation, current: () => {
    const active = useAuthStore.getState(), folders = useLibraries.getState();
    return owns() && !active.hydrating && active.auth === state.auth && active.offline === state.offline
      && active.offlineSource === state.offlineSource && folders.disabled === libraries.disabled && folders.folders === libraries.folders;
  } };
  metadataCheck(result); return result;
}
async function checked<T>(operation: ScrapeOperation, read: () => Promise<T>): Promise<T> {
  metadataCheck(operation); const result = await read(); metadataCheck(operation); return result;
}
function identity(scope: BulkMetadataScope, options: MetadataCatalogOptions, operation: ScrapeOperation): string {
  const state = useAuthStore.getState(), folders = useLibraries.getState();
  const selection = scope.kind === 'selected' ? ['selected', hashKey(JSON.stringify(scope.songIds))]
    : 'id' in scope ? [scope.kind, scope.id] : [scope.kind];
  return hashKey(JSON.stringify([operation.scope.profile, operation.scope.source, profileScopeId(), state.offline,
    state.auth?.serverType, folders.disabled, folders.folders, selection, normalizeSearch(options.search), fieldsOf(options.fields)]));
}
function readCursor(text: string | undefined, key: string): Cursor {
  if (text === undefined) return { version: 1, key, offset: 0, folder: 0, recent: [] };
  if (text.length > 4096) throw new Error('Invalid metadata cursor');
  let cursor: Cursor;
  try { cursor = JSON.parse(text); } catch { throw new Error('Invalid metadata cursor'); }
  if (!cursor || cursor.version !== 1 || cursor.key !== key || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0
    || !Number.isSafeInteger(cursor.folder) || cursor.folder < 0 || cursor.folder > 1000
    || cursor.sources !== undefined && (!Number.isInteger(cursor.sources) || cursor.sources < 1 || cursor.sources > 1000)
    || !Array.isArray(cursor.recent) || cursor.recent.length > 8 || cursor.recent.some((item) => typeof item !== 'string' || item.length > 100)) throw new Error('Metadata catalogue changed; start again');
  return cursor;
}
function finish(songs: Song[], scanned: number, done: boolean, cursor: Cursor, unavailable: UnavailableMetadataSong[] = []): MetadataCatalogPage {
  return { songs, scanned, done, ...(done ? {} : { nextCursor: JSON.stringify(cursor) }), ...(unavailable.length ? { unavailable } : {}) };
}
function validateSongs(songs: Song[]) {
  if (!Array.isArray(songs) || songs.some((song) => !song || !validId(song.id))) throw new Error('Invalid catalogue songs');
}
async function effectiveSong(song: Song, operation: ScrapeOperation): Promise<Song> {
  const raw = sourceSong(song);
  const correction = await checked(operation, () => readLocalCustomization<LocalSongMetadata>(operation.scope, 'song-metadata', raw.id, operation.current));
  const alias = raw.artistId ? await checked(operation, () => readLocalCustomization<LocalArtistAlias>(operation.scope, 'artist-alias', raw.artistId!, operation.current)) : undefined;
  return applySongDisplay(raw, correction && validCustomizationValue('song-metadata', correction) ? { [raw.id]: correction } : {},
    alias && validCustomizationValue('artist-alias', alias) && alias.artistId === raw.artistId ? [alias] : []);
}
async function fileExists(uri: string | undefined, operation: ScrapeOperation): Promise<boolean> {
  if (!uri || !/^(file|content):/i.test(uri)) return false;
  const info = await checked(operation, () => FileSystem.getInfoAsync(uri).catch(() => undefined));
  return !!info?.exists && !info.isDirectory && (info.size === undefined || info.size > 0);
}
async function hasCover(song: Song, operation: ScrapeOperation): Promise<boolean> {
  const root = `${FileSystem.documentDirectory}metadata-artwork/${hashKey(operation.scope.profile)}/${hashKey(operation.scope.source)}/`;
  for (const id of [`song:${song.id}`, ...(song.albumId ? [`album:${song.albumId}`] : [])]) {
    const saved = await checked(operation, () => readMetadataRecord<MetadataArtwork>('artwork', id, operation));
    if (saved?.uri?.startsWith(root) && await fileExists(saved.uri, operation)) return true;
  }
  if (nonempty(song.coverBase64) || song.hasCover === true) return true;
  // A server-advertised artwork ID is evidence of known art, not of downloaded
  // bytes. albumId alone is NOT evidence: coverArtUrl can invent a remote URL.
  if (nonempty(song.coverArt) && !/^(file|content):/i.test(song.coverArt!)) return true;
  const local = coverArtUrl(song.coverArt ?? song.albumId);
  return fileExists(local, operation);
}
async function hasLyrics(song: Song, operation: ScrapeOperation): Promise<boolean> {
  const profile = hashKey(operation.scope.profile);
  const edit = await checked(operation, () => readLocalCustomization<LocalLyricEdit>(operation.scope, 'lyric-edit', song.id, operation.current));
  if (edit && validCustomizationValue('lyric-edit', edit) && edit.recording === lyricRecordingKey(song)) return true;
  const candidates = await checked(operation, () => cachedLyricCandidates(profile, song, operation.current));
  if (candidates.some((candidate) => validLyricDocument(candidate.lyrics))) return true;
  for (const source of ['local', 'online', 'off']) {
    const saved = await checked(operation, () => readSavedLyrics(profile, song.id, source));
    if (validLyricDocument(saved)) return true;
  }
  const uri = ownedAudioUri(song);
  if (!uri) return false;
  const files = await checked(operation, () => getOnDeviceLyricCandidates({ ...song, localUri: uri }, operation.current));
  return files.some((candidate) => validLyricDocument(candidate.lyrics));
}
/** Missing means absent from effective local tags / known on-device resources.
 * This never asks a lyric or artwork provider, nor changes the server or NAS. */
export async function metadataMissingFields(song: Song, fields: readonly ScrapeField[], operation: ScrapeOperation): Promise<ScrapeField[]> {
  const owner = guarded(operation), chosen = fieldsOf(fields), effective = await effectiveSong(song, owner), raw = sourceSong(song);
  const missing: ScrapeField[] = [];
  for (const field of chosen) {
    metadataCheck(owner);
    const present = field === 'cover' ? await hasCover(raw, owner) : field === 'lyrics' ? await hasLyrics(raw, owner)
      : field === 'genres' ? !!effective.genres?.some((genre) => nonempty(genre.name)) || nonempty(effective.genre)
        : field === 'albumArtist' ? nonempty(effective.albumArtist) || !!effective.albumArtists?.some((artist) => nonempty(artist.name))
          : field === 'mediaKind' ? ['music', 'podcast', 'audiobook'].includes(effective.mediaKind ?? '')
            : field === 'year' ? Number.isInteger(effective.year) && effective.year! > 0
              : field === 'track' || field === 'discNumber' ? Number.isInteger(effective[field]) && effective[field]! > 0 : nonempty(effective[field]);
    if (!present) missing.push(field);
  }
  metadataCheck(owner); return missing;
}
export async function isMetadataSongMissing(song: Song, fields: readonly ScrapeField[], operation: ScrapeOperation): Promise<boolean> {
  return (await metadataMissingFields(song, fields, operation)).length > 0;
}
function artistMatches(song: Song, id: string): boolean {
  return song.artistId === id || [...(song.artists ?? []), ...(song.albumArtists ?? []), ...(song.contributors ?? []).map((credit) => credit.artist)].some((artist) => artist.id === id);
}
async function filterSongs(songs: Song[], scope: BulkMetadataScope, options: MetadataCatalogOptions, operation: ScrapeOperation): Promise<Song[]> {
  const query = normalizeSearch(options.search), selected = scope.kind === 'selected' ? new Set(scope.songIds) : undefined;
  const output: Song[] = [], seen = new Set<string>();
  // Sequential bounded local reads keep large missing-field scans from
  // spawning thousands of DB/native calls or retaining the whole library.
  for (const song of songs) {
    metadataCheck(operation);
    if (seen.has(song.id) || selected && !selected.has(song.id) || scope.kind === 'artist' && !artistMatches(sourceSong(song), scope.id)) continue;
    seen.add(song.id);
    const displayed = await effectiveSong(song, operation);
    if (query && !normalizeSearch([displayed.title, displayed.artist, displayed.album, displayed.albumArtist].filter(Boolean).join(' ')).includes(query)) continue;
    if (scope.kind === 'missing' && !await isMetadataSongMissing(song, fieldsOf(options.fields), operation)) continue;
    output.push(displayed);
  }
  return output;
}
async function cataloguePage(cursor: Cursor, operation: ScrapeOperation): Promise<{ songs: Song[]; done: boolean }> {
  const result = await checked(operation, () => getCatalogSongPage(PAGE, cursor.offset, cursor.folder));
  validateSongs(result.songs);
  if (result.songs.length > PAGE || !Number.isInteger(result.sourceCount) || result.sourceCount < 1 || result.sourceCount > 1000) throw new Error('Invalid catalogue page');
  if (cursor.sources !== undefined && cursor.sources !== result.sourceCount) throw new Error('Catalogue sources changed');
  cursor.sources = result.sourceCount;
  if (!result.songs.length) {
    cursor.folder++; cursor.offset = 0; cursor.recent = [];
    return { songs: [], done: cursor.folder >= result.sourceCount };
  }
  const signature = hashKey(JSON.stringify(result.songs.map((song) => song.id)));
  if (cursor.recent.includes(signature)) throw new Error('The server repeated a catalogue page');
  cursor.recent = [...cursor.recent.slice(-7), signature];
  cursor.offset += result.songs.length;
  if (!Number.isSafeInteger(cursor.offset)) throw new Error('Catalogue offset is too large');
  // A short page can be a server-side cap. Only an empty page ends a folder.
  return { songs: result.songs, done: false };
}
export async function readMetadataCatalogPage(scope: BulkMetadataScope, cursorText: string | undefined, operation: ScrapeOperation,
  options: MetadataCatalogOptions = {}): Promise<MetadataCatalogPage> {
  checkScope(scope);
  const owner = guarded(operation), cursor = readCursor(cursorText, identity(scope, options, owner));
  if (scope.kind === 'album' || scope.kind === 'playlist') {
    const detail = await checked<{ songs: Song[] }>(owner, () => scope.kind === 'album' ? getAlbum(scope.id) : getPlaylist(scope.id));
    validateSongs(detail.songs);
    const page = detail.songs.slice(cursor.offset, cursor.offset + PAGE); cursor.offset += page.length;
    return finish(await filterSongs(page, scope, options, owner), page.length, cursor.offset >= detail.songs.length, cursor);
  }
  const state = useAuthStore.getState();
  if (scope.kind === 'selected' && !scope.songIds.length) return finish([], 0, true, cursor);
  if (scope.kind === 'selected' && state.auth && !state.offline) {
    const ids = scope.songIds.slice(cursor.offset, cursor.offset + PAGE), songs: Song[] = [], unavailable: UnavailableMetadataSong[] = [];
    // Four reads at a time; errors propagate rather than silently dropping
    // an unavailable server or presenting a partial selected set as complete.
    for (let offset = 0; offset < ids.length; offset += 4) {
      const values = await Promise.all(ids.slice(offset, offset + 4).map((id) => checked(owner, () => getServerSong(state.auth!, id))));
      for (let index = 0; index < values.length; index++) {
        const song = values[index];
        if (!song) {
          // Preserve an explicit row for a genuinely deleted selection. It
          // must not block every later ID, nor silently vanish from the job.
          unavailable.push({ id: ids[offset + index], issue: 'Metadata recording changed. Review again.' });
          continue;
        }
        if (song.id !== ids[offset + index]) throw new Error('Song identity changed');
        songs.push(song);
      }
    }
    cursor.offset += ids.length;
    return finish(await filterSongs(songs, scope, options, owner), ids.length, cursor.offset >= scope.songIds.length, cursor, unavailable);
  }
  // Artist pages use exact primary / album / contributor IDs over the entire
  // enabled catalogue, including guest tracks. No own-album-only truncation.
  const page = await cataloguePage(cursor, owner);
  return finish(await filterSongs(page.songs, scope, options, owner), page.songs.length, page.done, cursor);
}
/** Real library read for the final apply fence; data.getSong is cache-only.
 * Local/offline profiles fall back to bounded catalogue pages.
 * A network/auth error is never interpreted as a deleted song. */
export async function resolveMetadataCatalogSong(id: string, operation: ScrapeOperation): Promise<Song | undefined> {
  if (!validId(id)) throw new Error('Invalid song identity');
  const owner = guarded(operation), state = useAuthStore.getState();
  if (state.auth && !state.offline) {
    const song = await checked(owner, () => getServerSong(state.auth!, id));
    if (song && song.id !== id) throw new Error('Song identity changed');
    return song ?? undefined;
  }
  if (state.offline) {
    const cached = await checked(owner, () => getSong(id));
    if (cached?.id === id) return sourceSong(cached);
  }
  const cursor: Cursor = { version: 1, key: '', offset: 0, folder: 0, recent: [] };
  while (true) {
    const page = await cataloguePage(cursor, owner), song = page.songs.find((song) => song.id === id);
    if (song) return sourceSong(song);
    if (page.done) return undefined;
    await checked(owner, () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }
}
/** Offset refers to raw container rows, so an empty filtered page may continue.
 * Subsonic's thin artist/playlist index is intrinsically unpaged; no tracks are
 * fetched here. Albums use the existing paged data facade. */
export async function listMetadataContainers(kind: 'album' | 'artist' | 'playlist', query: string, offset: number, operation: ScrapeOperation): Promise<{ items: MetadataContainer[]; nextOffset?: number }> {
  if (!['album', 'artist', 'playlist'].includes(kind) || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid metadata containers page');
  const owner = guarded(operation), search = normalizeSearch(query);
  let rows: MetadataContainer[], more: boolean;
  if (kind === 'album') {
    const albums = await checked(owner, () => getAlbumList('alphabeticalByName', PAGE, offset));
    rows = albums.map((album) => ({ id: album.id, name: album.name, subtitle: album.artist, coverArt: album.coverArt }));
    // Server caps can produce a short non-final page, just as for songs.
    more = rows.length > 0;
  } else {
    const values = await checked(owner, () => kind === 'artist' ? getArtists() : getPlaylists());
    rows = values.slice(offset, offset + PAGE).map((entry) => ({ id: entry.id, name: entry.name, coverArt: entry.coverArt }));
    more = offset + rows.length < values.length;
  }
  const items = rows.filter((entry) => validId(entry.id) && (!search || normalizeSearch(`${entry.name} ${entry.subtitle ?? ''}`).includes(search)));
  metadataCheck(owner); return { items, ...(more ? { nextOffset: offset + rows.length } : {}) };
}
