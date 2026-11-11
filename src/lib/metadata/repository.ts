/** Serialized, account/source fenced App-only metadata records. */
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuthStore } from '@/store/auth';
import { mediaCacheDatabase } from '@/lib/mediaCacheDb';
import { hashKey } from '@/lib/localLibrary';
import { captureCustomizationOwner, customizationScope, type CustomizationScope } from '@/lib/localCustomizations';
import { publicMetadataHeader, safeScraperProfile, validateScraperProfile, type ScraperProfile } from './config';
import { metadataCheck, validMetadataInsight, validMetadataSettings, type ScrapeOperation } from './models';
import { clearMetadataArtworkRegistry } from './artworkRegistry';
import { validateMetadataArchive as validateArchive, type MetadataArchive } from './archiveModels';
export type { MetadataArchive } from './archiveModels';

export type MetadataRecordKind = 'settings' | 'provider' | 'artwork' | 'insight' | 'job' | 'undo';
const kinds: MetadataRecordKind[] = ['settings', 'provider', 'artwork', 'insight', 'job', 'undo'];
const ready = new WeakMap<object, Promise<void>>(), writes = new Map<string, Promise<unknown>>(), versions = new Map<string, number>();
const retired = new Map<string, object | null>();
let generation = 0;
let visualRevision = 0;
const subscribers = new Set<() => void>();
export function subscribeMetadataRecords(listener: () => void) { subscribers.add(listener); return () => { subscribers.delete(listener); }; }
export function metadataRecordsRevision() { return generation; }
export function metadataVisualRevision() { return visualRevision; }
function notify(kind?: MetadataRecordKind) { generation++; if (!kind || kind === 'artwork' || kind === 'insight') visualRevision++; for (const listener of subscribers) listener(); }
const checkIdentity = (id: string) => { if (!id || id.length > 2048 || /[\u0000-\u001f]/.test(id)) throw new Error('Invalid metadata identity'); };
export function metadataOperation(scope = customizationScope(), signal?: AbortSignal, extra = () => true): ScrapeOperation {
  const owns = captureCustomizationOwner(scope, extra), token = versions.get(scope.profile) ?? 0;
  const auth = useAuthStore.getState().auth ?? useAuthStore.getState().offlineSource;
  return { scope, signal, current: () => owns() && (versions.get(scope.profile) ?? 0) === token && (!retired.has(scope.profile) || retired.get(scope.profile) !== auth) };
}
async function database(scope: CustomizationScope) {
  const db = await mediaCacheDatabase(hashKey(scope.profile));
  let task = ready.get(db);
  if (!task) { task = db.execAsync(`CREATE TABLE IF NOT EXISTS metadata_records(source TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(source,kind,id));
    CREATE INDEX IF NOT EXISTS metadata_records_recent ON metadata_records(source,kind,updated_at DESC);
    CREATE TABLE IF NOT EXISTS metadata_credentials(source TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(source,id));`).catch((error) => { ready.delete(db); throw error; }); ready.set(db, task); }
  await task; return db;
}
function serial<T>(profile: string, work: () => Promise<T>): Promise<T> {
  const task = (writes.get(profile) ?? Promise.resolve()).catch(() => {}).then(work); writes.set(profile, task);
  void task.finally(() => { if (writes.get(profile) === task) writes.delete(profile); }).catch(() => {}); return task;
}
export async function readMetadataRecord<T>(kind: MetadataRecordKind, id: string, operation = metadataOperation()): Promise<T | undefined> {
  metadataCheck(operation); checkIdentity(id); const db = await database(operation.scope); metadataCheck(operation);
  await writes.get(operation.scope.profile)?.catch(() => {}); metadataCheck(operation);
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM metadata_records WHERE source=? AND kind=? AND id=?', operation.scope.source, kind, id);
  metadataCheck(operation); return row ? JSON.parse(row.data) as T : undefined;
}
export async function listMetadataRecords<T>(kind: MetadataRecordKind, operation = metadataOperation(), limit = 20): Promise<{ id: string; value: T }[]> {
  metadataCheck(operation); const db = await database(operation.scope); metadataCheck(operation);
  await writes.get(operation.scope.profile)?.catch(() => {}); metadataCheck(operation);
  const rows = await db.getAllAsync<{ id: string; data: string }>('SELECT id,data FROM metadata_records WHERE source=? AND kind=? ORDER BY updated_at DESC LIMIT ?', operation.scope.source, kind, Math.max(1, Math.min(1000, limit)));
  metadataCheck(operation); return rows.map((row) => ({ id: row.id, value: JSON.parse(row.data) as T }));
}
export async function saveMetadataRecord(kind: MetadataRecordKind, id: string, value: unknown | undefined, operation = metadataOperation()): Promise<void> {
  checkIdentity(id); if (!kinds.includes(kind)) throw new Error('Invalid metadata kind');
  if (value !== undefined && (kind === 'settings' && !validMetadataSettings(value) || kind === 'insight' && !validMetadataInsight(value))) throw new Error('Invalid metadata document');
  const text = value === undefined ? undefined : JSON.stringify(value);
  if (text && text.length > (kind === 'job' ? 2_000_000 : 1_500_000)) throw new Error('Metadata record is too large');
  metadataCheck(operation);
  await serial(operation.scope.profile, async () => {
    metadataCheck(operation); const db = await database(operation.scope); metadataCheck(operation);
    await commitRecord(db, kind, id, text, operation); notify(kind);
  });
}
async function commitRecord(db: Awaited<ReturnType<typeof database>>, kind: MetadataRecordKind, id: string, text: string | undefined, operation: ScrapeOperation, didCommit?: () => void) {
  await db.withExclusiveTransactionAsync(async (transaction) => {
    metadataCheck(operation);
    if (text === undefined) await transaction.runAsync('DELETE FROM metadata_records WHERE source=? AND kind=? AND id=?', operation.scope.source, kind, id);
    else await transaction.runAsync('INSERT OR REPLACE INTO metadata_records(source,kind,id,data,updated_at) VALUES(?,?,?,?,?)', operation.scope.source, kind, id, text, Date.now());
    metadataCheck(operation);
  }); didCommit?.(); metadataCheck(operation);
}
const scraperRecipe = (profile: ScraperProfile | undefined) => profile ? JSON.stringify([profile.search, profile.detail, profile.cover, profile.lyrics, profile.lyricsFallback]) : '';
function credentialKey(scope: CustomizationScope, id: string) { return `metadata.${hashKey(scope.profile)}.${hashKey(scope.source)}.${id}`; }
export async function scraperCredentials(id: string, operation = metadataOperation()): Promise<{ headers?: Record<string, Record<string, string>>; secrets?: Record<string, string> }> {
  metadataCheck(operation); const text = await SecureStore.getItemAsync(credentialKey(operation.scope, id)); metadataCheck(operation);
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error('Invalid stored scraper credentials'); }
}
/** Secret-bearing headers are accepted only into SecureStore, not task/backup JSON. */
export async function saveScraperProfile(raw: unknown, operation = metadataOperation()): Promise<ScraperProfile> {
  const config = validateScraperProfile(raw), safe = safeScraperProfile(config);
  if (['itunes', 'musicbrainz', 'lrclib', 'amll'].includes(config.id)) throw new Error('Source ID is reserved');
  return serial(operation.scope.profile, async () => {
    metadataCheck(operation); const db = await database(operation.scope), key = credentialKey(operation.scope, config.id);
    const previousText = await SecureStore.getItemAsync(key); metadataCheck(operation);
    const previous = previousText ? JSON.parse(previousText) as Awaited<ReturnType<typeof scraperCredentials>> : {};
    const priorRow = await db.getFirstAsync<{ data: string }>("SELECT data FROM metadata_records WHERE source=? AND kind='provider' AND id=?", operation.scope.source, config.id); metadataCheck(operation);
    const priorConfig = priorRow ? safeScraperProfile(JSON.parse(priorRow.data)) : undefined;
    const sameRecipe = scraperRecipe(priorConfig) === scraperRecipe(safe);
    const headers = { ...(sameRecipe ? previous.headers : {}) };
    for (const name of ['search', 'detail', 'cover', 'lyrics'] as const) {
      const sensitive = Object.fromEntries(Object.entries(config[name]?.headers ?? {}).filter(([header]) => !publicMetadataHeader(header)));
      if (Object.keys(sensitive).length) headers[name] = sensitive;
    }
    const secrets = raw && typeof raw === 'object' && 'secrets' in raw ? (raw as { secrets: unknown }).secrets : sameRecipe ? previous.secrets : undefined;
    if (secrets !== undefined && (!secrets || typeof secrets !== 'object' || Array.isArray(secrets) || Object.keys(secrets).length > 30
      || Object.entries(secrets).some(([name, value]) => name.length > 100 || typeof value !== 'string' || value.length > 8192))) throw new Error('Invalid scraper secrets');
    // A durable key registry lets account deletion remove a key even after a
    // crash between secure storage and the public configuration commit.
    await db.withExclusiveTransactionAsync(async (tx) => { metadataCheck(operation); await tx.runAsync('INSERT OR IGNORE INTO metadata_credentials(source,id) VALUES(?,?)', operation.scope.source, config.id); metadataCheck(operation); });
    let committed = false;
    try {
      await SecureStore.setItemAsync(key, JSON.stringify({ headers, secrets })); metadataCheck(operation);
      await commitRecord(db, 'provider', config.id, JSON.stringify(safe), operation, () => { committed = true; }); notify('provider'); return safe;
    } catch (error) {
      // This profile's queue excludes a newer edit; compensate before cleanup
      // or the next accepted writer is allowed to run.
      // Once SQL committed, the credentials must keep matching the committed
      // recipe even when the caller lost ownership immediately after COMMIT.
      if (!committed) {
        if (previousText) await SecureStore.setItemAsync(key, previousText).catch(() => {});
        else await SecureStore.deleteItemAsync(key).catch(() => {});
      }
      throw error;
    }
  });
}
export async function deleteScraperProfile(id: string, current?: () => boolean): Promise<void> {
  checkIdentity(id); const operation = metadataOperation(undefined, undefined, current);
  await serial(operation.scope.profile, async () => {
    metadataCheck(operation); const db = await database(operation.scope);
    await commitRecord(db, 'provider', id, undefined, operation); notify('provider');
    await SecureStore.deleteItemAsync(credentialKey(operation.scope, id)); metadataCheck(operation);
    await db.runAsync('DELETE FROM metadata_credentials WHERE source=? AND id=?', operation.scope.source, id);
  });
}
export async function exportScraperProfileSafe(id: string, current?: () => boolean): Promise<ScraperProfile> {
  const value = await readMetadataRecord<ScraperProfile>('provider', id, metadataOperation(undefined, undefined, current));
  if (!value) throw new Error('Scraper not found'); return safeScraperProfile(value);
}
export async function restoreScraperProfile(payload: unknown, current?: () => boolean, restoredId?: string): Promise<string> {
  const value = safeScraperProfile(validateScraperProfile(payload)), operation = metadataOperation(undefined, undefined, current);
  const id = restoredId ?? `${value.id.slice(0, 50)}_restored_${Date.now().toString(36)}`;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid restored source ID');
  const candidate = safeScraperProfile({ ...value, id });
  return serial(operation.scope.profile, async () => {
    metadataCheck(operation); const db = await database(operation.scope); metadataCheck(operation);
    const existing = await db.getFirstAsync<{ data: string }>("SELECT data FROM metadata_records WHERE source=? AND kind='provider' AND id=?", operation.scope.source, id); metadataCheck(operation);
    if (existing) { if (JSON.stringify(safeScraperProfile(JSON.parse(existing.data))) !== JSON.stringify(candidate)) throw new Error('Restored source was edited. Review again.'); return id; }
    await commitRecord(db, 'provider', id, JSON.stringify(candidate), operation); notify('provider'); return id;
  });
}
export async function clearMetadataProfile(profile: string): Promise<void> {
  versions.set(profile, (versions.get(profile) ?? 0) + 1); retired.set(profile, useAuthStore.getState().auth ?? useAuthStore.getState().offlineSource); notify();
  clearMetadataArtworkRegistry(profile);
  await serial(profile, async () => {
    const db = await database({ profile, source: 'server' });
    const profiles = await db.getAllAsync<{ source: string; id: string }>("SELECT source,id FROM metadata_credentials UNION SELECT source,id FROM metadata_records WHERE kind='provider'");
    for (const row of profiles) await SecureStore.deleteItemAsync(credentialKey({ profile, source: row.source }, row.id));
    await db.runAsync('DELETE FROM metadata_records');
    await db.runAsync('DELETE FROM metadata_credentials');
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}metadata-artwork/${hashKey(profile)}/`, { idempotent: true });
  });
}
export async function exportMetadataProfile(profile: string, current = () => true): Promise<MetadataArchive> {
  const token = versions.get(profile) ?? 0; const owns = () => current() && (versions.get(profile) ?? 0) === token;
  if (!owns()) throw new Error('Metadata owner changed'); await writes.get(profile)?.catch(() => {});
  const db = await database({ profile, source: 'server' });
  const rows = await db.getAllAsync<{ source: string; kind: MetadataArchive['entries'][number]['kind']; id: string; data: string }>("SELECT source,kind,id,data FROM metadata_records WHERE kind IN ('settings','provider','insight') ORDER BY source,kind,id LIMIT 2001");
  if (!owns() || rows.length > 2000) throw new Error('Metadata backup limit');
  return validateMetadataArchive({ version: 1, entries: rows.map((row) => ({ source: row.source, kind: row.kind, id: row.id,
    value: row.kind === 'provider' ? safeScraperProfile(JSON.parse(row.data)) : JSON.parse(row.data) })) });
}
export function validateMetadataArchive(raw: unknown): MetadataArchive {
  return validateArchive(raw);
}
export async function metadataArtworkReferences(profile: string, current: () => boolean): Promise<{ source: string; id: string; value: unknown }[]> {
  const token = versions.get(profile) ?? 0; await writes.get(profile)?.catch(() => {});
  if (!current() || (versions.get(profile) ?? 0) !== token) throw new Error('Metadata owner changed'); const db = await database({ profile, source: 'server' });
  const rows = await db.getAllAsync<{ source: string; id: string; data: string }>("SELECT source,id,data FROM metadata_records WHERE kind='artwork' ORDER BY source,id LIMIT 1001");
  if (!current() || (versions.get(profile) ?? 0) !== token || rows.length > 1000) throw new Error('Metadata artwork backup limit');
  return rows.map((row) => ({ source: row.source, id: row.id, value: JSON.parse(row.data) }));
}
export async function restoreMetadataProfile(profile: string, raw: unknown, current: () => boolean): Promise<void> {
  const value = validateMetadataArchive(raw), owner = metadataOperation(), token = versions.get(profile) ?? 0;
  const owns = () => current() && owner.current() && owner.scope.profile === profile && (versions.get(profile) ?? 0) === token;
  await serial(profile, async () => {
    if (!owns()) throw new Error('Metadata owner changed'); const db = await database(owner.scope);
    const changedCredentials: { key: string; previous: string | null }[] = []; let committed = false;
    try {
      for (const entry of value.entries) {
        if (entry.kind !== 'provider') continue;
        const prior = await db.getFirstAsync<{ data: string }>("SELECT data FROM metadata_records WHERE source=? AND kind='provider' AND id=?", entry.source, entry.id);
        if (!owns()) throw new Error('Metadata owner changed');
        if (scraperRecipe(prior ? safeScraperProfile(JSON.parse(prior.data)) : undefined) === scraperRecipe(entry.value as ScraperProfile)) continue;
        const key = credentialKey({ profile, source: entry.source }, entry.id), previous = await SecureStore.getItemAsync(key);
        if (!owns()) throw new Error('Metadata owner changed');
        changedCredentials.push({ key, previous }); await SecureStore.deleteItemAsync(key);
      }
      await db.withExclusiveTransactionAsync(async (tx) => {
        for (const entry of value.entries) {
          if (!owns()) throw new Error('Metadata owner changed');
          await tx.runAsync('INSERT OR REPLACE INTO metadata_records(source,kind,id,data,updated_at) VALUES(?,?,?,?,?)', entry.source, entry.kind, entry.id, JSON.stringify(entry.value), Date.now());
        }
        if (!owns()) throw new Error('Metadata owner changed');
      }); committed = true;
      if (!owns()) throw new Error('Metadata owner changed'); notify();
    } catch (error) {
      if (!committed) for (const item of changedCredentials) {
        if (item.previous) await SecureStore.setItemAsync(item.key, item.previous).catch(() => {});
        else await SecureStore.deleteItemAsync(item.key).catch(() => {});
      }
      throw error;
    }
  });
}
