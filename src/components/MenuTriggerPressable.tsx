import { forwardRef, useCallback, useContext, useRef } from 'react';
import { Pressable, type PressableProps, type View } from 'react-native';

import { captureMenuTrigger, captureMenuTriggerActivation } from '@/lib/menuOrigin';
import { MenuTriggerGroupContext } from './MenuTriggerGroup';

/** Preserve the original button while giving a popup one exact native anchor.
 * Only an explicitly opted-in group may supply the separate whole-pill source;
 * this control remains the exact pressed/through geometry in either case. */
export const MenuTriggerPressable = forwardRef<View, PressableProps>(function MenuTriggerPressable({
  onPressIn, onPress, ...props
}, forwardedRef) {
  const host = useRef<View | null>(null);
  const group = useContext(MenuTriggerGroupContext);
  const setHost = useCallback((view: View | null) => {
    host.current = view;
    if (typeof forwardedRef === 'function') {
      // React 19 supports cleanup refs; retain compatibility with callers
      // whose type package still declares a void-returning callback ref.
      const cleanup: unknown = (forwardedRef as (instance: View | null) => unknown)(view);
      if (typeof cleanup === 'function') return () => { host.current = null; cleanup(); };
    } else if (forwardedRef) forwardedRef.current = view;
  }, [forwardedRef]);
  return <Pressable {...props} ref={setHost} collapsable={false}
    onPress={group ? (event) => {
      captureMenuTriggerActivation(event, host.current, group.current);
      onPress?.(event);
    } : onPress}
    onPressIn={(event) => {
      captureMenuTrigger(event, host.current, group?.current);
      onPressIn?.(event);
    }} />;
});
