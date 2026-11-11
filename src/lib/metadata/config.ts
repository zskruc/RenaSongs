import { metadataText, metadataUrl } from './models';

export type MetadataCapability = 'metadata' | 'cover' | 'lyrics';
export interface MetadataEndpoint {
  url: string; method?: 'GET' | 'POST'; params?: Record<string, string>; body?: unknown; headers?: Record<string, string>;
  items?: string; fields?: Partial<Record<'id' | 'title' | 'artist' | 'albumArtist' | 'album' | 'year' | 'track' | 'discNumber' | 'genres' | 'duration' | 'cover' | 'lyrics', string>>;
  format?: 'json' | 'lrc' | 'ttml'; script?: string;
}
export interface ScraperProfile { version: 1; id: string; name: string; enabled: boolean; priority: number; capabilities: MetadataCapability[];
  rateLimitMs: number; search?: MetadataEndpoint; detail?: MetadataEndpoint; cover?: MetadataEndpoint; lyrics?: MetadataEndpoint;
  lyricsFallback?: { url: string; contentField: string; encoding: 'base64UTF8' | 'utf8'; requiredVariables?: string[] }; }
const object = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype.constructor?.name === 'Object' && Object.getPrototypeOf(prototype) === null;
};
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const privateName = /^(authorization|cookie|token|access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret|key)$/i;
const placeholder = /\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/;
export const publicMetadataHeader = (name: string) => /^(accept|content-type|user-agent|accept-language)$/i.test(name);
export function jsonMetadataPath(value: unknown, path: string): unknown {
  if (path === '' || path === '$') return value;
  const segments = path.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.');
  if (segments.length > 15 || segments.some((part) => !part || forbidden.has(part))) return undefined;
  let item = value;
  for (const segment of segments) {
    if (!item || typeof item !== 'object' || !Object.prototype.hasOwnProperty.call(item, segment)) return;
    item = (item as Record<string, unknown>)[segment];
  }
  return item;
}
export function expandMetadataTemplate(template: string, variables: Record<string, string>, encode = true): string {
  return template.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_, key: string) => encode ? encodeURIComponent(variables[key] ?? '') : variables[key] ?? '');
}
export function validateScraperProfile(value: unknown): ScraperProfile {
  if (!object(value) || !Number.isInteger(value.version) || Number(value.version) < 1 || !/^[a-zA-Z0-9_-]{1,80}$/.test(String(value.id)) || !metadataText(value.name, 100)
    || !Array.isArray(value.capabilities) || value.capabilities.length > 4 || value.capabilities.some((entry) => !['metadata', 'cover', 'lyrics', 'lyricsWordLevel'].includes(entry))
    || JSON.stringify(value).length > 131072) throw new Error('Invalid scraper configuration');
  const endpoint = (raw: unknown): MetadataEndpoint | undefined => {
    if (raw === undefined) return;
    if (!object(raw)) throw new Error('Invalid endpoint');
    if (raw.script !== undefined && (typeof raw.script !== 'string' || raw.script.length > 200000)) throw new Error('Invalid parsing script');
    const url = String(raw.url ?? '');
    if (!metadataUrl(url.replace(/\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/g, 'value')) || !/^https?:\/\//i.test(url)) throw new Error('Use an HTTP or HTTPS endpoint');
    if (raw.method !== undefined && !['GET', 'POST'].includes(String(raw.method))) throw new Error('Invalid endpoint method');
    const parsedUrl = new URL(url.replace(/\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/g, 'value'));
    for (const [key] of parsedUrl.searchParams) if (privateName.test(key)) {
      const original = new URL(url).searchParams.get(key) ?? '';
      if (original && !placeholder.test(original)) throw new Error('Put private query values in local secrets');
    }
    const strings = (entry: unknown): Record<string, string> | undefined => {
      if (entry === undefined) return;
      if (!object(entry) || Object.keys(entry).length > 40 || Object.entries(entry).some(([key, val]) => forbidden.has(key) || typeof val !== 'string' || key.length > 100 || val.length > 8192)) throw new Error('Invalid endpoint mapping');
      return entry as Record<string, string>;
    };
    const fields = strings(raw.fields);
    const params = strings(raw.params);
    if (Object.entries(params ?? {}).some(([name, value]) => privateName.test(name) && value && !placeholder.test(value))) throw new Error('Put private query values in local secrets');
    const bodyValue = raw.body ?? raw.bodyTemplate;
    let parsedBody = bodyValue;
    if (typeof bodyValue === 'string') { try { parsedBody = JSON.parse(bodyValue); } catch { /* A non-JSON POST body may be intentional. */ } }
    const pendingBody = [{ value: parsedBody, depth: 0 }]; let inspectedBody = 0;
    while (pendingBody.length) {
      const next = pendingBody.pop()!; if (++inspectedBody > 3000 || next.depth > 20) throw new Error('Request body is too complex');
      if (!next.value || typeof next.value !== 'object') continue;
      for (const [name, value] of Object.entries(next.value)) {
        if (privateName.test(name) && value && !(typeof value === 'string' && placeholder.test(value))) throw new Error('Put private body values in local secrets');
        if (value && typeof value === 'object') pendingBody.push({ value, depth: next.depth + 1 });
      }
    }
    if (fields && Object.values(fields).some((path) => path.length > 200 || /(?:__proto__|prototype|constructor)/.test(path))) throw new Error('Invalid response path');
    if (raw.items !== undefined && (typeof raw.items !== 'string' || raw.items.length > 200)) throw new Error('Invalid result path');
    if (raw.format !== undefined && !['json', 'lrc', 'ttml'].includes(String(raw.format))) throw new Error('Invalid lyrics format');
    const headers = { ...strings(value.headers), ...strings(raw.headers) };
    return { url, method: raw.method as 'GET' | 'POST' | undefined, params, headers,
      ...(raw.body === undefined && raw.bodyTemplate === undefined ? {} : { body: raw.body ?? raw.bodyTemplate }), items: raw.items as string | undefined,
      fields: fields as MetadataEndpoint['fields'], format: raw.format as MetadataEndpoint['format'], script: raw.script as string | undefined };
  };
  const search = endpoint(value.search), detail = endpoint(value.detail), cover = endpoint(value.cover), lyrics = endpoint(value.lyrics);
  if (typeof value.cookie === 'string' && value.cookie.length <= 8192) for (const item of [search, detail, cover, lyrics]) if (item) item.headers = { ...item.headers, Cookie: value.cookie };
  if (!search && !lyrics) throw new Error('Add a search or lyrics endpoint');
  let lyricsFallback: ScraperProfile['lyricsFallback'];
  if (value.lyricsFallback !== undefined) {
    const fallback = value.lyricsFallback;
    if (!object(fallback) || !metadataUrl(String(fallback.url ?? '').replace(/\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/g, 'value'))
      || typeof fallback.contentField !== 'string' || fallback.contentField.length > 200 || !['base64UTF8', 'utf8'].includes(String(fallback.encoding))
      || fallback.requiredVariables !== undefined && (!Array.isArray(fallback.requiredVariables) || fallback.requiredVariables.length > 20 || fallback.requiredVariables.some((key) => typeof key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)))) throw new Error('Invalid lyric fallback');
    const checked = endpoint({ url: fallback.url });
    lyricsFallback = { url: checked!.url, contentField: fallback.contentField, encoding: fallback.encoding as 'base64UTF8' | 'utf8', requiredVariables: fallback.requiredVariables as string[] | undefined };
  }
  return { version: 1, id: String(value.id), name: metadataText(value.name, 100)!, enabled: value.enabled !== false,
    priority: Math.max(0, Math.min(1000, Number(value.priority) || 0)), capabilities: [...new Set(value.capabilities.map((entry) => entry === 'lyricsWordLevel' ? 'lyrics' : entry))] as MetadataCapability[],
    rateLimitMs: Math.max(300, Math.min(60000, Number(value.rateLimitMs ?? value.rateLimit) || 1000)), search, detail, cover, lyrics, lyricsFallback };
}
export function safeScraperProfile(value: ScraperProfile): ScraperProfile {
  const config = validateScraperProfile(value);
  for (const key of ['search', 'detail', 'cover', 'lyrics'] as const) if (config[key]) {
    const headers = Object.fromEntries(Object.entries(config[key]!.headers ?? {}).filter(([name]) => publicMetadataHeader(name)));
    config[key] = { ...config[key]!, headers };
  }
  return config;
}
export function scraperImportSummary(config: ScraperProfile, imported?: unknown): { domains: string[]; methods: string[]; schemes: string[]; sensitiveHeaders: boolean } {
  const endpoints = [config.search, config.detail, config.cover, config.lyrics].filter((entry): entry is MetadataEndpoint => !!entry);
  const extras = [config.lyricsFallback?.url];
  if (object(imported) && object(imported.secrets) && typeof imported.secrets.lyricsFetchUrl === 'string') extras.push(imported.secrets.lyricsFetchUrl);
  const locations = [...endpoints.map((entry) => entry.url), ...extras.filter((entry): entry is string => !!entry)].map((entry) => new URL(entry.replace(/\{\{[^}]+\}\}/g, 'value')));
  return { domains: [...new Set(locations.map((entry) => entry.hostname))],
    schemes: [...new Set(locations.map((entry) => entry.protocol === 'https:' ? 'HTTPS' : 'HTTP'))],
    methods: [...new Set(endpoints.map((entry) => entry.method ?? 'GET'))],
    sensitiveHeaders: endpoints.some((entry) => Object.keys(entry.headers ?? {}).some((name) => !publicMetadataHeader(name))) };
}
