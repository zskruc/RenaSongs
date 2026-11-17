/**
 * The server plays through its own speakers/DAC; the phone is a remote. Hand it
 * the current item and up to 20 following unique server tracks so it can advance
 * while Android suspends JS. More tracks require the app to run and refill that
 * bounded window; repeat-one and end-of-song timers deliberately hand over none.
 */
import { create } from 'zustand';

import type { Song } from '@/api/backend';
import {
  hasJukeboxRole, jukeboxAdd, jukeboxGet, jukeboxRemove, jukeboxSet, jukeboxSetGain,
  jukeboxSkip, jukeboxStart, jukeboxStatus, jukeboxStop, type JukeboxStatus, type SubsonicAuth,
} from '@/api/subsonic';
import { jukeboxTailPrefix, jukeboxUpcoming, playableOnJukebox, type JukeboxEntry } from '@/lib/jukeboxQueue';
import { useAuthStore } from './auth';
import type { RemoteEvents } from './upnp';

interface JukeboxStoreState { active: boolean; available: boolean }
export const useJukebox = create<JukeboxStoreState>(() => ({ active: false, available: false }));
const POLL_MS = 1000;
let events: RemoteEvents | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastPositionSec = 0, lastDurationSec = 0;
let finishedFired = false, loading = false, intendedPlaying = false;
let lastPlaying: boolean | null = null;
let serverEntries: JukeboxEntry[] = [], serverIndex = 0;
let session = 0, load = 0, revision = 0;
let sessionOwner: SubsonicAuth | null = null;
let needsQueueRead = false, retryAfter = 0;
// Commands are ordered: a stale Set response must never be followed by an old
// Start/Skip after a newer load has already installed its own playlist.
let commands: Promise<unknown> = Promise.resolve();
function command<T>(run: () => Promise<T>): Promise<T> {
  const result = commands.then(run);
  commands = result.catch(() => {});
  return result;
}
interface Owner { auth: SubsonicAuth; session: number; load: number }
interface SyncRequest { owner: Owner; current: Song; upcoming: Song[]; currentIndex: number }
let pendingSync: SyncRequest | null = null;
let syncing: Promise<void> | null = null;
let polling: { owner: Owner; revision: number; work: Promise<void> } | null = null;

export function isJukeboxActive(): boolean { return useJukebox.getState().active; }
export function initJukebox(ev: RemoteEvents): void { events = ev; }
function auth(): SubsonicAuth | null {
  const a = useAuthStore.getState().auth;
  return a && a.serverType !== 'jellyfin' ? a : null;
}
function owner(): Owner | null {
  const a = auth();
  return a && a === sessionOwner && isJukeboxActive() ? { auth: a, session, load } : null;
}
function owns(ticket: Owner, includeLoad = true): boolean {
  return ticket.auth === auth() && ticket.auth === sessionOwner && ticket.session === session
    && (!includeLoad || ticket.load === load) && isJukeboxActive();
}
function invalidate(): void {
  session++; load++; revision++;
  pendingSync = null; loading = false; needsQueueRead = false;
  serverEntries = []; serverIndex = 0; sessionOwner = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  useJukebox.setState({ active: false });
}
useAuthStore.subscribe((state, previous) => {
  if (state.auth !== previous.auth) {
    invalidate();
    useJukebox.setState({ available: false });
  }
});

export async function refreshJukeboxAvailability(): Promise<void> {
  const a = auth();
  if (!a) { useJukebox.setState({ available: false }); return; }
  const askedSession = session;
  const available = await hasJukeboxRole(a);
  if (auth() === a && session === askedSession) useJukebox.setState({ available });
}

/** Publishes a server advance once, including the correct duplicate occurrence. */
function followIndex(status: JukeboxStatus, ticket: Owner): boolean {
  const next = status.currentIndex;
  if (!Number.isInteger(next) || next < 0 || next >= serverEntries.length) return false;
  const entry = serverEntries[next];
  if (next !== serverIndex) {
    serverIndex = next; finishedFired = false;
    lastPositionSec = status.position; lastDurationSec = entry.song.duration ?? 0;
    events?.onTrackChanged(entry.queueIndex, status.position, lastDurationSec, entry.song.id);
  }
  return owns(ticket);
}
function poll(): Promise<void> {
  const ticket = owner();
  if (!ticket || loading) return Promise.resolve();
  if (polling && polling.owner.session === ticket.session && polling.owner.load === ticket.load
    && polling.revision === revision) return polling.work;
  const askedRevision = revision;
  const job = { owner: ticket, revision: askedRevision, work: Promise.resolve() };
  polling = job;
  job.work = (async () => {
    if (pendingSync && Date.now() >= retryAfter) await drainSync();
    if (!owns(ticket) || loading || needsQueueRead || syncing) return;
    const readRevision = revision;
    job.revision = readRevision;
    let status: JukeboxStatus;
    try { status = await jukeboxStatus(ticket.auth); } catch { return; }
    if (!owns(ticket) || readRevision !== revision || loading || syncing || !followIndex(status, ticket)) return;
    const pos = Number.isFinite(status.position) ? Math.max(0, status.position) : 0;
    if (pos > 0) lastPositionSec = pos;
    if (status.playing) {
      finishedFired = false;
      events?.onProgress(pos, lastDurationSec);
      if (!owns(ticket)) return;
      if (lastPlaying !== true) { lastPlaying = true; events?.onPlayingChanged(true, false); }
      return;
    }
    const atEnd = intendedPlaying && lastDurationSec > 0 && lastPositionSec >= lastDurationSec - 3;
    // The server is between its own songs. Let it advance, rather than asking
    // the phone to load the next song for a second time.
    if (atEnd && serverIndex < serverEntries.length - 1) return;
    events?.onProgress(pos, lastDurationSec);
    if (!owns(ticket)) return;
    if (atEnd && !finishedFired) { finishedFired = true; events?.onFinished(); return; }
    if (lastPlaying !== false) { lastPlaying = false; events?.onPlayingChanged(false, false); }
  })().finally(() => { if (polling === job) polling = null; });
  return job.work;
}

export async function jukeboxConnect(): Promise<boolean> {
  const a = auth();
  if (!a) return false;
  invalidate(); sessionOwner = a;
  lastPositionSec = 0; lastDurationSec = 0; finishedFired = false;
  intendedPlaying = false; lastPlaying = null; retryAfter = 0;
  useJukebox.setState({ active: true });
  pollTimer = setInterval(() => { void poll(); }, POLL_MS);
  events?.onConnected();
  return true;
}
export async function jukeboxDisconnect(silent = false): Promise<void> {
  if (!isJukeboxActive()) return;
  const a = sessionOwner, position = lastPositionSec;
  invalidate();
  const stoppedSession = session;
  await command(async () => {
    // A reconnect may already be using the same server. Do not stop it late.
    if (!a || session !== stoppedSession || isJukeboxActive()) return;
    try { await jukeboxStop(a); } catch { /* A lost output still disconnects locally. */ }
  });
  if (!silent && session === stoppedSession && auth() === a && !isJukeboxActive()) events?.onDisconnected(position);
}

export async function jukeboxLoad(song: Song, autoplay: boolean, startSec = 0, upcoming: Song[] = [], currentIndex = 0): Promise<boolean> {
  const currentOwner = owner();
  if (!currentOwner || !playableOnJukebox(song)) return false;
  load++; revision++;
  const ticket = owner()!;
  loading = true; finishedFired = false; intendedPlaying = autoplay; lastPlaying = null;
  pendingSync = null; retryAfter = 0;
  const entries = [{ song, queueIndex: currentIndex }, ...jukeboxUpcoming(song, upcoming, currentIndex)];
  return command(async () => {
    if (!owns(ticket)) return false;
    try {
      await jukeboxSet(ticket.auth, entries.map((entry) => entry.song.id));
      if (!owns(ticket)) return false;
      serverEntries = entries; serverIndex = 0; needsQueueRead = false;
      lastPositionSec = startSec; lastDurationSec = song.duration ?? 0;
      if (startSec > 0) {
        await jukeboxSkip(ticket.auth, 0, startSec);
        if (!owns(ticket)) return false;
      }
      if (intendedPlaying) await jukeboxStart(ticket.auth);
      else await jukeboxStop(ticket.auth);
      return owns(ticket);
    } catch { if (owns(ticket)) needsQueueRead = true; return false; }
    finally { if (owns(ticket)) loading = false; }
  });
}

/** If a failed request actually committed, learn its result before retrying. */
async function reconcile(ticket: Owner, request: SyncRequest): Promise<boolean> {
  const status = await jukeboxGet(ticket.auth);
  if (!owns(ticket)) return false;
  const possible = new Map([...serverEntries, { song: request.current, queueIndex: request.currentIndex },
    ...jukeboxUpcoming(request.current, request.upcoming, request.currentIndex)].map((entry) => [entry.song.id, entry]));
  if (new Set(status.ids).size !== status.ids.length || status.ids.some((id) => !possible.has(id))) return false;
  serverEntries = status.ids.map((id) => possible.get(id)!);
  needsQueueRead = false;
  return followIndex(status, ticket);
}

function drainSync(): Promise<void> {
  if (syncing) return syncing;
  const work = command(async () => {
    while (pendingSync) {
      const request = pendingSync; pendingSync = null;
      const ticket = request.owner;
      if (!owns(ticket)) continue;
      try {
        if (needsQueueRead && !await reconcile(ticket, request)) {
          if (owns(ticket)) { pendingSync ??= request; retryAfter = Date.now() + 5000; }
          return;
        }
        if (!owns(ticket) || serverEntries[serverIndex]?.song.id !== request.current.id) continue;
        const want = jukeboxUpcoming(request.current, request.upcoming, request.currentIndex,
          serverEntries.slice(0, serverIndex).map((entry) => entry.song.id));
        const have = serverEntries.slice(serverIndex + 1), same = jukeboxTailPrefix(have, want);
        // Mapping is app-owned even when the server does not need a write.
        serverEntries[serverIndex] = { song: request.current, queueIndex: request.currentIndex };
        for (let n = 0; n < same; n++) serverEntries[serverIndex + 1 + n] = want[n];
        if (same === have.length && same === want.length) continue;
        // The server advances without JS. Re-check before editing, then use
        // each mutation reply before considering another removal. Subsonic has
        // no compare-and-swap; never knowingly remove the song it reached.
        const before = await jukeboxStatus(ticket.auth);
        if (!owns(ticket)) return;
        if (!followIndex(before, ticket) || serverEntries[serverIndex]?.song.id !== request.current.id) continue;
        revision++;
        const keep = serverIndex + 1 + same;
        let moved = false;
        for (let index = serverEntries.length - 1; index >= keep; index--) {
          if (index <= serverIndex) { moved = true; break; }
          const status = await jukeboxRemove(ticket.auth, index);
          if (!owns(ticket)) return;
          serverEntries = serverEntries.slice(0, index);
          if (!followIndex(status, ticket) || serverEntries[serverIndex]?.song.id !== request.current.id) {
            moved = true; break;
          }
        }
        if (moved) continue;
        const added = want.slice(same);
        if (added.length) {
          const status = await jukeboxAdd(ticket.auth, added.map((entry) => entry.song.id));
          if (!owns(ticket)) return;
          serverEntries = [...serverEntries, ...added];
          followIndex(status, ticket);
        }
      } catch {
        if (owns(ticket)) {
          needsQueueRead = true;
          pendingSync ??= request;
          retryAfter = Date.now() + 5000;
        }
        return;
      }
    }
  });
  syncing = work.finally(() => { if (syncing === settled) syncing = null; });
  const settled = syncing;
  return settled;
}

export function jukeboxSyncUpcoming(current: Song, upcoming: Song[], currentIndex = 0): Promise<void> {
  const ticket = owner();
  if (!ticket) return Promise.resolve();
  // Retain the newest edit during a load or another sync. A discarded edit
  // would leave a removed track on the server until the next periodic save.
  pendingSync = { owner: ticket, current, upcoming, currentIndex };
  retryAfter = 0;
  return drainSync();
}
export async function jukeboxPlay(): Promise<void> {
  const ticket = owner(); if (!ticket) return;
  intendedPlaying = true;
  await command(async () => { if (owns(ticket, false)) try { await jukeboxStart(ticket.auth); } catch { /* Poll can recover. */ } });
}
export async function jukeboxPause(): Promise<void> {
  const ticket = owner(); if (!ticket) return;
  intendedPlaying = false;
  await command(async () => { if (owns(ticket, false)) try { await jukeboxStop(ticket.auth); } catch { /* Poll can recover. */ } });
}
export async function jukeboxSeek(sec: number): Promise<void> {
  const ticket = owner(); if (!ticket || !Number.isFinite(sec)) return;
  await command(async () => {
    if (!owns(ticket)) return;
    try {
      await jukeboxSkip(ticket.auth, serverIndex, Math.max(0, sec));
      if (owns(ticket)) lastPositionSec = Math.max(0, sec);
    } catch { /* The next status remains authoritative. */ }
  });
}
export function jukeboxSetVolume(volume: number): void {
  const ticket = owner(); if (!ticket || !Number.isFinite(volume)) return;
  void command(async () => { if (owns(ticket, false)) try { await jukeboxSetGain(ticket.auth, Math.max(0, Math.min(1, volume))); } catch { /* Keep the current gain. */ } });
}
