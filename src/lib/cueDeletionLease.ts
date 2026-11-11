/** Pure admission guard; no imports from the player, filesystem or database. */
interface Lease { imports: number; cleanup?: { directory: string }; }
const leases = new Map<string, Lease>();
export function cueCleanupActive(scopeKey: string): boolean { return !!leases.get(scopeKey)?.cleanup; }
export function beginCueImportLease(scopeKey: string): () => void {
  const state = leases.get(scopeKey) ?? { imports: 0 }; if (state.cleanup) throw new Error('CUE audio is being cleared. Try again when clearing finishes.');
  state.imports++; leases.set(scopeKey, state); let active = true;
  return () => { if (!active) return; active = false; state.imports--; if (!state.imports && !state.cleanup) leases.delete(scopeKey); };
}
export function beginCueCleanupLease(scopeKey: string, directory: string): () => void {
  const state = leases.get(scopeKey) ?? { imports: 0 };
  if (state.imports || state.cleanup) throw new Error('A CUE import or cleanup is in progress. Try again when it finishes.');
  state.cleanup = { directory }; leases.set(scopeKey, state); let active = true;
  return () => { if (!active) return; active = false; state.cleanup = undefined; if (!state.imports) leases.delete(scopeKey); };
}
export function cueDeletionBlocked(song: { cueSourceId?: string; localUri?: string; url?: string }): boolean {
  if (!song.cueSourceId) return false;
  for (const state of leases.values()) if (state.cleanup && [song.localUri, song.url].some((uri) => uri?.startsWith(state.cleanup!.directory))) return true;
  return false;
}
