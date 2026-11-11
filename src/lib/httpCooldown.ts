/** Shared, bounded admission and Retry-After state for read-only discovery requests. */
export class EndpointCooldownError extends Error {
  readonly retryAfterMs: number; readonly status: number;
  constructor(retryAfterMs: number, status = 429) {
    super(`Server requests are paused for ${Math.max(1, Math.ceil(retryAfterMs / 1000))} seconds`); this.retryAfterMs=retryAfterMs;this.status=status;this.name = 'EndpointCooldownError';
  }
}
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(7 * 86400_000, Math.ceil(seconds)) : undefined;
}
interface State { blockedUntil: number; status: number; active: number; waiters: number; touched: number; }
interface ResponseLike { body?: { cancel(): Promise<unknown> } | null; status: number; headers: { get(name: string): string | null | undefined }; }
export function createEndpointReader(options: { now?: () => number; wait?: (ms: number) => Promise<void> } = {}) {
  const states = new Map<string, State>(), now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const stateFor = (url: string, scope: string) => {
    const parsed = new URL(url); if (!/^https?:$/.test(parsed.protocol)) throw new Error('Unsupported discovery URL');
    const key = `${scope}|${parsed.origin}`; let state = states.get(key);
    if (!state) {
      for (const [old, entry] of states) if (!entry.active && !entry.waiters && entry.blockedUntil <= now()) states.delete(old);
      if (states.size >= 256) throw new Error('Too many active discovery hosts');
      state = { blockedUntil: 0, status: 429, active: 0, waiters: 0, touched: now() }; states.set(key, state);
    }
    return state;
  };
  return async function read<T extends ResponseLike>(url: string, request: () => Promise<T>, input: {
    scope?: string; signal?: AbortSignal; current?: () => boolean;
  } = {}): Promise<T> {
    const state = stateFor(url, input.scope ?? 'public');
    const checkOwner = () => {
      if (input.signal?.aborted || input.current && !input.current()) throw new Error('Discovery request canceled');
    };
    const check = () => {
      checkOwner();
      const delay = state.blockedUntil - now(); if (delay > 0) throw new EndpointCooldownError(delay, state.status);
    };
    check(); if (state.waiters >= 8) throw new Error('Discovery request queue is full');
    state.waiters++;
    try { while (state.active >= 3) { check(); await wait(50); } check(); state.active++; }
    finally { state.waiters--; }
    try {
      const response = await request();
      try { checkOwner(); } catch (error) { try { await response.body?.cancel(); } catch { /* Already consumed or closed. */ } throw error; }
      if (response.status === 429 || response.status === 503) {
        const delay = retryAfterMs(response.headers.get('retry-after'), now()) ?? 30_000;
        state.blockedUntil = Math.max(state.blockedUntil, now() + delay); state.status = response.status;
      }
      return response;
    } finally { state.active--; state.touched = now(); }
  };
}
export const readDiscoveryEndpoint = createEndpointReader();
