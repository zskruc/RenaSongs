import { usePathname } from 'expo-router';
import { useLayoutEffect } from 'react';
import { AppState } from 'react-native';

import { clearMenuOrigin } from '@/lib/menuOrigin';
import { profileScopeId, useAuthStore } from '@/store/auth';

/** Isolate route subscriptions from the root provider tree. A pointer belongs
 * only to the current foreground page/account, never the next navigation. */
export function MenuOriginBoundary() {
  const path = usePathname();
  const profile = useAuthStore(() => profileScopeId());
  useLayoutEffect(() => { clearMenuOrigin(); }, [path, profile]);
  useLayoutEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') clearMenuOrigin();
    });
    return () => { subscription.remove(); clearMenuOrigin(); };
  }, []);
  return null;
}
