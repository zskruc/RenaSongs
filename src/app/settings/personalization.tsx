/** Appearance is a compact hub; each detailed layout keeps its own page. */
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingRow, SettingsGroup, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { APP_FONT_LABELS, LANGUAGE_NAMES, useSettings } from '@/store/settings';

const MOVED_SETTINGS: Record<string, string> = Object.fromEntries([
  ...['UI style', 'Album page style', 'Playlist page style', 'Cover corners', 'Song lists'].map((key) => [key, '/settings/page-layouts']),
  ...['Home and search layouts', 'Home title', 'Greeting', 'Home sections', 'Home buttons', 'Quick grid', 'Home chips', 'Playing on other devices', 'Explore sections', 'Your library chips', 'Start on your playlists', 'Folder browsing'].map((key) => [key, '/settings/home-layout']),
  ...['Open the app on', 'Navigation bar', 'Always show the navigation bar', 'Show tab names', 'Navigation bar blur', 'Swipe right', 'Swipe left', 'Haptic feedback'].map((key) => [key, '/settings/interface']),
  ['Lyric language fonts', '/settings/lyric-fonts'],
  ['Home and search layouts', '/settings/discovery-layout'],
  ...['Apple Music style', 'Spotify style', 'Primuse', 'Artist page layout', 'Volta', 'Minidisc', 'Compact layout'].map((key) => [key, '/settings/page-layouts']),
]);

export default function AppearanceSettings() {
  const t = useT(), router = useRouter();
  const { setting, settingVisit } = useLocalSearchParams<{ setting?: string; settingVisit?: string }>();
  const language = useSettings((s) => s.language);
  const appFont = useSettings((s) => s.appFont);
  const themeMode = useSettings((s) => s.themeMode);
  const modeLabel = { system: 'System', dark: 'Dark', light: 'Light', schedule: 'Scheduled' }[themeMode];
  if (typeof setting === 'string' && MOVED_SETTINGS[setting]) return <Redirect href={{ pathname: MOVED_SETTINGS[setting], params: { setting: setting === 'Apple Music style' || setting === 'Spotify style' ? 'UI style' : setting === 'Compact layout' ? 'Playlist page style' : ['Primuse', 'Artist page layout', 'Volta', 'Minidisc'].includes(setting) ? 'Album page style' : setting, ...(settingVisit ? { settingVisit } : {}) } }} />;
  return <SettingsPage title={t('Appearance & layout')}>
    <DockScrollView contentContainerStyle={settingsStyles.content}>
      <SettingsGroup title={t('Theme & text')}>
        <SettingRow label={t('Theme')} description={t('Appearance, accent color and artwork colors')} right={t(modeLabel)} icon="color-palette-outline" chevron onPress={() => router.push('/settings/theme')} />
        <SettingRow label={t('Glass tuning')} description={t('Glass presets and material parameters')} icon="water-outline" chevron onPress={() => router.push('/settings/glass')} />
        <SettingRow label={t('Font')} right={t(APP_FONT_LABELS[appFont])} icon="text-outline" chevron onPress={() => router.push('/settings/font')} />
        <SettingRow label={t('Language')} right={LANGUAGE_NAMES[language]} icon="language-outline" chevron onPress={() => router.push('/settings/language')} />
      </SettingsGroup>
      <SettingsGroup title={t('Pages & browsing')}>
        <SettingRow label={t('Page layouts')} description={t('Apple Music or Spotify, album, playlist and song lists')} icon="albums-outline" chevron onPress={() => router.push('/settings/page-layouts')} />
        <SettingRow label={t('Home & browsing')} description={t('Home title, sections, shortcuts and search results')} icon="home-outline" chevron onPress={() => router.push('/settings/home-layout')} />
        <SettingRow label={t('Navigation & gestures')} description={t('Bottom tabs, startup page, swipes and haptics')} icon="hand-left-outline" chevron onPress={() => router.push('/settings/interface')} />
        <SettingRow label={t('Home screen widgets')} icon="grid-outline" chevron onPress={() => router.push('/settings/home-widgets')} />
      </SettingsGroup>
    </DockScrollView>
  </SettingsPage>;
}
