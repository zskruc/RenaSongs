import { tg } from '@/i18n';
import { profileScopeId, useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { usePodcastDownloads } from '@/store/podcastDownloads';
import { useToast } from '@/store/toast';

let accountEpoch = 0;
useAuthStore.subscribe((state, previous) => {
  if (state.auth !== previous.auth || state.offlineSource !== previous.offlineSource) accountEpoch++;
});

type Undo = { label: string; run: () => void };

/** User feedback belongs to the account that accepted the action, including
 * Undo. Counts are unique removed catalog records, not measured disk bytes. */
async function removeWithFeedback(remove: () => Promise<number>, kind: 'songs' | 'episodes', undo?: Undo): Promise<void> {
  const auth = useAuthStore.getState().auth, epoch = accountEpoch, profile = profileScopeId();
  const current = () => auth === useAuthStore.getState().auth && epoch === accountEpoch && profile === profileScopeId();
  try {
    const count = await remove();
    if (!current()) return;
    const action = count > 0 && undo ? { label: undo.label, run: () => { if (current()) undo.run(); } } : undefined;
    useToast.getState().show(count === 0 ? tg('Nothing here is downloaded')
      : undo ? tg('Download removed')
      : kind === 'songs' ? tg('{n} songs deleted', { n: count }) : tg('{n} episodes deleted', { n: count }), action);
  } catch {
    if (current()) useToast.getState().show(tg("Couldn't complete the action"));
  }
}

export function removeSongDownloads(ids: string[], undo?: Undo): Promise<void> {
  return removeWithFeedback(() => useDownloads.getState().deleteSongs(ids), 'songs', undo);
}

export function removeEpisodeDownloads(ids: string[]): Promise<void> {
  return removeWithFeedback(() => usePodcastDownloads.getState().deleteEpisodes(ids), 'episodes');
}
