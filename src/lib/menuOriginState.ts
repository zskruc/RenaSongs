/** One short-lived, screen-coordinate origin. No views, events or timers live here. */
/** The first five entries remain geometry-only. Only a control's explicit
 * native ref may authorize capture/hiding through the optional sixth tag. An
 * explicit native group adds a seventh tag; first-five geometry stays the
 * pressed button's through rect, never the group's whole-pill source rect. */
export type MenuOriginRect =
  | readonly [x: number, y: number, width: number, height: number, radius: number]
  | readonly [x: number, y: number, width: number, height: number, radius: number, sourceTag: number]
  | readonly [x: number, y: number, width: number, height: number, radius: number, sourceTag: number, groupTag: number];
export type MenuOriginPoint = { x: number; y: number };

const TOUCH_SIDE = 44;
const ORIGIN_TTL_MS = 1200;
const SCROLL_SLOP = 12;
const MAX_SOURCE_SIDE = 640;

function validPoint(point: MenuOriginPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && Math.abs(point.x) < 100_000 && Math.abs(point.y) < 100_000;
}

function measuredRect(value: unknown, point: MenuOriginPoint | null): MenuOriginRect | null {
  if (!Array.isArray(value) || value.length < 4 || !value.slice(0, 4).every(Number.isFinite)) return null;
  const [x, y, width, height] = value as number[];
  if (width <= 0 || height <= 0 || width > MAX_SOURCE_SIDE || height > MAX_SOURCE_SIDE) return null;
  // A stale/recycled view or a whole-screen responder is not the pressed button.
  // The margin also covers platform rounding and the fallback window inset.
  if (point && (point.x < x - 32 || point.x > x + width + 32 || point.y < y - 32 || point.y > y + height + 32)) return null;
  const w = Math.max(width, TOUCH_SIDE), h = Math.max(height, TOUCH_SIDE);
  const radius = Number.isFinite(value[4]) && value[4] > 0 ? value[4] as number : Math.min(w, h) / 2;
  return [x + (width - w) / 2, y + (height - h) / 2, w, h, Math.min(radius, w / 2, h / 2)];
}

/** Native measurement may finish late. A consumed, moved or superseded press
 * cannot publish back into a newer menu session. Opening never awaits it. */
export function createMenuOriginTracker(
  measure: (tag: number) => Promise<unknown>,
  now = () => Date.now(),
) {
  let sequence = 0;
  let pending: { sequence: number; at: number; point: MenuOriginPoint | null; rect: MenuOriginRect } | null = null;
  const clear = () => { sequence++; pending = null; };
  const fresh = () => pending !== null && now() >= pending.at && now() - pending.at <= ORIGIN_TTL_MS;
  return {
    clear,
    start(point: MenuOriginPoint, tag?: number, explicitSource = false, explicitGroupTag?: number): void {
      clear();
      if (!validPoint(point)) return;
      const own = ++sequence;
      const validTag = Number.isSafeInteger(tag) && tag! > 0;
      const sourceTag = explicitSource && validTag ? tag : undefined;
      const groupTag = sourceTag !== undefined && Number.isSafeInteger(explicitGroupTag)
        && explicitGroupTag! > 0 && explicitGroupTag! <= 0x7fffffff && explicitGroupTag !== sourceTag
        ? explicitGroupTag : undefined;
      const identify = (rect: MenuOriginRect): MenuOriginRect => sourceTag === undefined ? rect : groupTag === undefined
        ? [rect[0], rect[1], rect[2], rect[3], rect[4], sourceTag]
        : [rect[0], rect[1], rect[2], rect[3], rect[4], sourceTag, groupTag];
      const seed: MenuOriginRect = [point.x - TOUCH_SIDE / 2, point.y - TOUCH_SIDE / 2, TOUCH_SIDE, TOUCH_SIDE, TOUCH_SIDE / 2];
      pending = { sequence: own, at: now(), point: { ...point },
        rect: identify(seed) };
      if (!validTag) return;
      // Native promises and even synchronous transport failures are contained.
      // The closure retains plain geometry only, never the event or its target.
      void Promise.resolve().then(() => measure(tag!)).then((value) => {
        if (!pending || pending.sequence !== own || !fresh()) return;
        const rect = measuredRect(value, pending.point);
        // A measurement may improve geometry, never change which explicit
        // button this press owns (nor promote a generic descendant to one).
        if (rect) pending.rect = identify(rect);
      }).catch(() => {});
    },
    /** A real onPress/a11y activation explicitly identifies both native owners.
     * No earlier pointer origin is borrowed; native resolves exact geometry
     * synchronously even when keyboard activation has no screen coordinates. */
    activate(tag: number, groupTag: number): void {
      clear();
      if (!Number.isSafeInteger(tag) || tag <= 0 || tag > 0x7fffffff ||
        !Number.isSafeInteger(groupTag) || groupTag <= 0 || groupTag > 0x7fffffff || tag === groupTag) return;
      const own = ++sequence;
      pending = { sequence: own, at: now(), point: null, rect: [0, 0, TOUCH_SIDE, TOUCH_SIDE, TOUCH_SIDE / 2, tag, groupTag] };
      void Promise.resolve().then(() => measure(tag)).then((value) => {
        if (!pending || pending.sequence !== own || !fresh()) return;
        const rect = measuredRect(value, null);
        if (rect) pending.rect = [rect[0], rect[1], rect[2], rect[3], rect[4], tag, groupTag];
      }).catch(() => {});
    },
    move(point: MenuOriginPoint): void {
      if (!pending) return;
      if (!pending.point || !validPoint(point) || !fresh() || Math.hypot(point.x - pending.point.x, point.y - pending.point.y) > SCROLL_SLOP) clear();
    },
    take(): MenuOriginRect | null {
      const rect = fresh() ? pending!.rect : null;
      clear();
      return rect ? [...rect] as MenuOriginRect : null;
    },
  };
}
