import { fetch } from 'expo/fetch';
import type { Song, SongLyrics } from '@/api/subsonic';
import { isManualOffline } from '@/api/netGate';
import { useAuthStore, profileScopeId } from '@/store/auth';
import { hashKey } from './localLibrary';
import { captureLyricOwner } from './lyricOwner';
import { getEpisode, readPodcastTranscript, savePodcastTranscript } from './podcastDb';
import { parsePodcastTranscript, preferredPodcastTranscripts } from './podcastTranscript';
import { readDiscoveryEndpoint } from './httpCooldown';
import { protectPodcastStorageChannel } from './podcastStorageLease';
const pending = new Map<string, Promise<SongLyrics | null>>();
export async function publisherTranscript(song: Song, current: () => boolean): Promise<SongLyrics | null> {
  const profile = profileScopeId(), scope = hashKey(profile), owns = captureLyricOwner(profile);
  const valid = () => current() && owns() && profileScopeId() === profile;
  const check = () => { if (!valid()) throw new Error('Transcript profile changed'); };
  check(); const episode = await getEpisode(scope, song.id); check();
  if (!episode?.transcripts?.length || episode.channelId !== song.podcastChannelId) return null;
  const choices = preferredPodcastTranscripts(episode.transcripts);
  for (const entry of choices) {
    const cached = await readPodcastTranscript(scope, song.id, entry.url, valid); check();
    if (cached) return JSON.parse(cached) as SongLyrics;
  }
  if (isManualOffline() || useAuthStore.getState().offline) return null;
  const key = JSON.stringify([profile, song.id, choices.map((item) => item.url)]);
  const previous = pending.get(key); if (previous) { const value = await previous; check(); return value; }
  if (pending.size >= 3) throw new Error('Transcript requests are busy');
  const work = (async () => {
    const release = protectPodcastStorageChannel(scope, episode.channelId);
    try {
      for (const entry of choices.slice(0, 3)) {
        check(); const controller = new AbortController();
        const loadCurrent = () => valid() && !controller.signal.aborted;
        const checkLoad = () => { if (!loadCurrent()) throw new Error('Publisher transcript request canceled'); };
        let stop!: (reason: Error) => void;
        const deadline = new Promise<never>((_, reject) => { stop = reject; });
        const timer = setTimeout(() => { controller.abort(); stop(new Error('Publisher transcript timed out')); }, 15_000);
        try {
          const load = async () => {
            const response = await readDiscoveryEndpoint(entry.url, () => fetch(entry.url, { signal: controller.signal, credentials: 'omit', headers: { accept: 'text/vtt, application/srt, application/json, text/plain' } }), { scope: profile, signal: controller.signal, current: loadCurrent });
            checkLoad(); if (!response.ok) throw new Error('Could not load publisher transcript');
            if (Number(response.headers.get('content-length')) > 1_500_000) throw new Error('Publisher transcript is too large');
            let body = '';
            if (response.body) {
              const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0;
              const cancel = () => { void reader.cancel().catch(() => {}); };
              controller.signal.addEventListener('abort', cancel, { once: true });
              try { checkLoad(); while (true) { const chunk = await reader.read(); checkLoad(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 1_500_000) throw new Error('Publisher transcript is too large'); body += decoder.decode(chunk.value, { stream: true }); } body += decoder.decode(); }
              finally { controller.signal.removeEventListener('abort', cancel); cancel(); try { reader.releaseLock(); } catch { /* Native may still be completing an aborted read. */ } }
            } else { body = await response.text(); if (body.length > 1_500_000) throw new Error('Publisher transcript is too large'); }
            checkLoad(); const lyrics = parsePodcastTranscript(body, entry.type); if (!lyrics.lines.length) throw new Error('Publisher transcript is empty');
            await savePodcastTranscript(scope, song.id, episode.channelId, entry.url, JSON.stringify(lyrics), loadCurrent); checkLoad(); return lyrics;
          };
          return await Promise.race([load(), deadline]);
        } catch (error) { check(); if (entry === choices[Math.min(2, choices.length - 1)]) throw error; }
        finally { clearTimeout(timer); controller.abort(); }
      }
      return null;
    } finally { release(); }
  })();
  pending.set(key, work);
  try { const value = await work; check(); return value; } finally { if (pending.get(key) === work) pending.delete(key); }
}
