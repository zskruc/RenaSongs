import { forwardRef, useCallback, useRef } from 'react';
import { Pressable, type PressableProps, type View } from 'react-native';

import { captureMenuTrigger } from '@/lib/menuOrigin';

/** Preserve the original button while giving a popup one exact native anchor.
 * A shared toolbar or the touched icon must never stand in for this control. */
export const MenuTriggerPressable = forwardRef<View, PressableProps>(function MenuTriggerPressable({
  onPressIn, ...props
}, forwardedRef) {
  const host = useRef<View | null>(null);
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
    onPressIn={(event) => {
      captureMenuTrigger(event, host.current);
      onPressIn?.(event);
    }} />;
});
