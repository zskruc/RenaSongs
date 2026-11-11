import type { Song } from '@/api/subsonic';
import { isAudiobookSong } from './audiobook';
export type ListeningContentKind = 'music' | 'podcast' | 'audiobook';
/** An explicit user classification wins over genre inference. */
export function songContentKind(song: Song | null | undefined, override?: ListeningContentKind, audiobook = false): ListeningContentKind {
  if (override) return override;
  if (song?.mediaKind) return song.mediaKind;
  if (song?.podcastChannelId || song && [song.genre, ...(song.genres ?? []).map((g) => g.name)].some((value) => /^(podcasts?|播客)$/i.test(value?.trim() ?? ''))) return 'podcast';
  return audiobook || isAudiobookSong(song) ? 'audiobook' : 'music';
}
export const isLocalPodcastSong = (song: Song, kind = songContentKind(song)) => kind === 'podcast' && !song.podcastChannelId;
