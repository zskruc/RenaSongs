import { fetch } from 'expo/fetch';
import { isManualOffline } from '@/api/netGate';
import { metadataCheck, metadataUrl, MetadataCancelled, type ScrapeOperation } from './models';

export class MetadataRequestError extends Error {
  code: 'network' | 'rate-limit' | 'invalid-response';
  constructor(code: MetadataRequestError['code']) { super(code); this.code = code; }
}
const MAX_RESPONSE = 5 * 1024 * 1024;
const queues = new Map<string, Promise<unknown>>(), nextRequest = new Map<string, number>();
type Transport = typeof fetch;
/** Hard deadline includes a hung response body; abort is not assumed to settle it. */
export async function readMetadataResponse(url: string, operation: ScrapeOperation, options: {
  method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number; transport?: Transport;
} = {}): Promise<string> {
  metadataCheck(operation);
  if (isManualOffline()) throw new MetadataRequestError('network');
  const valid = metadataUrl(url); if (!valid) throw new MetadataRequestError('invalid-response');
  const controller = new AbortController(), timeout = options.timeoutMs ?? 15000, limit = options.maxBytes ?? MAX_RESPONSE;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let abort!: () => void;
  const stop = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(); void reader?.cancel().catch(() => {}); reject(new MetadataCancelled()); };
    operation.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); reject(new MetadataRequestError('network')); }, timeout);
  });
  const work = async () => {
    const response = await (options.transport ?? fetch)(valid, { method: options.method ?? 'GET', headers: { 'User-Agent': 'ResonusGlass/metadata (personal music library)', ...options.headers },
      body: options.body, signal: controller.signal, redirect: 'error' });
    metadataCheck(operation);
    if (response.status === 429 || response.status === 503) throw new MetadataRequestError('rate-limit');
    if (!response.ok) throw new MetadataRequestError('network');
    if (Number(response.headers.get('content-length')) > limit) throw new MetadataRequestError('invalid-response');
    if (!response.body?.getReader) { const text = await response.text(); if (text.length * 2 > limit) throw new MetadataRequestError('invalid-response'); return text; }
    reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '', bytes = 0;
    while (true) {
      metadataCheck(operation); const chunk = await reader.read(); metadataCheck(operation);
      if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > limit) throw new MetadataRequestError('invalid-response');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  };
  try { const text = await Promise.race([work(), stop]); metadataCheck(operation); return text; }
  catch (error) { metadataCheck(operation); if (error instanceof MetadataRequestError || error instanceof MetadataCancelled) throw error; throw new MetadataRequestError('network'); }
  finally { if (timer) clearTimeout(timer); operation.signal?.removeEventListener('abort', abort); controller.abort(); void reader?.cancel().catch(() => {}); }
}
/** A common quota for settings/manual/batch callers. No background interval. */
export async function metadataRequest(key: string, url: string, operation: ScrapeOperation, options: Parameters<typeof readMetadataResponse>[2] & { interval?: number } = {}): Promise<string> {
  const prior = queues.get(key) ?? Promise.resolve();
  const task = prior.catch(() => {}).then(async () => {
    metadataCheck(operation);
    const wait = Math.max(0, (nextRequest.get(key) ?? 0) - Date.now());
    if (wait) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new MetadataCancelled()); };
      const timer = setTimeout(() => { operation.signal?.removeEventListener('abort', abort); resolve(); }, wait);
      operation.signal?.addEventListener('abort', abort, { once: true });
    });
    metadataCheck(operation); nextRequest.set(key, Date.now() + (options.interval ?? (key === 'musicbrainz' ? 1100 : 300)));
    try { return await readMetadataResponse(url, operation, options); }
    catch (error) { if (error instanceof MetadataRequestError && error.code === 'rate-limit') nextRequest.set(key, Date.now() + 60000); throw error; }
  });
  queues.set(key, task); void task.finally(() => { if (queues.get(key) === task) queues.delete(key); }).catch(() => {});
  return task;
}
export async function metadataJson<T>(key: string, url: string, operation: ScrapeOperation, options?: Parameters<typeof metadataRequest>[3]): Promise<T> {
  const text = await metadataRequest(key, url, operation, options);
  try { return JSON.parse(text) as T; } catch { throw new MetadataRequestError('invalid-response'); }
}
