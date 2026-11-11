import { useState } from 'react';
import { DockScrollView } from '@/components/DockScrollView';
import { Dialog } from '@/components/Dialog';
import { SettingRow, SettingsGroup, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { pickSettingsFile, shareSettingsFile } from '@/lib/settingsFile';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';

export default function PreferencesFileSettings() {
  const t = useT(), toast = useToast((s) => s.show);
  const importSettings = useSettings((s) => s.importSettings), resetToDefaults = useSettings((s) => s.resetToDefaults);
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  return <SettingsPage title={t('Settings backup & reset')}>
    <DockScrollView contentContainerStyle={settingsStyles.content}>
      <SettingsGroup title={t('Backup & restore')} description={t('Save your app preferences to a file or restore them from a previous export.')}>
        <SettingRow icon="share-outline" label={t('Export settings')} onPress={() => {
          shareSettingsFile().then((ok) => { if (!ok) toast(t("Couldn't export the settings")); }).catch(() => toast(t("Couldn't export the settings")));
        }} />
        <SettingRow icon="download-outline" label={t('Import settings')} onPress={() => {
          pickSettingsFile().then((settings) => { if (settings) setPending(settings); }).catch(() => toast(t("Couldn't read this settings file")));
        }} />
      </SettingsGroup>
      <SettingsGroup title={t('Reset preferences')} description={t('Your preferences will go back to their defaults. Your language stays.')}>
        <SettingRow icon="arrow-undo-outline" label={t('Restore default settings')} destructive onPress={() => setConfirmReset(true)} />
      </SettingsGroup>
    </DockScrollView>
    <Dialog visible={confirmReset} title={t('Restore default settings')} message={t('Your preferences will go back to their defaults. Your language stays.')}
      confirmLabel={t('Restore')} onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); resetToDefaults(); toast(t('Settings restored')); }} />
    <Dialog visible={pending !== null} title={t('Import settings')} message={t('Your preferences will be replaced by the ones in the file. Your language and accounts stay.')}
      confirmLabel={t('Import')} onCancel={() => setPending(null)} onConfirm={() => { if (pending) importSettings(pending); setPending(null); toast(t('Settings imported')); }} />
  </SettingsPage>;
}
