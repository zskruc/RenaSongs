import { findNodeHandle, UIManager, type GestureResponderEvent } from 'react-native';

import { measureNativeMenuOrigin } from '../../modules/liquid-glass';
import { createMenuOriginTracker, type MenuOriginPoint } from './menuOriginState';

export type { MenuOriginRect } from './menuOriginState';

/** Android returns true screen coordinates across Activity/Dialog windows.
 * Other platforms can still use RN measurement, with a bounded callback wait. */
async function measure(tag: number): Promise<unknown> {
  if (measureNativeMenuOrigin) {
    const rect = await measureNativeMenuOrigin(tag);
    if (rect) return rect;
  }
  if (!UIManager?.measureInWindow) return null;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 200);
    try {
      UIManager.measureInWindow(tag, (x, y, width, height) => {
        clearTimeout(timeout); resolve([x, y, width, height]);
      });
    } catch { clearTimeout(timeout); resolve(null); }
  });
}

const tracker = createMenuOriginTracker(measure);

function point(event: GestureResponderEvent): MenuOriginPoint | null {
  const native = event?.nativeEvent;
  // Keyboard/accessibility/programmatic activation has no active touch. It
  // must not borrow an unrelated earlier pointer origin.
  if (!native || native.touches?.length > 1) return null;
  // Pressability can deliver a very short press-in using the release event.
  // Its changed touch is real even though no touches remain down.
  if (native.touches?.length === 0 && native.changedTouches?.length !== 1) return null;
  const x = native.pageX, y = native.pageY;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function tagOf(target: unknown): number | undefined {
  if (typeof target === 'number') return Number.isInteger(target) && target > 0 ? target : undefined;
  if (!target || typeof target !== 'object') return undefined;
  try {
    const tag = findNodeHandle(target as Parameters<typeof findNodeHandle>[0]);
    return typeof tag === 'number' && tag > 0 ? tag : undefined;
  } catch { return undefined; }
}

/** Root capture targets the touched descendant, never the full-screen root. */
export function captureMenuTouchStart(event: GestureResponderEvent): void {
  const at = point(event);
  if (!at) { tracker.clear(); return; }
  tracker.start(at, tagOf(event.nativeEvent.target));
}

export function captureMenuTouchMove(event: GestureResponderEvent): void {
  const at = point(event);
  if (!at) { tracker.clear(); return; }
  tracker.move(at);
}

/** A control's own press-in can promote the descendant measurement to the
 * complete button. Only an explicit ref authorizes native trigger capture;
 * currentTarget/target fallbacks supply geometry without hiding a shared row. */
export function captureMenuTrigger(event: GestureResponderEvent, target?: unknown, explicitGroup?: unknown): void {
  const at = point(event);
  if (!at) { tracker.clear(); return; }
  const sourceTag = tagOf(target);
  tracker.start(at, sourceTag ?? tagOf(event.currentTarget) ?? tagOf(event.nativeEvent.target),
    sourceTag !== undefined, sourceTag === undefined ? undefined : tagOf(explicitGroup));
}

/** Refresh a declared group's identity on the actual activation, not only
 * press-in: a long held press may outlive the pointer TTL. Keyboard/a11y may
 * use these exact refs, but cannot promote an implicit responder or old touch. */
export function captureMenuTriggerActivation(event: GestureResponderEvent, target: unknown, explicitGroup: unknown): void {
  const buttonTag = tagOf(target), groupTag = tagOf(explicitGroup);
  const native = event?.nativeEvent;
  if (!buttonTag || !groupTag || native?.touches?.length > 1 || native?.changedTouches?.length > 1) {
    tracker.clear(); return;
  }
  const at = point(event);
  if (at) tracker.start(at, buttonTag, true, groupTag);
  else if (!native?.touches?.length && !native?.changedTouches?.length) tracker.activate(buttonTag, groupTag);
  else tracker.clear(); // Malformed pointer data is not a keyboard activation.
}

export const takeMenuOrigin = () => tracker.take();
export const clearMenuOrigin = () => tracker.clear();
