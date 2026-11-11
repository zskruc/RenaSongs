import * as FileSystem from 'expo-file-system/legacy';
import { hashKey } from '@/lib/localLibrary';
import { isManualOffline } from '@/api/netGate';
import { metadataCheck, metadataUrl, MetadataCancelled, type MetadataArtwork, type MetadataKind, type ScrapeOperation } from './models';
import { readMetadataRecord, saveMetadataRecord } from './repository';
import { metadataImageHeader, validMetadataImageBounds } from './imageHeader';
export { metadataImageHeader } from './imageHeader';

const MAX_BYTES = 20 * 1024 * 1024;
const directory = (operation: ScrapeOperation) => `${FileSystem.documentDirectory}metadata-artwork/${hashKey(operation.scope.profile)}/${hashKey(operation.scope.source)}/`;
async function finishArtwork(temporary: string, kind: MetadataKind, id: string, operation: ScrapeOperation): Promise<MetadataArtwork> {
  metadataCheck(operation); const info = await FileSystem.getInfoAsync(temporary); metadataCheck(operation);
  if (!info.exists || info.isDirectory || !info.size || info.size > MAX_BYTES) throw new Error('Image must be smaller than 20 MiB');
  const prefix = await FileSystem.readAsStringAsync(temporary, { encoding: FileSystem.EncodingType.Base64, position: 0, length: Math.min(65536, info.size) }); metadataCheck(operation);
  const header = metadataImageHeader(Uint8Array.from(atob(prefix), (character) => character.charCodeAt(0)));
  if (!validMetadataImageBounds(header)) throw new Error('Unsupported or oversized artwork');
  const previous = await readMetadataRecord<MetadataArtwork>('artwork', `${kind}:${id}`, operation);
  const uri = `${directory(operation)}${kind}-${hashKey(id)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${header!.extension}`;
  await FileSystem.makeDirectoryAsync(directory(operation), { intermediates: true }); metadataCheck(operation);
  await FileSystem.copyAsync({ from: temporary, to: uri });
  try {
    metadataCheck(operation); const value = { uri, bytes: info.size, mime: header!.mime, updatedAt: Date.now() };
    await saveMetadataRecord('artwork', `${kind}:${id}`, value, operation);
    if (previous?.uri.startsWith(directory(operation))) void FileSystem.deleteAsync(previous.uri, { idempotent: true }).catch(() => {});
    return value;
  } catch (error) { void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}); throw error; }
}
export async function savePickedMetadataArtwork(uri: string, kind: MetadataKind, id: string, operation: ScrapeOperation): Promise<MetadataArtwork> {
  if (!/^(file|content):/i.test(uri)) throw new Error('Choose a local image'); return finishArtwork(uri, kind, id, operation);
}
export async function fetchMetadataArtwork(url: string, kind: MetadataKind, id: string, operation: ScrapeOperation): Promise<MetadataArtwork> {
  metadataCheck(operation); if (isManualOffline() || !metadataUrl(url)) throw new Error('Artwork is unavailable offline');
  await FileSystem.makeDirectoryAsync(directory(operation), { intermediates: true }); metadataCheck(operation);
  const temporary = `${directory(operation)}part-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.tmp`;
  let stop!: () => void, timeout: ReturnType<typeof setTimeout> | undefined;
  const download = FileSystem.createDownloadResumable(url, temporary, {}, (progress) => { if (progress.totalBytesWritten > MAX_BYTES || progress.totalBytesExpectedToWrite > MAX_BYTES || !operation.current()) stop(); });
  const cancelled = new Promise<never>((_, reject) => {
    stop = () => { void download.cancelAsync().catch(() => {}); reject(new MetadataCancelled()); };
    operation.signal?.addEventListener('abort', stop, { once: true }); timeout = setTimeout(stop, 15000);
  });
  const native = download.downloadAsync();
  try {
    const result = await Promise.race([native, cancelled]); metadataCheck(operation);
    if (!result || result.status < 200 || result.status >= 300) throw new Error('Could not load artwork');
    return await finishArtwork(temporary, kind, id, operation);
  } finally {
    if (timeout) clearTimeout(timeout); operation.signal?.removeEventListener('abort', stop);
    void download.cancelAsync().catch(() => {});
    void native.finally(() => FileSystem.deleteAsync(temporary, { idempotent: true })).catch(() => {});
  }
}
export async function restoreMetadataArtwork(kind: MetadataKind, id: string, operation: ScrapeOperation): Promise<void> {
  const previous = await readMetadataRecord<MetadataArtwork>('artwork', `${kind}:${id}`, operation);
  await saveMetadataRecord('artwork', `${kind}:${id}`, undefined, operation);
  if (previous?.uri.startsWith(directory(operation))) void FileSystem.deleteAsync(previous.uri, { idempotent: true }).catch(() => {});
}
