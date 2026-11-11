import * as FileSystem from 'expo-file-system/legacy';
import { hashKey } from '@/lib/localLibrary';
import { customizationScope } from '@/lib/localCustomizations';
import { exportMetadataProfile, metadataArtworkReferences, metadataOperation, restoreMetadataProfile } from './repository';
import { savePickedMetadataArtwork } from './artwork';
import { MAX_METADATA_BACKUP_IMAGE, MAX_METADATA_BACKUP_IMAGES_TOTAL, validateMetadataBackupSnapshot, metadataBackupIdentity,
  type MetadataBackupAsset, type MetadataBackupSnapshot, type MetadataBackupOmission } from './archiveModels';
import { metadataCheck, type MetadataArtwork, type MetadataKind } from './models';

/** Explicit export only. Its budget is the remaining space in the personal backup. */
export async function exportMetadataBackup(profile: string, current: () => boolean, encodedBudget = 38_000_000): Promise<MetadataBackupSnapshot> {
  const metadata = await exportMetadataProfile(profile, current), refs = await metadataArtworkReferences(profile, current);
  const assets: MetadataBackupAsset[] = [], omitted: MetadataBackupOmission[] = [];
  let used = JSON.stringify(metadata).length + 1024, rawBytes = 0;
  const check = () => { if (!current()) throw new Error('Metadata owner changed'); };
  for (const row of refs) {
    check(); const split = row.id.indexOf(':'), kind = row.id.slice(0, split) as MetadataKind, id = row.id.slice(split + 1), value = row.value as MetadataArtwork;
    if (!['song', 'album', 'artist'].includes(kind) || !metadataBackupIdentity(row.source, id)) throw new Error('Invalid stored artwork identity');
    const omit = (reason: MetadataBackupOmission['reason']) => omitted.push({ source: row.source, kind, id, reason });
    const directory = `${FileSystem.documentDirectory}metadata-artwork/${hashKey(profile)}/${hashKey(row.source)}/`;
    if (!value?.uri?.startsWith(directory) || !/^[a-zA-Z0-9_.-]+$/.test(value.uri.slice(directory.length))) { omit('unsupported'); continue; }
    try {
      const info = await FileSystem.getInfoAsync(value.uri); check();
      if (!info.exists || info.isDirectory || !info.size) { omit('unreadable'); continue; }
      if (info.size > MAX_METADATA_BACKUP_IMAGE || rawBytes + info.size > MAX_METADATA_BACKUP_IMAGES_TOTAL) { omit('image-limit'); continue; }
      if (used + Math.ceil(info.size / 3) * 4 + 4096 > encodedBudget) { omit('backup-budget'); continue; }
      const base64 = await FileSystem.readAsStringAsync(value.uri, { encoding: FileSystem.EncodingType.Base64 }); check();
      const asset = { source: row.source, kind, id, mime: value.mime, bytes: info.size, base64 };
      try { validateMetadataBackupSnapshot({ version: 1, metadata: { version: 1, entries: [] }, assets: [asset], omitted: [] }); }
      catch { omit('unsupported'); continue; }
      assets.push(asset); rawBytes += info.size; used += base64.length + 4096;
    } catch { check(); omit('unreadable'); }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  check(); return validateMetadataBackupSnapshot({ version: 1, metadata, assets, omitted });
}
/** Restore creates owned copies; a path from another device is never replayed. */
export async function restoreMetadataBackup(profile: string, raw: unknown, current: () => boolean): Promise<void> {
  const snapshot = validateMetadataBackupSnapshot(raw), scope = customizationScope(), owner = metadataOperation(scope, undefined, current);
  metadataCheck(owner); if (scope.profile !== profile) throw new Error('Metadata owner changed');
  await restoreMetadataProfile(profile, snapshot.metadata, owner.current); metadataCheck(owner);
  const temporaryDirectory = `${FileSystem.cacheDirectory}metadata-restore/`;
  await FileSystem.makeDirectoryAsync(temporaryDirectory, { intermediates: true }); metadataCheck(owner);
  for (const asset of snapshot.assets) {
    metadataCheck(owner); const temporary = `${temporaryDirectory}${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.image`;
    try {
      await FileSystem.writeAsStringAsync(temporary, asset.base64, { encoding: FileSystem.EncodingType.Base64 }); metadataCheck(owner);
      const operation = { scope: { profile, source: asset.source }, current: owner.current };
      await savePickedMetadataArtwork(temporary, asset.kind, asset.id, operation); metadataCheck(owner);
    } finally { void FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => {}); }
  }
}
