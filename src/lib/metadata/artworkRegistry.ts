/** Read-only display registry: no React, backend, auth, storage or player imports. */
import type { MetadataArtwork, MetadataKind } from './models';
let scope = '', artwork: Readonly<Record<string, MetadataArtwork>> = {};
let revision = 0;
const listeners = new Set<() => void>();
export function subscribeMetadataArtwork(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function metadataArtworkRevision() { return revision; }
function changed() { revision++; for (const listener of listeners) listener(); }
export function publishMetadataArtworkRegistry(nextScope: string, values: Readonly<Record<string, MetadataArtwork>>): void { scope = nextScope; artwork = values; changed(); }
export function clearMetadataArtworkRegistry(profile?: string): void { if (!profile || scope.startsWith(`${profile}|`)) { scope = ''; artwork = {}; changed(); } }
export function metadataArtworkUri(kind: MetadataKind, id: string | undefined, fallback?: string, expectedScope?: string): string | undefined {
  if (!id || !scope || expectedScope !== undefined && scope !== expectedScope) return fallback;
  const uri = artwork[`${kind}:${id}`]?.uri;
  return typeof uri === 'string' && uri.startsWith('file://') ? uri : fallback;
}
