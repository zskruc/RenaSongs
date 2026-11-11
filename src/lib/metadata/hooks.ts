import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAuthStore } from '@/store/auth';
import { customizationScope } from '@/lib/localCustomizations';
import { scopeKey } from '@/store/localMetadata';
import { useMetadataScraping, metadataTargetIsCurrent, installMetadataOwnerFence } from '@/store/metadataScraping';
import { publishMetadataArtworkRegistry } from './artworkRegistry';
import { listMetadataRecords, metadataOperation, metadataVisualRevision, subscribeMetadataRecords } from './repository';
import { validMetadataInsight, type MetadataArtwork, type MetadataInsight, type MetadataKind } from './models';

let visualLoad: { key: string; current: () => boolean; task: Promise<void> } | undefined, visualKey = '', loadedRevision = -1;
/** Root mounts once. It reads only bounded artwork/insight documents, not scraping jobs. */
export function useMetadataAssetsHydration() {
  const auth = useAuthStore((state) => state.auth), source = useAuthStore((state) => state.offlineSource), offline = useAuthStore((state) => state.offline);
  const revision = useSyncExternalStore(subscribeMetadataRecords, metadataVisualRevision);
  const scope = customizationScope(), key = scopeKey(scope);
  useEffect(() => {
    installMetadataOwnerFence();
    const operation = metadataOperation(scope);
    if (!operation.current() || visualKey === key && loadedRevision === revision && useMetadataScraping.getState().scope === key) return;
    if (visualLoad?.key === `${key}|${revision}` && visualLoad.current()) return;
    const task = (async () => {
      try {
        const [artwork, insights] = await Promise.all([listMetadataRecords<MetadataArtwork>('artwork', operation, 1000), listMetadataRecords<MetadataInsight>('insight', operation, 1000)]);
        if (!operation.current()) return;
        visualKey = key; loadedRevision = revision;
        const visual = Object.fromEntries(artwork.map((row) => [row.id, row.value])); publishMetadataArtworkRegistry(key, visual);
        useMetadataScraping.setState({ scope: key, artwork: visual, insights: Object.fromEntries(insights.filter((row) => validMetadataInsight(row.value)).map((row) => [row.id, row.value])) });
      } catch { /* Keep existing displayed assets on a transient storage failure. */ }
    })();
    visualLoad = { key: `${key}|${revision}`, current: operation.current, task };
    void task.finally(() => { if (visualLoad?.task === task) visualLoad = undefined; });
  }, [auth, source, offline, key, revision]); // eslint-disable-line react-hooks/exhaustive-deps
}
export function metadataArtwork(kind: MetadataKind, id: string | undefined, fallback?: string): string | undefined {
  const state = useMetadataScraping.getState();
  return id && state.scope === scopeKey(customizationScope()) ? state.artwork[`${kind}:${id}`]?.uri ?? fallback : fallback;
}
export function useMetadataArtwork(kind: MetadataKind, id: string | undefined, fallback?: string): string | undefined {
  const scope = useMetadataScraping((state) => state.scope), asset = useMetadataScraping((state) => id ? state.artwork[`${kind}:${id}`] : undefined);
  return scope === scopeKey(customizationScope()) ? asset?.uri ?? fallback : fallback;
}
export function useMetadataInsight(kind: Exclude<MetadataKind, 'song'>, id?: string): MetadataInsight | undefined {
  const scope = useMetadataScraping((state) => state.scope), value = useMetadataScraping((state) => id ? state.insights[`${kind}:${id}`] : undefined);
  return scope === scopeKey(customizationScope()) ? value : undefined;
}
/** Capture once; a later playback change does not retarget an editing form. */
export function useMetadataTarget() {
  useAuthStore((state) => state.auth); useAuthStore((state) => state.offline); useAuthStore((state) => state.offlineSource);
  const [captured] = useState(() => { const target = useMetadataScraping.getState().target; return { target, owner: metadataOperation(target?.scope) }; });
  return captured.owner.current() && metadataTargetIsCurrent(captured.target) ? captured.target : null;
}
