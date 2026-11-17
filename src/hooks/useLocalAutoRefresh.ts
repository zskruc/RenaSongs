/** Low frequency local-folder discovery, started only after app restoration. */
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { refreshLocal } from '@/api/data';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/store/toast';

const BOOT_DELAY_MS = 4000;
export function useLocalAutoRefresh(enabled = true): void {
  const auth = useAuthStore((s) => s.auth);
  const offline = useAuthStore((s) => s.offline);
  const source = useAuthStore((s) => s.offlineSource);
  const hydrating = useAuthStore((s) => s.hydrating);
  const t = useT();
  const toast = useToast((s) => s.show);
  useEffect(() => {
    if (!enabled || hydrating || auth || !offline || !source) return;
    let alive = true;
    const current = () => {
      const state = useAuthStore.getState();
      return alive && AppState.currentState === 'active' && !state.auth && state.offline && state.offlineSource === source;
    };
    const check = () => {
      if (!current()) return;
      void refreshLocal().then((changed) => { if (changed && current()) toast(t('Library updated')); }).catch(() => {});
    };
    const first = setTimeout(check, BOOT_DELAY_MS);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => { alive = false; clearTimeout(first); sub.remove(); };
  }, [enabled, hydrating, auth, offline, source, t, toast]);
}
