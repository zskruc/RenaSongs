import { useRouter } from 'expo-router';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingRow, SettingsGroup, SettingsPage, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useLocalProfile } from '@/hooks/useLocalProfile';
import { useSettings } from '@/store/settings';

export default function HomeLayoutSettings() {
  const t = useT(), router = useRouter();
  const offline = useAuthStore((s) => s.offline), serverType = useAuthStore((s) => s.auth?.serverType);
  const local = useLocalProfile();
  const canBrowseFolders = !local && (offline || serverType !== 'jellyfin');
  const showPlayingElsewhere = useSettings((s) => s.showPlayingElsewhere), setShowPlayingElsewhere = useSettings((s) => s.setShowPlayingElsewhere);
  const libraryShowsPlaylists = useSettings((s) => s.libraryShowsPlaylists), setLibraryShowsPlaylists = useSettings((s) => s.setLibraryShowsPlaylists);
  const showFolderBrowser = useSettings((s) => s.showFolderBrowser), setShowFolderBrowser = useSettings((s) => s.setShowFolderBrowser);
  return <SettingsPage title={t('Home & browsing')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <SettingsGroup title={t('Home')}>
      <SettingRow label={t('Home title')} chevron onPress={() => router.push('/settings/home-title')} />
      <SettingRow label={t('Greeting')} chevron onPress={() => router.push('/settings/greeting')} />
      <SettingRow label={t('Home sections')} chevron onPress={() => router.push('/settings/home-sections')} />
      <SettingRow label={t('Home buttons')} chevron onPress={() => router.push('/settings/home-buttons')} />
      <SettingRow label={t('Quick grid')} chevron onPress={() => router.push('/settings/quick-grid')} />
      <SettingRow label={t('Home chips')} chevron onPress={() => router.push('/settings/home-chips')} />
      <SwitchList options={[{ label: t('Playing on other devices'), description: t('At the top of Home, what is playing in your other apps and devices, ready to carry on here.'), value: showPlayingElsewhere, onChange: setShowPlayingElsewhere }]} />
    </SettingsGroup>
    <SettingsGroup title={t('Explore & search')}>
      <SettingRow label={t('Explore sections')} chevron onPress={() => router.push('/settings/explore-sections')} />
      <SettingRow label={t('Search result layout')} description={t('Section order and result density')} chevron onPress={() => router.push('/settings/discovery-layout')} />
    </SettingsGroup>
    <SettingsGroup title={t('Your library')}>
      <SettingRow label={t('Your library chips')} chevron onPress={() => router.push('/settings/library-chips')} />
      <SwitchList options={[{ label: t('Start on your playlists'), description: t('With no chip pressed, Your library shows Favorites and your playlists instead of everything mixed together.'), value: libraryShowsPlaylists, onChange: setLibraryShowsPlaylists }]} />
      {canBrowseFolders ? <SwitchList options={[{ label: t('Folder browsing'), value: showFolderBrowser, onChange: setShowFolderBrowser, disabled: offline }]} /> : null}
    </SettingsGroup>
  </DockScrollView></SettingsPage>;
}
