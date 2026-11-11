import type { Song } from '@/api/subsonic';
import type { ScrapeCandidate } from './models';

const fold = (text: string | undefined) => (text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const markers = /\b(live|remaster(?:ed)?|acoustic|instrumental|demo|radio edit|remix|mono|stereo|karaoke)\b|现场|重制|伴奏|不插电/giu;
export function recordingIdentity(title: string): { core: string; versions: string[] } {
  const versions = [...new Set((title.match(markers) ?? []).map((part) => fold(part).replace(/^remastered$/, 'remaster')))];
  return { core: fold(title.replace(/\s[-–—]\s.*$/, (part) => (part.match(markers) ?? []).length ? '' : part)
    .replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, (part) => (part.match(markers) ?? []).length ? '' : part)
    .replace(/^\s*\d{1,3}[\s._-]+/, '')), versions: versions.sort() };
}
export function rankMetadataCandidate(song: Pick<Song, 'title' | 'artist' | 'album' | 'duration'>, input: ScrapeCandidate): ScrapeCandidate {
  const wanted = recordingIdentity(song.title), candidate = recordingIdentity(input.fields.title ?? '');
  const reasons: string[] = [], title = wanted.core === candidate.core && !!wanted.core;
  const version = wanted.versions.join('|') === candidate.versions.join('|');
  const artist = !!fold(song.artist) && fold(song.artist) === fold(input.fields.artist);
  const album = !!fold(song.album) && fold(song.album) === fold(input.fields.album);
  const durationKnown = (song.duration ?? 0) > 0 && (input.duration ?? 0) > 0;
  const delta = durationKnown ? Math.abs(song.duration! - input.duration!) : Number.POSITIVE_INFINITY;
  const conflict = durationKnown && delta > Math.max(10, Math.min(30, song.duration! * 0.1));
  if (!title) reasons.push('Different title');
  if (!version) reasons.push('Different recording version');
  if (song.artist && input.fields.artist && !artist) reasons.push('Different artist');
  if (song.album && input.fields.album && !album) reasons.push('Different album edition');
  if (conflict) reasons.push('Different duration');
  const confident = title && version && !conflict && !(song.album && input.fields.album && !album) && (song.artist ? artist || !input.fields.artist && delta < 2 : delta < 2);
  const score = (title ? 50 : wanted.core && candidate.core.includes(wanted.core) ? 15 : 0)
    + (version ? 10 : -30) + (artist ? 25 : song.artist && input.fields.artist ? -40 : 0)
    + (delta < 2 ? 15 : delta < 8 ? 7 : conflict ? -30 : 0) + (album ? 5 : 0);
  return { ...input, score, confident, reasons };
}
/** A release proposal is one-to-one. Ambiguous tracks remain unselected. */
export function matchReleaseTracks(songs: readonly Song[], candidates: readonly ScrapeCandidate[]): Map<string, ScrapeCandidate> {
  const proposals = new Map<string, ScrapeCandidate[]>();
  for (const song of songs) {
    const possible = candidates.filter((candidate) => (!song.discNumber || !candidate.fields.discNumber || song.discNumber === candidate.fields.discNumber)
      && (!(song.duration && candidate.duration) || Math.abs(song.duration - candidate.duration) <= 8));
    const title = possible.filter((candidate) => recordingIdentity(song.title).core === recordingIdentity(candidate.fields.title ?? '').core
      && recordingIdentity(song.title).versions.join('|') === recordingIdentity(candidate.fields.title ?? '').versions.join('|'));
    const numbered = possible.filter((candidate) => song.track && candidate.fields.track === song.track);
    const titleNumbered = title.filter((candidate) => numbered.includes(candidate));
    proposals.set(song.id, titleNumbered.length ? titleNumbered : title.length ? title : /^\s*(track\s*)?\d{1,3}\s*$/i.test(song.title) ? numbered : []);
  }
  const counts = new Map<string, number>();
  for (const choices of proposals.values()) if (choices.length === 1) counts.set(choices[0].id, (counts.get(choices[0].id) ?? 0) + 1);
  return new Map([...proposals].flatMap(([id, choices]) => choices.length === 1 && counts.get(choices[0].id) === 1 ? [[id, choices[0]]] : []));
}
export function orderMetadataCandidates(song: Pick<Song, 'title' | 'artist' | 'album' | 'duration'>, candidates: readonly ScrapeCandidate[]): ScrapeCandidate[] {
  return candidates.map((candidate) => rankMetadataCandidate(song, candidate)).sort((a, b) => Number(b.confident) - Number(a.confident) || b.score! - a.score!);
}
