import { personalOwner } from '@/store/playlistRecovery';
import { flushLocalPodcastProgress, invalidateLocalPodcastProgress, loadLocalPodcastProgress } from '@/store/localPodcasts';
import { customizationScope, captureCustomizationOwner } from './localCustomizations';
import { readListeningExtra, updateListeningExtra } from './listeningExtras';
import { validateLocalPodcastProgress, type LocalPodcastProgressMap } from './localPodcasts';
export interface LocalPodcastBackup { version: 1; source: string; progress: LocalPodcastProgressMap; }
export function validateLocalPodcastBackup(raw: unknown): LocalPodcastBackup {
  const value = raw as LocalPodcastBackup;
  if (!value || value.version !== 1 || !/^(server|device|folder:[a-z0-9]{1,16})$/.test(value.source) || JSON.stringify(value).length > 1_500_000) throw new Error('Invalid local podcast backup');
  const progress = validateLocalPodcastProgress(value.progress);
  if (Object.keys(progress).some((id) => /^(https?:|file:|content:)/i.test(id))) throw new Error('Audio URLs are not supported in local podcast backups');
  return { version: 1, source: value.source, progress };
}
export async function exportLocalPodcastBackup(owner = personalOwner()): Promise<LocalPodcastBackup> {
  const scope = customizationScope(), owns = captureCustomizationOwner(scope, owner.current); owner.check();
  if (scope.profile !== owner.profile) throw new Error('Local podcast profile changed');
  await flushLocalPodcastProgress(); owner.check();
  const progress = await readListeningExtra<LocalPodcastProgressMap>('local-podcast-progress-v1', scope, owns); owner.check();
  return validateLocalPodcastBackup({ version: 1, source: scope.source, progress: progress ?? {} });
}
export async function restoreLocalPodcastBackup(raw: unknown, owner = personalOwner()): Promise<void> {
  const value = validateLocalPodcastBackup(raw), scope = customizationScope(), owns = captureCustomizationOwner(scope, owner.current); owner.check();
  if (scope.profile !== owner.profile || value.source !== scope.source) throw new Error('Restore local podcast progress only to the same library source');
  await flushLocalPodcastProgress(); owner.check(); invalidateLocalPodcastProgress();
  await updateListeningExtra<LocalPodcastProgressMap>('local-podcast-progress-v1', (previous) => {
    const merged = validateLocalPodcastProgress(previous);
    for (const [id, entry] of Object.entries(value.progress)) if (!merged[id] || entry.updatedAt > merged[id].updatedAt) merged[id] = entry;
    return validateLocalPodcastProgress(merged);
  }, scope, owns); owner.check();
  invalidateLocalPodcastProgress(); await loadLocalPodcastProgress(); owner.check();
}
