import { useSyncExternalStore } from 'react';

import { menuPresentations } from '@/lib/menuPresentation';

const serverSnapshot = () => false;

/** Pause covered decorative clocks without replacing their mounted UI. */
export function useMenuPresentationActive(): boolean {
  return useSyncExternalStore(menuPresentations.subscribe, menuPresentations.getSnapshot, serverSnapshot);
}
