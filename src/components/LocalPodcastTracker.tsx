import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { Song } from '@/api/subsonic';
import { getSongContentKind } from '@/lib/currentContentKind';
import { episodePlayed } from '@/lib/episodeResume';
import { captureCustomizationOwner, customizationScope } from '@/lib/localCustomizations';
import { localPodcastProgressVersion, saveLocalPodcastProgress } from '@/store/localPodcasts';
import { longAudioPlaybackSample, usePlayerStore } from '@/store/player';
/** Event-driven only; no timer, network or work for ordinary music/RSS. */
export function LocalPodcastTracker() {
  useEffect(() => {
    let last: { song: Song; queue: Song[]; index: number; position: number; duration: number; version: number; current: () => boolean } | undefined;
    let savedAt = 0, savedPosition = -1;
    const flush = () => {
      const entry = last; if (!entry || !entry.current() || entry.version !== localPodcastProgressVersion(entry.song.id) || entry.position <= 0 && savedPosition < 0 || Math.abs(entry.position - savedPosition) < 0.01) return;
      savedAt = Date.now(); savedPosition = entry.position;
      void saveLocalPodcastProgress(entry.song.id, { positionSec: entry.position, durationSec: entry.duration, played: episodePlayed(entry.position, entry.duration), updatedAt: savedAt }, entry.version).catch(() => { savedPosition = -1; });
    };
    const sample = () => {
      const state = usePlayerStore.getState(), accepted = longAudioPlaybackSample(), song = accepted?.song;
      if (!accepted || !song || song.podcastChannelId || getSongContentKind(song) !== 'podcast') { flush(); last = undefined; return; }
      if (!last || last.song.id !== song.id || last.queue !== state.queue || last.index !== state.index || !last.current()) {
        flush(); last = { song, queue: state.queue, index: state.index, position: accepted.position, duration: accepted.duration || song.duration || 0, version: localPodcastProgressVersion(song.id), current: captureCustomizationOwner(customizationScope()) }; savedAt = 0; savedPosition = -1;
      } else { last.position = state.positionSec; last.duration = state.durationSec || song.duration || 0; }
      if (!state.isBuffering && (!state.isPlaying || savedPosition < 0 && state.positionSec > 0 || Date.now() - savedAt >= 15_000 || Math.abs(state.positionSec - savedPosition) > 30)) flush();
    };
    const unsubscribe = usePlayerStore.subscribe(sample), app = AppState.addEventListener('change', (state) => { if (state !== 'active') flush(); }); sample();
    return () => { flush(); unsubscribe(); app.remove(); };
  }, []); return null;
}
