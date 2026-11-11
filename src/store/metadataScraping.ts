import { create } from 'zustand';
import type { Song } from '@/api/subsonic';
import { getSong } from '@/api/data';
import { acquireBackgroundWork, type BackgroundWorkLease } from '@/lib/backgroundWork';
import { lyricRecordingKey } from '@/lib/lyricDocuments';
import { useAuthStore } from './auth';
import { customizationScope, publishLocalCustomizationChanges } from '@/lib/localCustomizations';
import { scopeKey, useLocalMetadata } from './localMetadata';
import { sourceSong } from '@/lib/sourceSongMetadata';
import { createMetadataJob, runMetadataJob, validMetadataJob, type MetadataJob } from '@/lib/metadata/jobs';
import { applyMetadataCandidate } from '@/lib/metadata/apply';
import { resolveMetadataCandidateForFields, searchMetadata } from '@/lib/metadata/providers';
import { fetchMetadataArtwork } from '@/lib/metadata/artwork';
import { listMetadataRecords, metadataOperation, readMetadataRecord, saveMetadataRecord } from '@/lib/metadata/repository';
import { DEFAULT_METADATA_SETTINGS, metadataCheck, validMetadataSettings, validMetadataInsight, type MetadataArtwork, type MetadataInsight, type MetadataSettings, type MetadataTarget, type ScrapeCandidate, type ScrapeField } from '@/lib/metadata/models';
import { validateScraperProfile, type ScraperProfile } from '@/lib/metadata/config';
import { clearMetadataArtworkRegistry, publishMetadataArtworkRegistry } from '@/lib/metadata/artworkRegistry';

let loadToken = 0, subscribed = false;
let load: { key: string; current: () => boolean; task: Promise<void> } | undefined;
let running: { id: string; key: string; controller: AbortController; current: () => boolean; task: Promise<void> } | undefined;
let starting = false;
export function installMetadataOwnerFence() {
  if (subscribed) return; subscribed = true;
  useAuthStore.subscribe((next, before) => {
    if (next.auth !== before.auth || next.offline !== before.offline || next.offlineSource !== before.offlineSource || next.autoOffline !== before.autoOffline) {
      loadToken++; running?.controller.abort(); clearMetadataArtworkRegistry(); useMetadataScraping.setState({ target: null, ready: false, scope: '', artwork: {}, insights: {}, jobs: [], profiles: [] });
    }
  });
}
interface MetadataScrapingState {
  scope: string; ready: boolean; error: boolean; target: MetadataTarget | null;
  settings: MetadataSettings; profiles: ScraperProfile[]; jobs: MetadataJob[];
  artwork: Record<string, MetadataArtwork>; insights: Record<string, MetadataInsight>;
  open(target: Omit<MetadataTarget, 'scope'>): void;
  hydrate(force?: boolean): Promise<void>;
  saveSettings(settings: MetadataSettings): Promise<void>;
  start(songs: readonly Song[], title: string, fields: readonly ScrapeField[], overwrite: boolean, candidates?: ReadonlyMap<string, ScrapeCandidate>): Promise<string>;
  resume(id: string, retryFailed?: boolean): Promise<void>;
  stop(id: string, cancel?: boolean): Promise<void>;
}
export const useMetadataScraping = create<MetadataScrapingState>((set, get) => ({
  scope: '', ready: false, error: false, target: null, settings: { ...DEFAULT_METADATA_SETTINGS }, profiles: [], jobs: [], artwork: {}, insights: {},
  open(target) { installMetadataOwnerFence(); const scope = customizationScope(), owner = metadataOperation(scope); set({ target: { ...target, scope, current: owner.current, songs: target.songs.slice(0, 1000).map(sourceSong) } }); },
  hydrate(force = false) {
    installMetadataOwnerFence(); const operation = metadataOperation(), key = scopeKey(operation.scope);
    if (!operation.current()) return Promise.resolve();
    if (!force && get().scope === key && get().ready) return Promise.resolve();
    if (!force && load?.key === key && load.current()) return load.task;
    const token = ++loadToken; if (get().scope !== key) set({ scope: key, ready: false, artwork: {}, insights: {}, jobs: [], profiles: [], error: false });
    const task = (async () => {
      try {
        const [settings, profiles, jobs, artwork, insights] = await Promise.all([
          readMetadataRecord<MetadataSettings>('settings', 'main', operation), listMetadataRecords<ScraperProfile>('provider', operation, 100),
          listMetadataRecords<MetadataJob>('job', operation, 5), listMetadataRecords<MetadataArtwork>('artwork', operation, 1000), listMetadataRecords<MetadataInsight>('insight', operation, 1000),
        ]);
        metadataCheck(operation); if (token !== loadToken) return;
        const validProfiles = profiles.flatMap((row) => { try { return [validateScraperProfile(row.value)]; } catch { return []; } });
        const validJobs = jobs.map((row) => row.value).filter(validMetadataJob).map((job) => job.status === 'running' && running?.id !== job.id ? { ...job, status: 'paused' as const } : job);
        const visual = Object.fromEntries(artwork.map((row) => [row.id, row.value])); publishMetadataArtworkRegistry(key, visual);
        set({ scope: key, ready: true, error: false, settings: validMetadataSettings(settings) ? settings : { ...DEFAULT_METADATA_SETTINGS }, profiles: validProfiles, jobs: validJobs,
          artwork: visual, insights: Object.fromEntries(insights.filter((row) => validMetadataInsight(row.value)).map((row) => [row.id, row.value])) });
      } catch { if (token === loadToken && operation.current()) set({ error: true }); }
    })();
    load = { key, current: operation.current, task }; void task.finally(() => { if (load?.task === task) load = undefined; }); return task;
  },
  async saveSettings(settings) { const operation = metadataOperation(); await saveMetadataRecord('settings', 'main', settings, operation); metadataCheck(operation); set({ settings }); },
  async start(songs, title, fields, overwrite, candidates) {
    const operation = metadataOperation(); const job = createMetadataJob(songs.map(sourceSong), title, fields, overwrite, candidates);
    await saveMetadataRecord('job', job.id, job, operation); metadataCheck(operation);
    set((state) => ({ jobs: [job, ...state.jobs].slice(0, 5) })); void get().resume(job.id).catch(() => {}); return job.id;
  },
  async resume(id, retryFailed = false) {
    if (starting) throw new Error('A metadata task is already starting');
    if (running) { if (running.current()) throw new Error('A metadata task is already running'); await running.task.catch(() => {}); }
    if (starting) throw new Error('A metadata task is already starting');
    starting = true;
    const controller = new AbortController(), operation = metadataOperation(undefined, controller.signal), key = scopeKey(operation.scope);
    let value: MetadataJob | undefined;
    try { await get().hydrate(); metadataCheck(operation); value = await readMetadataRecord<MetadataJob>('job', id, operation); metadataCheck(operation); }
    catch (error) { starting = false; throw error; }
    starting = false;
    if (!value || !validMetadataJob(value)) throw new Error('Metadata task not found');
    let job = retryFailed ? { ...value, status: 'paused' as const, items: value.items.map((item) => item.status === 'failed' ? { ...item, status: 'pending' as const, issue: undefined } : item) } : value;
    const publish = (next: MetadataJob) => { if (!operation.current() || get().scope !== key) return; job = next; set((state) => ({ jobs: [next, ...state.jobs.filter((entry) => entry.id !== id)].slice(0, 5) })); };
    let lease: BackgroundWorkLease | undefined, interruptionStatus: 'paused' | 'cancelled' = 'paused', committed = 0, lastPublication = Date.now();
    const flush = () => { if (operation.current()) { publishLocalCustomizationChanges(operation.current); committed = 0; lastPublication = Date.now(); } };
    const task = (async () => {
      try {
        lease = await acquireBackgroundWork('metadata', { completed: job.items.filter((item) => item.status !== 'pending').length, total: job.items.length },
          (reason) => { interruptionStatus = reason === 'cancel' ? 'cancelled' : 'paused'; controller.abort(); }, operation.current, controller.signal);
        metadataCheck(operation);
        await runMetadataJob(job, operation, {
          save: (next) => saveMetadataRecord('job', id, next, operation), publish: (next) => { publish(next); lease?.update({
            completed: next.items.filter((item) => item.status !== 'pending').length, total: next.items.length, failed: next.items.filter((item) => item.status === 'failed').length }); },
          find: async (song) => {
            const result = await searchMetadata(song, get().settings, get().profiles, operation, job.fields.includes('lyrics') ? 'all' : 'metadata');
            const candidate = await resolveMetadataCandidateForFields(result.candidates, job.fields, get().profiles, operation);
            if (!candidate && result.issues.length && !result.candidates.length) throw new Error('Metadata providers are unavailable');
            return candidate;
          },
          prepare: async (song, candidate) => {
            if (!job.fields.includes('lyrics') || candidate.lyrics || candidate.lyricsChecked) return candidate;
            const lookup = { ...song, title: candidate.fields.title ?? song.title, artist: candidate.fields.artist ?? song.artist, album: candidate.fields.album ?? song.album };
            const result = await searchMetadata(lookup, get().settings, get().profiles, operation, 'lyrics');
            const lyric = await resolveMetadataCandidateForFields(result.candidates, ['lyrics'], get().profiles, operation);
            return { ...candidate, lyricsChecked: true, ...(lyric?.lyrics ? { lyrics: lyric.lyrics, lyricsSource: { provider: lyric.provider, externalId: lyric.externalId } } : {}) };
          },
          apply: async (item, candidate) => {
            const resolved = await getSong(item.song.id); metadataCheck(operation);
            if (!resolved || lyricRecordingKey(sourceSong(resolved)) !== lyricRecordingKey(item.song)) throw new Error('Metadata recording changed');
            await applyMetadataCandidate(sourceSong(resolved), candidate, job.fields, job.overwrite, operation, item.intentId, false);
            committed++; if (committed >= 40 || Date.now() - lastPublication >= 5000) flush();
            if (job.fields.includes('cover') && candidate.coverUrl) await fetchMetadataArtwork(candidate.coverUrl, 'song', item.song.id, operation);
          },
        });
      } catch {
        // A new owner must never receive an old task's final publication.
        const fresh = metadataOperation();
        if (operation.current() && scopeKey(fresh.scope) === key) { const paused = { ...job, status: interruptionStatus, updatedAt: Date.now() }; await saveMetadataRecord('job', id, paused, fresh); publish(paused); }
      } finally { flush(); await lease?.release().catch(() => {}); if (running?.id === id && running.controller === controller) running = undefined; if (operation.current()) { await useLocalMetadata.getState().hydrate(operation.scope, true); await get().hydrate(true); } }
    })();
    running = { id, key, controller, current: operation.current, task }; await task;
  },
  async stop(id, cancel = false) {
    if (running?.id === id) { const active = running; active.controller.abort(); await active.task.catch(() => {}); }
    const operation = metadataOperation(); const job = await readMetadataRecord<MetadataJob>('job', id, operation); if (!job) return;
    const next = { ...job, status: cancel ? 'cancelled' as const : 'paused' as const, updatedAt: Date.now() };
    await saveMetadataRecord('job', id, next, operation); metadataCheck(operation);
    set((state) => ({ jobs: [next, ...state.jobs.filter((entry) => entry.id !== id)].slice(0, 5) }));
  },
}));

export function openMetadataTarget(target: Omit<MetadataTarget, 'scope'>) { useMetadataScraping.getState().open(target); }
export function metadataTargetIsCurrent(target: MetadataTarget | null): target is MetadataTarget { return !!target && (!target.current || target.current()) && scopeKey(target.scope) === scopeKey(customizationScope()); }
export function metadataJobRunning() { return !!running?.current(); }
