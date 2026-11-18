/** Native button-to-menu motion, with the original sheet path as a fallback.
 * A native host owns frame timing and waits for its real window's first draw;
 * JavaScript only starts a transaction and acknowledges its completed exit. */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Dimensions, type LayoutChangeEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { isMenuMorphAvailable } from '../../modules/liquid-glass';
import { MenuMorphSession, type MenuMorphController, type MenuMorphEvent } from '@/lib/menuMorph';
import { takeMenuOrigin, type MenuOriginRect } from '@/lib/menuOrigin';
import { SHEET_IN, SHEET_OUT, motion } from '@/theme/motion';

const SCREEN_H = Dimensions.get('window').height;
const DISMISS_RATIO = 0.3;
const DISMISS_VELOCITY = 800;
const FALLBACK_SPRING = { damping: 22, stiffness: 260, mass: 1, reduceMotion: motion.reduceMotion.essential };
interface State { sessionId: number; open: boolean; ready: boolean; sourceRect: MenuOriginRect | null }

export function useBottomSheetAnim(open: boolean, onClose?: () => void, presentation: 'sheet' | 'card' = 'sheet', sessionKey?: unknown) {
  const isCard = presentation === 'card';
  const native = isCard && isMenuMorphAvailable;
  const [session] = useState(() => new MenuMorphSession());
  const [state, setState] = useState<State>({ sessionId: 0, open: false, ready: false, sourceRect: null });
  const stateRef = useRef(state);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);
  const progress = useSharedValue(0);
  const dismissing = useSharedValue(false);
  const sheetH = useSharedValue(SCREEN_H);
  const update = useCallback((next: State) => { stateRef.current = next; setState(next); }, []);

  const complete = useCallback((id: number, expanded: boolean) => {
    if (id !== session.id) return;
    if (session.complete(id, expanded)) {
      progress.value = expanded ? 1 : 0;
      dismissing.value = false;
    }
  }, [session, progress, dismissing]);

  useLayoutEffect(() => {
    cancelAnimation(progress);
    dismissing.value = false;
    if (open) {
      const id = session.begin();
      // The native host already waits for attachment, pre-draw, a visible
      // window and measured children. Authorize that first valid draw in this
      // same transaction instead of making it await a JS onShow/layout reply.
      // Callers with a natural-height dependency still override motion.ready.
      update({ sessionId: id, open: true, ready: native, sourceRect: takeMenuOrigin() });
      progress.value = 0;
      if (!native) {
        const settled = (finished?: boolean) => { 'worklet'; if (finished) scheduleOnRN(complete, id, true); };
        progress.value = isCard ? withSpring(1, FALLBACK_SPRING, settled) : withTiming(1, SHEET_IN, settled);
      }
    } else {
      session.invalidate();
      update({ sessionId: session.id, open: false, ready: false, sourceRect: null });
      progress.value = 0;
    }
    return () => { session.invalidate(); cancelAnimation(progress); };
  }, [open, sessionKey, native, isCard, session, update, progress, dismissing, complete]);

  const dismiss = useCallback((after?: unknown) => {
    const callback = typeof after === 'function' ? after as () => void : closeRef.current;
    if (!session.close(callback)) return;
    const id = session.id;
    dismissing.value = true;
    // Keep the same geometry/exact source tag and presentation identity for
    // native close retargeting. A menu-row touch must not become its new source.
    update({ ...stateRef.current, open: false, ready: true });
    if (!native) {
      progress.value = withTiming(0, { ...SHEET_OUT, duration: isCard ? 180 : SHEET_OUT.duration }, (finished) => {
        if (finished) scheduleOnRN(complete, id, false);
      });
    }
  }, [session, dismissing, update, native, progress, isCard, complete]);

  const ready = useCallback(() => {
    const current = stateRef.current;
    if (current.sessionId === session.id && session.phase !== 'closed' && !current.ready)
      update({ ...current, ready: true });
  }, [session, update]);
  const onMotionStart = useCallback((event: MenuMorphEvent) => {
    const { sessionId: id, open: expanded } = event.nativeEvent;
    if (id !== session.id || expanded !== stateRef.current.open) return;
    progress.value = withTiming(expanded ? 1 : 0, { ...(expanded ? SHEET_IN : SHEET_OUT), duration: expanded ? 220 : 180 });
  }, [session, progress]);
  const onMotionComplete = useCallback((event: MenuMorphEvent) => {
    complete(event.nativeEvent.sessionId, event.nativeEvent.open);
  }, [complete]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => native ? {} : isCard ? {
    opacity: progress.value,
    transformOrigin: 'right top',
    transform: [{ translateY: (1 - progress.value) * -14 }, { scale: 0.72 + progress.value * 0.28 }],
  } : { transform: [{ translateY: (1 - progress.value) * sheetH.value }] }, [native, isCard]);
  const onSheetLayout = useCallback((event: LayoutChangeEvent) => {
    sheetH.value = event.nativeEvent.layout.height;
    ready();
  }, [sheetH, ready]);

  const makePan = () => Gesture.Pan()
    .enabled(!isCard)
    .activeOffsetY(10)
    .failOffsetY(-10)
    .onUpdate((event) => {
      if (dismissing.value) return;
      progress.value = Math.min(1, Math.max(0, 1 - event.translationY / sheetH.value));
    })
    .onEnd((event) => {
      if (dismissing.value) return;
      const closes = event.translationY > sheetH.value * DISMISS_RATIO || event.velocityY > DISMISS_VELOCITY;
      if (closes && onClose) scheduleOnRN(dismiss);
      else progress.value = withTiming(1, SHEET_IN);
    });
  const controller: MenuMorphController = { ...state, fallbackStyle: sheetStyle, onMotionStart, onMotionComplete, onLayoutReady: ready };
  return { dismiss, dismissing, pan: makePan(), makePan, backdropStyle, sheetStyle, onSheetLayout,
    motion: controller, onModalShow: ready };
}
