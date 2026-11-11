/** Version, updates, help and diagnostics; personal data tools have their own category. */
import Constants from 'expo-constants';
import { useLocalSearchParams, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Linking, Pressable, Share } from 'react-native';
import { DockScrollView } from '@/components/DockScrollView';
import { Field, SettingRow, SettingsGroup, SettingsPage, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { fullReport } from '@/lib/diagnosticsReport';
import { GITHUB_REPOSITORY, PROJECT_NAME, RELEASES_PAGE, REPOSITORY_URL, SOURCE_BRANCH } from '@/lib/project';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { useUpdate } from '@/store/update';

const PREFERENCES_ANCHORS = new Set(['Export settings', 'Import settings', 'Restore default settings']);
export default function AboutSettings() {
  const t = useT(), router = useRouter();
  const { setting, settingVisit } = useLocalSearchParams<{ setting?: string; settingVisit?: string }>();
  useEffect(() => {
    if (typeof setting === 'string' && PREFERENCES_ANCHORS.has(setting)) {
      router.replace({ pathname: '/settings/preferences-file', params: { setting, ...(settingVisit ? { settingVisit } : {}) } });
    }
  }, [setting, settingVisit, router]);
  const taps = useRef(0);
  const screensOpen = useRootNavigationState()?.routes?.length;
  const version = Constants.expoConfig?.version;
  const diagnostics = useSettings((s) => s.diagnostics), setDiagnostics = useSettings((s) => s.setDiagnostics);
  const updateCheck = useSettings((s) => s.updateCheck), setUpdateCheck = useSettings((s) => s.setUpdateCheck);
  const check = useUpdate((s) => s.check), checking = useUpdate((s) => s.checking);
  const toast = useToast((s) => s.show);
  const reportUrl = `${REPOSITORY_URL}/issues/new?template=bug_report.yml${version ? `&version=${encodeURIComponent(version)}` : ''}`;
  return <SettingsPage title={t('About & diagnostics')}>
    <DockScrollView contentContainerStyle={settingsStyles.content}>
      <SettingsGroup title={t('Version & updates')}>
        <Pressable accessibilityRole="button" onPress={() => { taps.current++; if (taps.current >= 5) { taps.current = 0; router.push('/settings/diagnostics'); } }}>
          <Field label={t('Version')} value={`${PROJECT_NAME} v${version ?? '?'}`} />
        </Pressable>
        <SettingRow icon="sparkles-outline" label={t("What's new")} onPress={() => Linking.openURL(RELEASES_PAGE)} />
        <SettingRow icon={checking ? 'hourglass-outline' : 'cloud-download-outline'} label={t('Check for updates')} disabled={checking} onPress={() => {
          if (checking) return;
          void check(true).then(({ ok, release }) => { if (!ok) toast(t("Couldn't check for updates")); else if (!release) toast(t("You're on the latest version")); });
        }} />
        <SwitchList options={[{ label: t('Check for updates automatically'), value: updateCheck, onChange: setUpdateCheck }]} />
      </SettingsGroup>
      <SettingsGroup title={t('Help & feedback')}>
        <SettingRow icon="help-circle-outline" label={t('FAQ')} onPress={() => Linking.openURL(`${REPOSITORY_URL}/blob/${SOURCE_BRANCH}/docs/FAQ.md`)} />
        <SettingRow icon="logo-github" label="GitHub" description={GITHUB_REPOSITORY} onPress={() => Linking.openURL(REPOSITORY_URL)} />
        <SettingRow icon="bug-outline" label={t('Report a bug')} onPress={() => Linking.openURL(reportUrl)} />
      </SettingsGroup>
      <SettingsGroup title={t('Diagnostics')}>
        <SwitchList options={[{ label: t('Measure performance'), value: diagnostics, onChange: setDiagnostics }]} />
        <SettingRow icon="pulse-outline" label={t('Diagnostics')} chevron onPress={() => router.push('/settings/diagnostics')} />
        <SettingRow icon="document-text-outline" label={t('Share diagnostic report')} onPress={() => void Share.share({ message: fullReport(screensOpen) })} />
      </SettingsGroup>
    </DockScrollView>
  </SettingsPage>;
}
