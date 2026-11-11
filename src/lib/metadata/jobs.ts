import type { Song } from '@/api/subsonic';
import { metadataCheck, isMetadataCancelled, safeMetadataSong, type ScrapeCandidate, type ScrapeField, type ScrapeOperation } from './models';

export type MetadataItemState = 'pending' | 'done' | 'failed' | 'review' | 'skipped';
export interface MetadataJobItem { song: Song; status: MetadataItemState; candidate?: ScrapeCandidate; intentId: string; issue?: string; }
export interface MetadataJob { version: 1; id: string; title: string; status: 'paused' | 'running' | 'completed' | 'cancelled';
  items: MetadataJobItem[]; fields: ScrapeField[]; overwrite: boolean; createdAt: number; updatedAt: number; }
export function createMetadataJob(songs: readonly Song[], title: string, fields: readonly ScrapeField[], overwrite: boolean,
  candidates?: ReadonlyMap<string, ScrapeCandidate>): MetadataJob {
  if (!songs.length || songs.length > 1000) throw new Error('Choose between 1 and 1000 songs');
  const id = `scrape_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const seen = new Set<string>();
  const items = songs.filter((song) => { if (!song.id || seen.has(song.id) || song.url && !song.vod || song.podcastChannelId) return false; seen.add(song.id); return true; })
    .map((song, index) => ({ song: safeMetadataSong(song), status: candidates && !candidates.has(song.id) ? 'review' as const : 'pending' as const,
      candidate: candidates?.get(song.id), intentId: `${id}_${index}` }));
  if (!items.length || !fields.length) throw new Error('Choose songs and fields first');
  return { version: 1, id, title: title.slice(0, 200), status: 'paused', items, fields: [...new Set(fields)], overwrite, createdAt: Date.now(), updatedAt: Date.now() };
}
export function metadataJobSummary(job: MetadataJob) {
  return { total: job.items.length, completed: job.items.filter((item) => item.status !== 'pending').length,
    applied: job.items.filter((item) => item.status === 'done').length, failed: job.items.filter((item) => item.status === 'failed').length,
    review: job.items.filter((item) => item.status === 'review').length };
}
export function validMetadataJob(value: unknown): value is MetadataJob {
  const job = value as MetadataJob;
  return !!job && job.version === 1 && typeof job.id === 'string' && typeof job.title === 'string' && job.title.length <= 200
    && ['paused', 'running', 'completed', 'cancelled'].includes(job.status) && Array.isArray(job.items) && job.items.length <= 1000
    && Array.isArray(job.fields) && job.fields.every((field) => ['title', 'artist', 'albumArtist', 'album', 'year', 'genres', 'track', 'discNumber', 'cover', 'lyrics', 'mediaKind'].includes(field))
    && job.items.every((item) => item && typeof item.song?.id === 'string' && typeof item.song.title === 'string'
      && typeof item.intentId === 'string' && ['pending', 'done', 'failed', 'review', 'skipped'].includes(item.status)
      && !item.song.url && !item.song.localUri && !item.song.coverBase64);
}
/** A completed item is checkpointed before moving on. Source work is never restarted by mounting a screen. */
export async function runMetadataJob(initial: MetadataJob, operation: ScrapeOperation, dependencies: {
  save(job: MetadataJob): Promise<void>;
  find(song: Song): Promise<ScrapeCandidate | undefined>;
  prepare?(song: Song, candidate: ScrapeCandidate): Promise<ScrapeCandidate>;
  apply(item: MetadataJobItem, candidate: ScrapeCandidate): Promise<void>;
  publish(job: MetadataJob): void;
}): Promise<MetadataJob> {
  let job: MetadataJob = { ...initial, items: initial.items.map((item) => ({ ...item })), status: 'running', updatedAt: Date.now() };
  metadataCheck(operation); await dependencies.save(job); dependencies.publish(job);
  for (let index = 0; index < job.items.length; index++) {
    metadataCheck(operation); const item = job.items[index]; if (item.status !== 'pending') continue;
    try {
      let candidate = item.candidate ?? await dependencies.find(item.song); metadataCheck(operation);
      if (candidate && dependencies.prepare) { candidate = await dependencies.prepare(item.song, candidate); metadataCheck(operation); }
      if (!candidate) item.status = 'review';
      else { item.candidate = candidate; await dependencies.save({ ...job, updatedAt: Date.now() }); metadataCheck(operation);
        await dependencies.apply(item, candidate); metadataCheck(operation); item.status = 'done'; }
    } catch (error) {
      if (isMetadataCancelled(error) || !operation.current() || operation.signal?.aborted) throw error;
      item.status = 'failed'; item.issue = error instanceof Error && error.message === 'Local metadata changed. Review again.' ? 'Local metadata changed. Review again.' : 'Could not complete this song';
    }
    job = { ...job, items: [...job.items], updatedAt: Date.now() };
    await dependencies.save(job); metadataCheck(operation); dependencies.publish(job);
    // Explicit foreground/background-protected job work, never a scroll callback.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  metadataCheck(operation); job = { ...job, status: 'completed', updatedAt: Date.now() }; await dependencies.save(job); dependencies.publish(job); return job;
}
