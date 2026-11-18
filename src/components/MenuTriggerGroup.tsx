import { createContext, forwardRef, useCallback, useRef, type RefObject } from 'react';
import { type View, type ViewProps } from 'react-native';

import { isMenuTriggerGroupAvailable, MenuTriggerGroupView } from '../../modules/liquid-glass';

/** Explicit opt-in only. A generic responder/toolbar ancestor is never promoted
 * into a source group by measurement or by inspecting the touched descendant. */
export const MenuTriggerGroupContext = createContext<RefObject<View | null> | null>(null);

/** Same physical toolbar layout, with one native foreground/press owner. */
export const MenuTriggerGroup = forwardRef<View, ViewProps>(function MenuTriggerGroup(props, forwardedRef) {
  const host = useRef<View | null>(null);
  const setHost = useCallback((view: View | null) => {
    host.current = view;
    if (typeof forwardedRef === 'function') {
      const cleanup: unknown = (forwardedRef as (instance: View | null) => unknown)(view);
      if (typeof cleanup === 'function') return () => { host.current = null; cleanup(); };
    } else if (forwardedRef) forwardedRef.current = view;
  }, [forwardedRef]);
  return <MenuTriggerGroupContext.Provider value={isMenuTriggerGroupAvailable ? host : null}>
    <MenuTriggerGroupView {...props} ref={setHost} collapsable={false} />
  </MenuTriggerGroupContext.Provider>;
});
