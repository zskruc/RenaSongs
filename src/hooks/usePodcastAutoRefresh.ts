import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { refreshStaleFavoriteShows } from '@/api/podcasts';
import { profileScopeId, useAuthStore } from '@/store/auth';

/** Feed checks yield to cold-start navigation/queue restoration, and stop when
 * the app leaves the foreground. The API owns due times and duplicate callers. */
export function usePodcastAutoRefresh(enabled = true): void {
  const auth = useAuthStore((state) => state.auth), profile = profileScopeId();
  const [epoch, setEpoch] = useState(0);
  useEffect(() => useAuthStore.subscribe((next, previous) => {
    if (next.auth !== previous.auth || next.offline !== previous.offline || next.autoOffline !== previous.autoOffline
      || next.offlineSource !== previous.offlineSource) setEpoch((value) => value + 1);
  }), []);
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | undefined;
    const check = () => {
      if (AppState.currentState !== 'active') return;
      controller ??= new AbortController();
      void refreshStaleFavoriteShows({ signal: controller.signal, expectedProfile: profile,
        current: () => auth === useAuthStore.getState().auth && profile === profileScopeId()
          && AppState.currentState === 'active' }).catch(() => {});
    };
    const first = setTimeout(check, 4000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
      else { controller?.abort(); controller = undefined; }
    });
    return () => { clearTimeout(first); controller?.abort(); subscription.remove(); };
  }, [enabled, auth, profile, epoch]);
}
