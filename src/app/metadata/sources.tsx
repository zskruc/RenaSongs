import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingsGroup, SettingsPage, SettingRow, settingsStyles } from '@/components/SettingsUI';
import { MetadataButton, MetadataInput, metadataStyles } from '@/components/metadata/MetadataUI';
import { safeScraperProfile, scraperImportSummary, validateScraperProfile, type ScraperProfile } from '@/lib/metadata/config';
import { deleteScraperProfile, exportScraperProfileSafe, metadataOperation, saveScraperProfile } from '@/lib/metadata/repository';
import { metadataRequest } from '@/lib/metadata/request';
import { metadataCheck, isMetadataCancelled } from '@/lib/metadata/models';
import { useMetadataScraping } from '@/store/metadataScraping';
import { prepareRecentlyDeleted, commitRecentlyDeleted, cancelRecentlyDeleted } from '@/lib/recentlyDeleted';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

const EXAMPLE = JSON.stringify({ id: 'my_lyrics', name: 'My lyrics source', version: 1, capabilities: ['lyrics'], rateLimitMs: 1000,
  lyrics: { url: 'https://your-lyrics-server.example/lyrics', method: 'GET', params: { title: '{{title}}', artist: '{{artist}}' }, fields: { lyrics: 'syncedLyrics' } } }, null, 2);
export default function MetadataSources() {
  useTheme(); const t = useT(), state = useMetadataScraping(), [json, setJson] = useState(''), [address, setAddress] = useState('');
  const [preview, setPreview] = useState<{ raw: unknown; profile: ScraperProfile }[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const alive = useRef(true), request = useRef<AbortController | undefined>(undefined);
  useEffect(() => { void state.hydrate(true); return () => { alive.current = false; request.current?.abort(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (action: (operation: ReturnType<typeof metadataOperation>) => Promise<void>) => {
    if (busy) return; const controller = new AbortController(); request.current = controller; const operation = metadataOperation(undefined, controller.signal, () => alive.current);
    setBusy(true); setMessage('');
    try { await action(operation); } catch (error) { if (!isMetadataCancelled(error) && operation.current()) setMessage(error instanceof Error && ['Invalid scraper configuration', 'Use an HTTP or HTTPS endpoint', 'Add a search or lyrics endpoint', 'Invalid parsing script'].includes(error.message) ? error.message : 'Could not load this configuration. Check its format and network connection.'); }
    finally { if (alive.current) setBusy(false); }
  };
  const inspect = (text: string) => {
    if (text.length > 131072) throw new Error('Configuration is too large'); const raw = JSON.parse(text);
    const list = Array.isArray(raw) ? raw : [raw]; if (!list.length || list.length > 20) throw new Error('Too many scraping sources');
    const checked = list.map((entry) => ({ raw: entry, profile: validateScraperProfile(entry) }));
    if (checked.some((entry) => ['itunes', 'musicbrainz', 'lrclib', 'amll'].includes(entry.profile.id)) || new Set(checked.map((entry) => entry.profile.id)).size !== checked.length) throw new Error('Source ID is reserved or duplicated');
    setPreview(checked);
  };
  return <SettingsPage title={t('Custom scraping sources')}><DockScrollView contentContainerStyle={settingsStyles.content} keyboardShouldPersistTaps="handled">
    <Text style={metadataStyles.note}>{t('Configuration scripts only parse supplied responses in an isolated runtime. They cannot access app files, music-server credentials or make their own network requests.')}</Text>
    <Text style={metadataStyles.note}>{t('Headers and local secrets are stored separately and are excluded from exports and recently deleted items. Normal TLS validation stays enabled.')}</Text>
    <MetadataInput label={t('HTTPS configuration URL')} value={address} onChangeText={setAddress} editable={!busy} />
    <MetadataButton title={t('Download and preview configuration')} disabled={busy || !/^https:\/\//i.test(address.trim())} onPress={() => { void run(async (operation) => {
      const text = await metadataRequest('config-import', address.trim(), operation, { maxBytes: 131072 }); metadataCheck(operation); setJson(text); inspect(text);
    }); }} />
    <MetadataButton title={t('Choose configuration file')} disabled={busy} onPress={() => { void run(async (operation) => {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], multiple: false, copyToCacheDirectory: true }); metadataCheck(operation);
      const asset = result.assets?.[0]; if (result.canceled || !asset) return;
      const info = await FileSystem.getInfoAsync(asset.uri); metadataCheck(operation);
      if (!info.exists || info.isDirectory || !info.size || info.size > 131072) throw new Error('Configuration is too large');
      const text = await FileSystem.readAsStringAsync(asset.uri); metadataCheck(operation); setJson(text); inspect(text);
    }); }} />
    <MetadataInput label={t('Scraper JSON')} value={json} onChangeText={(value) => { setJson(value); setPreview([]); }} multiline editable={!busy} />
    <View style={metadataStyles.row}><View style={{ flex: 1 }}><MetadataButton title={t('Show a configuration example')} disabled={busy} onPress={() => { setJson(EXAMPLE); setPreview([]); }} /></View>
      <View style={{ flex: 1 }}><MetadataButton title={t('Preview configuration')} disabled={busy || !json.trim()} onPress={() => { void run(async () => inspect(json)); }} /></View></View>
    {preview.map(({ profile, raw }) => { const summary = scraperImportSummary(profile, raw); return <SettingsGroup key={profile.id}>
      <SettingRow label={profile.name} description={`${profile.id} · ${profile.capabilities.join(' / ')}`} />
      <SettingRow label={t('Requested domains')} description={summary.domains.join('\n')} />
      <SettingRow label={t('Request methods')} description={summary.methods.join(' / ')} />
      <SettingRow label={t('Connection protocol')} description={summary.schemes.join(' / ')} />
      {summary.sensitiveHeaders ? <SettingRow label={t('Contains private headers')} description={t('They will stay in secure storage and will not be exported.')} /> : null}
      {state.profiles.some((entry) => entry.id === profile.id) ? <SettingRow label={t('This source ID already exists')} description={t('Saving replaces this configuration. Changing requests or scripts clears previous private headers and secrets.')} /> : null}
    </SettingsGroup>; })}
    {preview.length ? <MetadataButton title={t('Save reviewed scraping sources')} disabled={busy} onPress={() => { void run(async (operation) => {
      for (const entry of preview) { metadataCheck(operation); await saveScraperProfile(entry.raw, operation); }
      metadataCheck(operation); const ids = preview.map((entry) => entry.profile.id);
      await state.saveSettings({ ...state.settings, enabled: [...new Set([...state.settings.enabled, ...ids])], order: [...new Set([...state.settings.order, ...ids])] });
      await state.hydrate(true); metadataCheck(operation); setPreview([]); setJson(''); setMessage('Scraping sources saved');
    }); }} /> : null}
    {busy ? <><ActivityIndicator /><MetadataButton title={t('Cancel request')} onPress={() => request.current?.abort()} /></> : null}
    {message ? <Text style={metadataStyles.note}>{t(message)}</Text> : null}
    <Text style={metadataStyles.title}>{t('Saved custom sources')}</Text>
    {state.profiles.map((profile) => <SettingsGroup key={profile.id}>
      <SettingRow label={profile.name} description={scraperImportSummary(profile).domains.join(' · ')} />
      <MetadataButton title={t('Edit configuration')} disabled={busy} onPress={() => { setJson(JSON.stringify(safeScraperProfile(profile), null, 2)); setPreview([]); }} />
      <MetadataButton title={t('Remove source')} disabled={busy} onPress={() => { void run(async (operation) => {
        const payload = await exportScraperProfileSafe(profile.id, operation.current); const ticket = await prepareRecentlyDeleted({ kind: 'scraper-profile', title: profile.name, payload });
        let attempted = false;
        try { metadataCheck(operation); attempted = true; await deleteScraperProfile(profile.id, operation.current); await commitRecentlyDeleted(ticket); }
        catch (error) { if (!attempted) await cancelRecentlyDeleted(ticket); throw error; }
        await state.saveSettings({ ...state.settings, enabled: state.settings.enabled.filter((id) => id !== profile.id), order: state.settings.order.filter((id) => id !== profile.id) });
        await state.hydrate(true);
      }); }} />
    </SettingsGroup>)}
  </DockScrollView></SettingsPage>;
}
