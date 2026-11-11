/** Local audiobook bookmarks, scoped to the same account across online/offline. */
import { create } from 'zustand';
import type { Album, Song, SubsonicAuth } from '@/api/subsonic';
import { AlbumProgressPersistence } from '@/lib/albumProgressPersistence';
import { audiobookAlbum, isAudiobookSong, type AlbumProgressEntry } from '@/lib/audiobook';
import { queryClient } from '@/lib/query';
import { primaryUrl } from '@/lib/serverUrls';
import { getItem, setItemStrict } from '@/lib/storage';
import { useAuthStore } from './auth';
import { scopeKey, useLocalMetadata } from './localMetadata';
import { customizationScope } from '@/lib/localCustomizations';

export { audiobookAlbum, isAudiobookAlbum, isAudiobookSong } from '@/lib/audiobook';
export type { AlbumProgressEntry } from '@/lib/audiobook';
const repository = new AlbumProgressPersistence({ read: () => getItem('resonus.albumProgress.v2'),
  write: (value) => setItemStrict('resonus.albumProgress.v2', value) });
export const useAlbumProgress = create(() => ({ ...repository.getSnapshot(),
  hydrate: repository.hydrate, flush: repository.flush, clearAll: repository.clearAll,
  remember: repository.remember.bind(repository), clearAlbum: repository.clearAlbum.bind(repository) }));
repository.subscribe(() => useAlbumProgress.setState(repository.getSnapshot()));

export function audiobookProfileScope(auth = useAuthStore.getState().auth, offline = useAuthStore.getState().offline): string {
  if (auth) return `${primaryUrl(auth)}|${auth.username}|${auth.serverType ?? 'subsonic'}`;
  if (!offline) return 'default';
  const source = useAuthStore.getState().offlineSource;
  return source?.mode === 'folder' ? `local:${JSON.stringify([...source.uris].sort())}` : 'local:device';
}
const EMPTY: Record<string, AlbumProgressEntry> = Object.freeze({});
export function useAlbumProgressByAlbum(auth: SubsonicAuth | null | undefined, offline: boolean) {
  useAuthStore((state) => state.offlineSource);
  const scope = audiobookProfileScope(auth ?? null, offline);
  return useAlbumProgress((state) => state.byProfile[scope] ?? EMPTY);
}
export function isAudiobookAlbumId(albumId: string | undefined): boolean {
  if (!albumId) return false;
  const cached = queryClient.getQueryData<{ album: Album; songs: Song[] }>(['album', albumId]);
  return !!cached && audiobookAlbum(cached.album, cached.songs ?? []);
}
export function isAudiobookTrack(song: Song | null | undefined): boolean {
  if (!song || song.podcastChannelId) return false;
  const metadata = useLocalMetadata.getState();
  const kind = metadata.ready && metadata.scope === scopeKey(customizationScope()) ? metadata.songs[song.id]?.patch.mediaKind ?? song.mediaKind : song.mediaKind;
  if (kind !== undefined) return kind === 'audiobook';
  // Podcast streams never inherit an audiobook tag from an old cached album ID.
  return !!song && !song.url && !song.vod && !(song as Song & { podcastChannelId?: string }).podcastChannelId
    && (isAudiobookSong(song) || isAudiobookAlbumId(song.albumId));
}

export async function exportAlbumProgress() {
  await repository.hydrate(); return { ...(repository.getSnapshot().byProfile[audiobookProfileScope()] ?? {}) };
}
export async function importAlbumProgress(value: unknown, current: () => boolean) {
  const { parseAlbumProgress } = await import('@/lib/albumProgressPersistence');
  const entries = parseAlbumProgress(JSON.stringify({ restored: value })).restored;
  if (Object.keys(entries).length > 10000) throw new Error('Invalid audiobook progress');
  const scope = audiobookProfileScope(); await repository.hydrate();
  for (const [albumId, entry] of Object.entries(entries)) {
    if (!current() || scope !== audiobookProfileScope()) throw new Error('Profile changed');
    const old = repository.getSnapshot().byProfile[scope]?.[albumId];
    if (!old || old.updatedAt < entry.updatedAt) repository.remember(scope, albumId, entry.trackId, entry.positionSec, true);
  }
  await repository.flush();
}
