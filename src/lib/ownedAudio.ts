import * as FileSystem from 'expo-file-system/legacy';
import type { Song } from '@/api/subsonic';
import { useDownloads } from '@/store/downloads';
import { usePodcastDownloads } from '@/store/podcastDownloads';
import { cachedUri } from '@/store/songCache';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { hashKey } from './localLibrary';
import { ownedLyricAudioUri } from './lyricAudioUri';
import { captureLyricOwner } from './lyricOwner';

function localUri(value: string | undefined): string | undefined {
  if (!value || /[\u0000-\u001f]/.test(value)) return;
  try {
    const uri = new URL(value);
    if (uri.username || uri.password || uri.protocol === 'file:' && uri.hostname && uri.hostname !== 'localhost') return;
    return uri.protocol === 'file:' || uri.protocol === 'content:' ? uri.toString() : undefined;
  } catch { return; }
}
/** Stores may still contain another account's same-ID file while hydrating.
 * Server tools accept only the active account's private files. Local-library
 * profiles intentionally include their already-scanned local/download files. */
export function ownedAudioUri(song: Song): string | undefined {
  const profile = hashKey(profileScopeId()), root = FileSystem.documentDirectory;
  if (song.podcastChannelId) {
    const downloads = usePodcastDownloads.getState();
    const uri = localUri(downloads.scope === profile ? downloads.files[song.id] : undefined);
    if (uri && root && uri.startsWith(`${root}podcasts/${profile}/audio/`)) return uri;
    return undefined;
  }
  const ownLocal = localUri(song.localUri);
  if (ownLocal && !useAuthStore.getState().auth) return ownLocal;
  return ownedLyricAudioUri(profile, ownLocal, localUri(useDownloads.getState().files[song.id]))
    ?? ownedLyricAudioUri(profile, localUri(cachedUri(song.id)));
}
export interface OwnedAudioIdentity {
  uri: string; key: string; stamp: string; size: number; modificationTime?: number; md5?: string;
}
/** Alignment requests hash the selected local bytes before/after preparation.
 * Normal cache reads use size/mtime; providers without a timestamp need MD5. */
export async function ownedAudioIdentity(song: Song, current = captureLyricOwner(), digest = false): Promise<OwnedAudioIdentity> {
  if (!current()) throw new Error('Local audio owner changed');
  const uri = ownedAudioUri(song);
  if (!uri) throw new Error('Download the audio or choose a local file first');
  let info = await FileSystem.getInfoAsync(uri, digest ? { md5: true } : undefined);
  if (!current() || ownedAudioUri(song) !== uri) throw new Error('Local audio owner changed');
  if (!info.exists || info.isDirectory || !Number.isFinite(info.size) || info.size <= 0) throw new Error('Local audio is unavailable');
  if (!digest && (!Number.isFinite(info.modificationTime) || info.modificationTime <= 0)) {
    info = await FileSystem.getInfoAsync(uri, { md5: true });
    if (!current() || ownedAudioUri(song) !== uri) throw new Error('Local audio owner changed');
    if (!info.exists || info.isDirectory || !Number.isFinite(info.size) || info.size <= 0) throw new Error('Local audio is unavailable');
  }
  const md5 = typeof info.md5 === 'string' && /^[a-f\d]{32}$/i.test(info.md5) ? info.md5.toLowerCase() : undefined;
  if ((digest || !Number.isFinite(info.modificationTime) || info.modificationTime <= 0) && !md5) throw new Error('The local file identity could not be verified');
  const modificationTime = Number.isFinite(info.modificationTime) && info.modificationTime > 0 ? info.modificationTime : undefined;
  const stamp = JSON.stringify([uri, info.size, modificationTime, md5, song.cueStartSec, song.cueEndSec]);
  return { uri, size: info.size, modificationTime, md5, stamp, key: hashKey(stamp) };
}
