/** One short-lived, screen-coordinate origin. No views, events or timers live here. */
export type MenuOriginRect = readonly [x: number, y: number, width: number, height: number, radius: number];
export type MenuOriginPoint = { x: number; y: number };

const TOUCH_SIDE = 44;
const ORIGIN_TTL_MS = 1200;
const SCROLL_SLOP = 12;
const MAX_SOURCE_SIDE = 640;

function validPoint(point: MenuOriginPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && Math.abs(point.x) < 100_000 && Math.abs(point.y) < 100_000;
}

function measuredRect(value: unknown, point: MenuOriginPoint): MenuOriginRect | null {
  if (!Array.isArray(value) || value.length < 4 || !value.slice(0, 4).every(Number.isFinite)) return null;
  const [x, y, width, height] = value as number[];
  if (width <= 0 || height <= 0 || width > MAX_SOURCE_SIDE || height > MAX_SOURCE_SIDE) return null;
  // A stale/recycled view or a whole-screen responder is not the pressed button.
  // The margin also covers platform rounding and the fallback window inset.
  if (point.x < x - 32 || point.x > x + width + 32 || point.y < y - 32 || point.y > y + height + 32) return null;
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
  let pending: { sequence: number; at: number; point: MenuOriginPoint; rect: MenuOriginRect } | null = null;
  const clear = () => { sequence++; pending = null; };
  const fresh = () => pending !== null && now() >= pending.at && now() - pending.at <= ORIGIN_TTL_MS;
  return {
    clear,
    start(point: MenuOriginPoint, tag?: number): void {
      clear();
      if (!validPoint(point)) return;
      const own = ++sequence;
      pending = { sequence: own, at: now(), point: { ...point },
        rect: [point.x - TOUCH_SIDE / 2, point.y - TOUCH_SIDE / 2, TOUCH_SIDE, TOUCH_SIDE, TOUCH_SIDE / 2] };
      if (!Number.isInteger(tag) || tag! <= 0) return;
      // Native promises and even synchronous transport failures are contained.
      // The closure retains plain geometry only, never the event or its target.
      void Promise.resolve().then(() => measure(tag!)).then((value) => {
        if (!pending || pending.sequence !== own || !fresh()) return;
        const rect = measuredRect(value, pending.point);
        if (rect) pending.rect = rect;
      }).catch(() => {});
    },
    move(point: MenuOriginPoint): void {
      if (!pending) return;
      if (!validPoint(point) || !fresh() || Math.hypot(point.x - pending.point.x, point.y - pending.point.y) > SCROLL_SLOP) clear();
    },
    take(): MenuOriginRect | null {
      const rect = fresh() ? pending!.rect : null;
      clear();
      return rect ? [...rect] as MenuOriginRect : null;
    },
  };
}
