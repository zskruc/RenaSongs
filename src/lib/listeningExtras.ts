/** Source/profile-owned optional tool data. No server mutations or auth in JSON. */
import { mediaCacheDatabase } from './mediaCacheDb';
import { hashKey } from './localLibrary';
import { customizationScope, captureCustomizationOwner, type CustomizationScope } from './localCustomizations';
const schema = 'CREATE TABLE IF NOT EXISTS listening_extras(source TEXT NOT NULL,key TEXT NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(source,key));';
const initialized = new WeakMap<object, Promise<void>>(), tails = new Map<string, Promise<unknown>>();
let revision = 0; const listeners = new Set<() => void>();
export function extraRevision() { return revision; }
export function subscribeListeningExtras(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
async function db(scope: CustomizationScope) { const value = await mediaCacheDatabase(hashKey(scope.profile)); let ready = initialized.get(value); if (!ready) { ready = value.execAsync(schema).catch((error) => { initialized.delete(value); throw error; }); initialized.set(value, ready); } await ready; return value; }
export async function readListeningExtra<T>(key: string, scope = customizationScope(), current = captureCustomizationOwner(scope)): Promise<T | undefined> {
  if (!current()) throw new Error('Listening tools owner changed'); await tails.get(scope.profile)?.catch(() => {});
  if (!current()) throw new Error('Listening tools owner changed'); const value = await db(scope);
  if (!current()) throw new Error('Listening tools owner changed');
  const row = await value.getFirstAsync<{ data: string }>('SELECT data FROM listening_extras WHERE source=? AND key=?', [scope.source,key]);
  if (!current()) throw new Error('Listening tools owner changed');
  if (!row) return undefined; return JSON.parse(row.data) as T;
}
export async function writeListeningExtra(key: string, data: unknown, scope = customizationScope(), current = captureCustomizationOwner(scope)): Promise<void> {
  const encoded = data === undefined ? undefined : JSON.stringify(data); if (encoded && encoded.length > (key.startsWith('loudness:') ? 4_000_000 : 1_500_000)) throw new Error('Listening tool record is too large');
  const task = (tails.get(scope.profile) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (!current()) throw new Error('Listening tools owner changed'); const value = await db(scope);
    await value.withTransactionAsync(async () => { if (!current()) throw new Error('Listening tools owner changed');
      if (encoded === undefined) await value.runAsync('DELETE FROM listening_extras WHERE source=? AND key=?', [scope.source,key]);
      else await value.runAsync('INSERT OR REPLACE INTO listening_extras(source,key,data,updated_at) VALUES(?,?,?,?)', [scope.source,key,encoded,Date.now()]);
      if (!current()) throw new Error('Listening tools owner changed');
    });
    if (current()) { revision++; for (const listener of listeners) listener(); }
  }); tails.set(scope.profile,task); try { await task; } finally { if (tails.get(scope.profile) === task) tails.delete(scope.profile); }
}

export async function pruneListeningCache(prefix: string, maxBytes: number, scope = customizationScope(), current = captureCustomizationOwner(scope)): Promise<void> {
  if (!/^[a-z-]+:$/.test(prefix)) throw new Error('Invalid cache category');
  const task = (tails.get(scope.profile) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (!current()) throw new Error('Listening tools owner changed'); const value = await db(scope);
    await value.withTransactionAsync(async () => {
      if (!current()) throw new Error('Listening tools owner changed');
      const rows = await value.getAllAsync<{ key: string; bytes: number }>('SELECT key,length(CAST(data AS BLOB)) AS bytes FROM listening_extras WHERE source=? AND key LIKE ? ORDER BY updated_at DESC', [scope.source,prefix+'%']);
      let kept=0; for(const row of rows){kept+=row.bytes;if(kept>maxBytes)await value.runAsync('DELETE FROM listening_extras WHERE source=? AND key=?',[scope.source,row.key]);}
      if(!current())throw new Error('Listening tools owner changed');
    });
  });tails.set(scope.profile,task);try{await task;}finally{if(tails.get(scope.profile)===task)tails.delete(scope.profile);}
}

/** Serialize read/modify/write against the same profile, so two imports cannot lose each other. */
export async function updateListeningExtra<T>(key: string, change: (previous: T | undefined) => T, scope = customizationScope(), current = captureCustomizationOwner(scope)): Promise<T> {
  let result!: T;
  const task = (tails.get(scope.profile) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (!current()) throw new Error('Listening tools owner changed'); const value = await db(scope);
    await value.withTransactionAsync(async () => {
      if (!current()) throw new Error('Listening tools owner changed');
      const row = await value.getFirstAsync<{ data: string }>('SELECT data FROM listening_extras WHERE source=? AND key=?', [scope.source,key]);
      if (!current()) throw new Error('Listening tools owner changed');
      result = change(row ? JSON.parse(row.data) as T : undefined);
      const encoded = JSON.stringify(result); if (encoded.length > 1_500_000) throw new Error('Listening tool record is too large');
      await value.runAsync('INSERT OR REPLACE INTO listening_extras(source,key,data,updated_at) VALUES(?,?,?,?)', [scope.source,key,encoded,Date.now()]);
      if (!current()) throw new Error('Listening tools owner changed');
    });
    revision++; for (const listener of listeners) listener();
  }); tails.set(scope.profile,task); try { await task; return result; } finally { if (tails.get(scope.profile) === task) tails.delete(scope.profile); }
}

/** Call after customization ownership is retired and before closing its database. */
export async function drainListeningExtrasProfile(profile: string): Promise<void> {
  await tails.get(profile)?.catch(() => {});
}
