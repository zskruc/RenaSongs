import type { Song } from '@/api/subsonic';
import { metadataFields, sourceSong } from '@/lib/localMetadata';
import { readLocalCustomization, writeLocalCustomization } from '@/lib/localCustomizations';
import { type LocalSongMetadata, type SongMetadataPatch } from '@/lib/localCustomizationModels';
import { hashKey } from '@/lib/localLibrary';
import { saveLyricCandidate, selectLyricCandidate, chosenLyricSource, cachedLyricCandidates } from '@/lib/lyricLibraryDb';
import { validLyricDocument, lyricRecordingKey } from '@/lib/lyricDocuments';
import { queryClient } from '@/lib/query';
import { metadataCheck, type ScrapeCandidate, type ScrapeField, type ScrapeOperation } from './models';
import { readMetadataRecord, saveMetadataRecord } from './repository';

export interface MetadataUndo { version: 1; id: string; songId: string; recording: string; title: string; before?: LocalSongMetadata;
  after: LocalSongMetadata; lyricBefore?: string | null; lyricAfter?: string; createdAt: number; undone?: boolean; }
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Existing manual fields are preserved by default. Empty provider data never erases a field. */
export function metadataPatch(song: Song, current: LocalSongMetadata | undefined, candidate: ScrapeCandidate, fields: readonly ScrapeField[], overwrite: boolean): SongMetadataPatch {
  const raw = sourceSong(song), patch: SongMetadataPatch = { ...current?.patch };
  for (const field of fields) {
    if (field === 'cover' || field === 'lyrics') continue;
    const value = candidate.fields[field];
    if (value === undefined || value === '' || Array.isArray(value) && !value.length) continue;
    const previous = patch[field] ?? raw[field];
    const nonempty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
    const present = field === 'genres' ? Array.isArray(previous) && previous.some((entry) => nonempty(entry?.name)) || nonempty(patch.genre ?? raw.genre)
      : field === 'albumArtist' ? nonempty(previous) || !!raw.albumArtists?.some((artist) => nonempty(artist.name))
      : typeof previous === 'string' ? previous.trim().length > 0
      : field === 'year' || field === 'track' || field === 'discNumber' ? Number.isInteger(previous) && Number(previous) > 0
        : Array.isArray(previous) ? previous.some((entry) => typeof entry === 'object' && entry && typeof entry.name === 'string' && entry.name.trim()) : previous !== undefined && previous !== null;
    if (!overwrite && present) continue;
    Object.assign(patch, { [field]: value });
    if (field === 'genres' && Array.isArray(value) && value.length) patch.genre = value[0].name;
  }
  return patch;
}
/** Prepare intent before changing local data; retry reconciles before/after, never overwrites a later manual edit. */
export async function applyMetadataCandidate(song: Song, candidate: ScrapeCandidate, fields: readonly ScrapeField[], overwrite: boolean,
  operation: ScrapeOperation, intentId = `edit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, notify = true): Promise<string> {
  metadataCheck(operation); const raw = sourceSong(song);
  const before = await readLocalCustomization<LocalSongMetadata>(operation.scope, 'song-metadata', raw.id, operation.current); metadataCheck(operation);
  let intent = await readMetadataRecord<MetadataUndo>('undo', intentId, operation); metadataCheck(operation);
  if (intent && (intent.songId !== raw.id || intent.recording !== lyricRecordingKey(raw))) throw new Error('Metadata recording changed');
  if (!intent) {
    const patch = metadataPatch(raw, before, candidate, fields, overwrite);
    const after: LocalSongMetadata = { version: 1, patch, original: before?.original ?? metadataFields(raw), ...(raw.albumId ? { albumId: raw.albumId } : {}), ...(raw.artistId ? { artistId: raw.artistId } : {}) };
    const lyricBefore = fields.includes('lyrics') && candidate.lyrics ? await chosenLyricSource(hashKey(operation.scope.profile), raw, operation.current) : undefined;
    const lyricProvider = candidate.lyricsSource ?? candidate;
    intent = { version: 1, id: intentId, songId: raw.id, recording: lyricRecordingKey(raw), title: raw.title, before, after,
      ...(lyricBefore === undefined ? {} : { lyricBefore, lyricAfter: `metadata:${lyricProvider.provider}:${lyricProvider.externalId}` }), createdAt: Date.now() };
    await saveMetadataRecord('undo', intentId, intent, operation);
  }
  if (!same(before, intent.before) && !same(before, intent.after)) throw new Error('Local metadata changed. Review again.');
  if (!same(before, intent.after)) await writeLocalCustomization(operation.scope, 'song-metadata', raw.id, intent.after, operation.current, { notify, expected: before });
  metadataCheck(operation);
  if (fields.includes('lyrics') && candidate.lyrics && validLyricDocument(candidate.lyrics) && intent.lyricAfter) {
    const entry = { id: intent.lyricAfter, kind: 'provider' as const, label: candidate.lyricsSource?.provider ?? candidate.provider, lyrics: candidate.lyrics };
    await saveLyricCandidate(hashKey(operation.scope.profile), raw, entry, operation.current); metadataCheck(operation);
    await selectLyricCandidate(hashKey(operation.scope.profile), raw, entry, operation.current, intent.lyricBefore ?? null); metadataCheck(operation);
    await queryClient.invalidateQueries({ queryKey: ['lyrics', raw.id] });
  }
  return intentId;
}
export async function undoMetadataCandidate(song: Song, intentId: string, operation: ScrapeOperation): Promise<void> {
  const raw = sourceSong(song), intent = await readMetadataRecord<MetadataUndo>('undo', intentId, operation); metadataCheck(operation);
  if (!intent || intent.undone) return;
  if (intent.songId !== raw.id || intent.recording !== lyricRecordingKey(raw)) throw new Error('Metadata recording changed');
  const value = await readLocalCustomization<LocalSongMetadata>(operation.scope, 'song-metadata', raw.id, operation.current);
  if (!same(value, intent.after) && !same(value, intent.before)) throw new Error('Local metadata changed. Review again.');
  if (!same(value, intent.before)) await writeLocalCustomization(operation.scope, 'song-metadata', raw.id, intent.before, operation.current, { expected: value });
  if (intent.lyricAfter) {
    const selected = await chosenLyricSource(hashKey(operation.scope.profile), raw, operation.current);
    if (selected === intent.lyricAfter) {
      const previous = intent.lyricBefore ? (await cachedLyricCandidates(hashKey(operation.scope.profile), raw, operation.current)).find((entry) => entry.id === intent.lyricBefore) ?? null : null;
      await selectLyricCandidate(hashKey(operation.scope.profile), raw, previous, operation.current, intent.lyricAfter);
      await queryClient.invalidateQueries({ queryKey: ['lyrics', raw.id] });
    }
  }
  metadataCheck(operation); await saveMetadataRecord('undo', intentId, { ...intent, undone: true }, operation);
}
