import { safeScraperProfile, validateScraperProfile, type ScraperProfile } from './config';
import { validMetadataSettings, validMetadataInsight, type MetadataKind } from './models';
import { metadataImageHeader, validMetadataImageBounds } from './imageHeader';

export interface MetadataArchive { version: 1; entries: { source: string; kind: 'settings' | 'provider' | 'insight'; id: string; value: unknown }[]; }
export const MAX_METADATA_BACKUP_IMAGE = 16 * 1024 * 1024, MAX_METADATA_BACKUP_IMAGES_TOTAL = 32 * 1024 * 1024;
export interface MetadataBackupAsset { source: string; kind: MetadataKind; id: string; mime: string; bytes: number; base64: string; }
export interface MetadataBackupOmission { source: string; kind: MetadataKind; id: string; reason: 'image-limit' | 'backup-budget' | 'unreadable' | 'unsupported'; }
export interface MetadataBackupSnapshot { version: 1; metadata: MetadataArchive; assets: MetadataBackupAsset[]; omitted: MetadataBackupOmission[]; }
export const metadataBackupIdentity = (source: unknown, id: unknown) => typeof source === 'string' && /^(server|device|folder:[a-z0-9]{1,16})$/.test(source)
  && typeof id === 'string' && id.length > 0 && id.length <= 2048 && !/[\u0000-\u001f]/.test(id);
export function validateMetadataArchive(raw: unknown): MetadataArchive {
  const value = raw as MetadataArchive;
  if (!value || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 2000 || JSON.stringify(value).length > 4_000_000) throw new Error('Invalid metadata backup');
  const identities = new Set<string>();
  for (const entry of value.entries) {
    if (!entry || !metadataBackupIdentity(entry.source, entry.id) || !['settings', 'provider', 'insight'].includes(entry.kind)) throw new Error('Invalid metadata backup entry');
    const key = JSON.stringify([entry.source, entry.kind, entry.id]); if (identities.has(key)) throw new Error('Duplicate metadata backup entry'); identities.add(key);
    if (entry.kind === 'provider') { const normalized = validateScraperProfile(entry.value), safe = safeScraperProfile(entry.value as ScraperProfile);
      if (normalized.id !== entry.id || JSON.stringify(safe) !== JSON.stringify(normalized)) throw new Error('Credentials are not supported in metadata backups'); }
    if (entry.kind === 'settings' && !validMetadataSettings(entry.value) || entry.kind === 'insight' && !validMetadataInsight(entry.value)) throw new Error('Invalid metadata backup document');
  }
  return { version: 1, entries: value.entries.map((entry) => {
    if (entry.kind === 'provider') {
      if (entry.value && typeof entry.value === 'object' && 'secrets' in entry.value) throw new Error('Credentials are not supported in metadata backups');
      return { source: entry.source, kind: entry.kind, id: entry.id, value: safeScraperProfile(entry.value as ScraperProfile) };
    }
    if (entry.kind === 'settings') {
      const settings = entry.value as import('./models').MetadataSettings;
      return { source: entry.source, kind: entry.kind, id: entry.id, value: { version: 1, onlyMissing: settings.onlyMissing, enabled: [...settings.enabled], order: [...settings.order] } };
    }
    const insight = entry.value as import('./models').MetadataInsight;
    return { source: entry.source, kind: entry.kind, id: entry.id, value: { source: insight.source, text: insight.text, url: insight.url, language: insight.language, fetchedAt: insight.fetchedAt } };
  }) };
}
export function validateMetadataBackupSnapshot(raw: unknown): MetadataBackupSnapshot {
  const value = raw as MetadataBackupSnapshot;
  if (!value || value.version !== 1 || !Array.isArray(value.assets) || value.assets.length > 1000 || !Array.isArray(value.omitted) || value.omitted.length > 1000) throw new Error('Invalid metadata artwork backup');
  const metadata = validateMetadataArchive(value.metadata), seen = new Set<string>(); let total = 0;
  for (const asset of value.assets) {
    if (!asset || !metadataBackupIdentity(asset.source, asset.id) || !['song', 'album', 'artist'].includes(asset.kind) || !Number.isInteger(asset.bytes) || asset.bytes < 10 || asset.bytes > MAX_METADATA_BACKUP_IMAGE
      || typeof asset.base64 !== 'string' || asset.base64.length > Math.ceil(MAX_METADATA_BACKUP_IMAGE / 3) * 4 || !/^[a-z\d+/]*={0,2}$/i.test(asset.base64)) throw new Error('Invalid artwork asset');
    const actual = asset.base64.length / 4 * 3 - (asset.base64.endsWith('==') ? 2 : asset.base64.endsWith('=') ? 1 : 0);
    if (asset.base64.length % 4 || actual !== asset.bytes || (total += actual) > MAX_METADATA_BACKUP_IMAGES_TOTAL) throw new Error('Invalid artwork byte count');
    const prefix = Uint8Array.from(atob(asset.base64.slice(0, Math.ceil(65536 / 3) * 4)), (character) => character.charCodeAt(0));
    const header = metadataImageHeader(prefix);
    if (!validMetadataImageBounds(header) || header!.mime !== asset.mime) throw new Error('Invalid artwork image');
    const key = JSON.stringify([asset.source, asset.kind, asset.id]); if (seen.has(key)) throw new Error('Duplicate artwork asset'); seen.add(key);
  }
  for (const entry of value.omitted) if (!entry || !metadataBackupIdentity(entry.source, entry.id) || !['song', 'album', 'artist'].includes(entry.kind)
    || !['image-limit', 'backup-budget', 'unreadable', 'unsupported'].includes(entry.reason)) throw new Error('Invalid artwork omission');
  return { version: 1, metadata, assets: value.assets.map((asset) => ({ source: asset.source, kind: asset.kind, id: asset.id, mime: asset.mime, bytes: asset.bytes, base64: asset.base64 })),
    omitted: value.omitted.map((entry) => ({ source: entry.source, kind: entry.kind, id: entry.id, reason: entry.reason })) };
}
