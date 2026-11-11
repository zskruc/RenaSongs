import { metadataJson } from './request';
import { metadataCheck, metadataText, type MetadataInsight, type MetadataKind, type ScrapeOperation } from './models';
import { saveMetadataRecord } from './repository';

const uuid = (value: unknown) => typeof value === 'string' && /^[a-f\d-]{36}$/i.test(value) ? value : undefined;
/** Biography identity is selected explicitly; no same-name automatic overwrite. */
export async function findMetadataInsightCandidates(kind: 'artist' | 'album', name: string, artist: string | undefined, operation: ScrapeOperation): Promise<{ id: string; title: string; detail: string }[]> {
  const entity = kind === 'artist' ? 'artist' : 'release-group';
  const escape = (text: string) => text.replace(/["\\]/g, '\\$&');
  const query = `${entity}:"${escape(name)}"${artist && kind === 'album' ? ` AND artist:"${escape(artist)}"` : ''}`;
  const data = await metadataJson<Record<string, any>>('musicbrainz', `https://musicbrainz.org/ws/2/${entity}/?${new URLSearchParams({ query, fmt: 'json', limit: '15' })}`, operation);
  return (data[kind === 'artist' ? 'artists' : 'release-groups'] ?? []).flatMap((entry: Record<string, any>) => uuid(entry.id) ? [{ id: entry.id,
    title: metadataText(entry.name ?? entry.title) ?? name, detail: [entry.disambiguation, entry.country, entry['first-release-date'], entry['artist-credit']?.map((item: Record<string, any>) => item.name ?? item.artist?.name).join(' / ')].filter(Boolean).join(' · ') }] : []);
}
export async function loadMetadataInsight(kind: Exclude<MetadataKind, 'song'>, id: string, musicBrainzId: string, language: string, operation: ScrapeOperation): Promise<MetadataInsight> {
  if (!uuid(musicBrainzId)) throw new Error('Invalid MusicBrainz identity');
  const entity = kind === 'artist' ? 'artist' : 'release-group';
  const data = await metadataJson<Record<string, any>>('musicbrainz', `https://musicbrainz.org/ws/2/${entity}/${musicBrainzId}?inc=url-rels&fmt=json`, operation);
  let wiki: URL | undefined;
  for (const relation of data.relations ?? []) {
    try { const location = new URL(relation.url?.resource); if (location.protocol === 'https:' && /^[a-z-]+\.wikipedia\.org$/.test(location.hostname) && location.pathname.startsWith('/wiki/')) { wiki = location; break; } } catch { /* Not a Wikipedia relation. */ }
  }
  if (!wiki) {
    const wikidata = (data.relations ?? []).map((relation: Record<string, any>) => relation.url?.resource).find((value: unknown) => typeof value === 'string' && /^https:\/\/www\.wikidata\.org\/wiki\/Q\d+$/.test(value));
    if (wikidata) {
      const q = wikidata.split('/').pop(); const details = await metadataJson<Record<string, any>>('wikidata', `https://www.wikidata.org/wiki/Special:EntityData/${q}.json`, operation);
      const lang = language.toLowerCase().startsWith('zh') ? 'zh' : language.split('-')[0].toLowerCase();
      const sites = details.entities?.[q]?.sitelinks;
      const chosen = sites?.[`${lang}wiki`]?.url ?? sites?.enwiki?.url;
      if (chosen && /^https:\/\/[a-z-]+\.wikipedia\.org\/wiki\//.test(chosen)) wiki = new URL(chosen);
    }
  }
  if (!wiki) throw new Error('No sourced biography is available');
  const title = decodeURIComponent(wiki.pathname.slice('/wiki/'.length));
  const summary = await metadataJson<{ extract?: string; content_urls?: { desktop?: { page?: string } } }>('wikipedia', `https://${wiki.hostname}/api/rest_v1/page/summary/${encodeURIComponent(title)}`, operation);
  const text = metadataText(summary.extract, 32000); if (!text) throw new Error('No sourced biography is available');
  metadataCheck(operation);
  const value: MetadataInsight = { text, url: wiki.href, source: 'Wikipedia', language: wiki.hostname.split('.')[0], fetchedAt: Date.now() };
  await saveMetadataRecord('insight', `${kind}:${id}`, value, operation); return value;
}
