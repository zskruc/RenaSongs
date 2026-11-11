import type { Song } from '@/api/subsonic';
import { isAudiobookTrack } from '@/store/albumProgress';
import { scopeKey, useLocalMetadata } from '@/store/localMetadata';
import { customizationScope } from './localCustomizations';
import { songContentKind, type ListeningContentKind } from './contentKind';
/** In-memory only. No metadata reads or catalogue work on playback ticks. */
export function currentContentClassifier(): (song: Song | null | undefined) => ListeningContentKind {
  const state = useLocalMetadata.getState(), key = scopeKey(customizationScope());
  const corrections = state.ready && state.scope === key ? state.songs : undefined;
  return (song) => {
    const override = song ? corrections?.[song.id]?.patch.mediaKind ?? song.mediaKind : undefined;
    const kind = songContentKind(song, override);
    return override !== undefined || kind !== 'music' ? kind : isAudiobookTrack(song) ? 'audiobook' : 'music';
  };
}
export function getSongContentKind(song: Song | null | undefined): ListeningContentKind { return currentContentClassifier()(song); }
export const isSpokenContent = (song: Song | null | undefined): boolean => getSongContentKind(song) !== 'music';
