import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { useBottomSheetAnim } from './useBottomSheetAnim';

/** Controlled popup presence outlives `visible` until its native exit finishes. */
export function usePopupMorphPresence(visible: boolean, identity?: unknown) {
  const [presence, setPresence] = useState({ mounted: visible, session: visible ? 1 : 0 });
  const transaction = useRef({ ...presence, closing: false });
  const previous = useRef({ visible, identity });
  const alive = useRef(true);
  const animation = useBottomSheetAnim(presence.mounted, undefined, 'card', presence.session);
  const animationRef = useRef(animation);
  useLayoutEffect(() => { animationRef.current = animation; });

  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const close = useCallback((after?: unknown) => {
    const current = transaction.current;
    if (!alive.current || !current.mounted || current.closing) return;
    current.closing = true;
    const session = current.session;
    animationRef.current.dismiss(() => {
      // A replaced dialog, an unmount or a second native completion must not
      // apply an action to the next popup (or to the next selected song).
      const latest = transaction.current;
      if (!alive.current || !latest.mounted || !latest.closing || latest.session !== session) return;
      latest.mounted = false;
      latest.closing = false;
      setPresence({ mounted: false, session });
      if (typeof after === 'function') after();
    });
  }, []);

  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = { visible, identity };
    if (visible && (!last.visible || !Object.is(last.identity, identity))) {
      const session = transaction.current.session + 1;
      transaction.current = { mounted: true, session, closing: false };
      setPresence({ mounted: true, session });
    } else if (!visible && last.visible) {
      // The owner already cancelled/replaced the popup: animate out without
      // delivering onCancel again. Keep its existing native window attached.
      close();
    }
  }, [visible, identity, close]);

  return { ...presence, animation, close };
}
