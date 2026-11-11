/** Local database pages for Android Auto; never refresh RSS or enumerate a feed at startup. */
import { episodeToSong, listAddedChannels, podcastCover, type PodcastChannel } from '@/api/podcasts';
import type { Song } from '@/api/subsonic';
import { profileScopeId } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { tg } from '@/i18n';
import { captureLyricOwner } from './lyricOwner';
import { hashKey } from './localLibrary';
import { listEpisodePage, listLibraryEpisodes } from './podcastDb';
import { podcastListeningState, readPodcastShowProgress } from './podcastLibrary';
import type { CarNode, CarTree } from './carAuto';
const PAGE = 20;
export const CAR_PODCAST_TAB: CarNode = { id: 'tab:podcasts', title: '', playable: false, contentStyle: 'list', artworkUrl: 'res://ic_car_library' };
type Shelf = 'continue' | 'unplayed' | 'downloaded';
interface Snapshot { profile: string; current: () => boolean; channels: Map<string, PodcastChannel>; pages: Map<string, { songs: Song[]; nodes: CarNode[] }>; }
let snapshot: Snapshot | undefined, generation = 0;
const pending = new Map<string, { task: Promise<{ tree: CarTree; current: () => boolean } | undefined>; current: () => boolean }>();
export function resetPodcastCarTree() { generation++; snapshot = undefined; pending.clear(); }
function owned() { const profile = profileScopeId(), epoch = captureLyricOwner(profile), token = generation; return { profile, current: () => epoch() && generation === token && profileScopeId() === profile }; }
const shelfId = (shelf: Shelf, offset = 0) => `podcast-shelf|${shelf}|${offset}`;
const showId = (channelId: string, offset = 0) => `podcast-show|${encodeURIComponent(channelId)}|${offset}`;
const title = (shelf: Shelf) => tg(shelf === 'continue' ? 'Continue listening' : shelf === 'unplayed' ? 'Unplayed' : 'Downloaded');
function folder(id: string, title: string, image?: string): CarNode { return { id, title, artworkUrl: image, playable: false, contentStyle: 'list', mediaType: 'podcast' }; }
function nodes(parent: string, songs: Song[]): CarNode[] { return songs.map((song) => ({ id: `podcast-track|${encodeURIComponent(parent)}|${encodeURIComponent(song.id)}`, title: song.title, subtitle: song.artist,
  artworkUrl: song.coverArt, playable: true, mediaType: 'episode' })); }
export async function buildPodcastCarBase(): Promise<CarTree> {
  const owner = owned(), channels = await listAddedChannels(); if (!owner.current()) throw new Error('Podcast car profile changed');
  const value: Snapshot = { ...owner, channels: new Map(channels.map((channel) => [channel.id, channel])), pages: new Map() }; snapshot = value;
  return { profile: owner.profile, partial: true, nodes: {
    'tab:podcasts': [folder(shelfId('continue'), title('continue')), folder(shelfId('unplayed'), title('unplayed')), folder(shelfId('downloaded'), title('downloaded')), folder('podcast:shows', tg('Subscribed podcasts'))],
    'podcast:shows': channels.map((channel) => folder(showId(channel.id), channel.title, podcastCover(channel))),
  } };
}
function parseParent(parent: string): { kind: 'show'; channel: string; offset: number } | { kind: 'shelf'; shelf: Shelf; offset: number } | undefined {
  const parts = parent.split('|'); if (parts.length !== 3 || !/^\d{1,9}$/.test(parts[2])) return;
  const offset = Number(parts[2]); if (offset % PAGE || offset > 100_000) return;
  if (parts[0] === 'podcast-show') { try { const channel = decodeURIComponent(parts[1]); if (channel && channel.length <= 2048) return { kind: 'show', channel, offset }; } catch {} }
  if (parts[0] === 'podcast-shelf' && ['continue', 'unplayed', 'downloaded'].includes(parts[1])) return { kind: 'shelf', shelf: parts[1] as Shelf, offset };
}
/** Called by native only when the driver opens a folder. Results notify that same folder. */
export function requestPodcastCarPage(parent: string): Promise<{ tree: CarTree; current: () => boolean } | undefined> {
  const parsed = parseParent(parent); if (!parsed) return Promise.resolve(undefined);
  const key = JSON.stringify([profileScopeId(), generation, parent]), previous = pending.get(key); if (previous?.current()) return previous.task;
  const requestOwner = owned();
  const task = (async () => {
    if (!snapshot?.current()) await buildPodcastCarBase();
    if (!requestOwner.current() || !snapshot?.current()) return;
    const value = snapshot; if (value.pages.has(parent)) return;
    const current = () => requestOwner.current() && value.current() && snapshot === value;
    let songs: Song[], next: string | undefined;
    if (parsed.kind === 'show') {
      const channel = value.channels.get(parsed.channel); if (!channel) return;
      const result = await listEpisodePage(hashKey(value.profile), channel.id, { limit: PAGE, offset: parsed.offset, order: channel.showType === 'serial' ? 'added' : 'recent' }, current);
      songs = result.items.map((episode) => episodeToSong(episode, channel)); if (result.nextOffset != null) next = showId(channel.id, result.nextOffset);
    } else {
      const result = await listLibraryEpisodes(hashKey(value.profile), parsed.shelf, PAGE + 1, parsed.offset); if (!current()) return;
      songs = result.slice(0, PAGE).filter((row) => value.channels.has(row.channel.id)).map((row) => episodeToSong(row.episode, row.channel));
      if (result.length > PAGE) next = shelfId(parsed.shelf, parsed.offset + PAGE);
    }
    if (!current()) return;
    const children = nodes(parent, songs); if (next) children.push(folder(next, tg('Next episodes')));
    value.pages.set(parent, { songs, nodes: children });
    // A bounded working set: old pages remain browsable in the native tree and
    // can be reconstructed on a tap; JS does not retain an entire long feed.
    while (value.pages.size > 48) value.pages.delete(value.pages.keys().next().value!);
    return { tree: { nodes: { [parent]: children }, profile: value.profile, partial: true }, current };
  })(); pending.set(key, { task, current: requestOwner.current }); void task.finally(() => { if (pending.get(key)?.task === task) pending.delete(key); }).catch(() => {}); return task;
}
export async function handlePodcastCarPlay(mediaId: string): Promise<boolean> {
  if (!mediaId.startsWith('podcast-track|')) return false;
  const parts = mediaId.split('|'); if (parts.length !== 3) return true;
  let parent: string, id: string; try { parent = decodeURIComponent(parts[1]); id = decodeURIComponent(parts[2]); } catch { return true; }
  const requestOwner = owned(); if (!parseParent(parent)) return true;
  if (!snapshot?.current()) await buildPodcastCarBase(); if (!requestOwner.current() || !snapshot?.current()) return true;
  const value = snapshot, current = () => requestOwner.current() && value.current() && snapshot === value;
  if (!value.pages.has(parent)) await requestPodcastCarPage(parent); if (!current()) return true;
  const songs = value.pages.get(parent)?.songs ?? [], index = songs.findIndex((song) => song.id === id); if (index < 0) return true;
  // A stale native tree must never play a removed subscription.
  const subscribed = await listAddedChannels(); if (!current() || !subscribed.some((channel) => channel.id === songs[index].podcastChannelId)) return true;
  const progress = await readPodcastShowProgress(songs[index].podcastChannelId!, value.profile); if (!current()) return true;
  const resume = podcastListeningState({ id, channelId: songs[index].podcastChannelId!, title: songs[index].title, url: songs[index].url!, duration: songs[index].duration }, progress.get(id)).resume;
  await usePlayerStore.getState().playQueue(songs, index, songs[index].artist ?? tg('Podcasts'), `/podcast/${encodeURIComponent(songs[index].podcastChannelId!)}`, { ordered: true });
  if (current()) { const state = usePlayerStore.getState(); if (resume > 0 && state.queue[state.index]?.id === id) state.seekTo(resume); }
  return true;
}
