/** A short settings directory organized around listening, interface and maintenance. */
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import Icon from '@/components/Icon';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingsDestinationRow } from '@/components/SettingsCategoryPage';
import { ScreenHeader, SettingRow, SettingsGroup, SettingsSafeArea, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { SETTINGS_HOME_GROUPS } from '@/lib/settingsNavigation';
import { useAuthStore } from '@/store/auth';
import { anyDownloads, useDownloads } from '@/store/downloads';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { fontSize, radius, themed, useTheme } from '@/theme';

export default function SettingsScreen({ asTab = false }: { asTab?: boolean }) {
  const theme = useTheme(), router = useRouter(), t = useT();
  useSettings((s) => s.appFont);
  const auth = useAuthStore((s) => s.auth), offline = useAuthStore((s) => s.offline);
  const logout = useAuthStore((s) => s.logout), goOnline = useAuthStore((s) => s.goOnline), goOffline = useAuthStore((s) => s.goOffline);
  const hasDownloads = useDownloads((s) => !s.hydrated || anyDownloads(s));
  const toast = useToast((s) => s.show);
  const serverOffline = offline && !!auth;
  const name = offline && !auth ? t('Local profile') : auth?.username ?? '—';
  const initial = offline && !auth ? 'O' : (auth?.username ?? '?').charAt(0).toUpperCase();
  const detail = serverOffline ? t('Offline · your downloads') : offline ? t('Music on your device') : auth?.serverUrl.replace(/^https?:\/\//, '') ?? '';

  return <SettingsSafeArea>
    <ScreenHeader title={t('Settings')} back={!asTab} />
    <View style={settingsStyles.pane}>
      <DockScrollView contentContainerStyle={settingsStyles.content}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Search settings')}
          onPress={() => router.push('/settings/search')} style={({ pressed }) => [styles.searchRow, pressed && { opacity: 0.65 }]}>
          <Icon name="search" size={20} color={theme.textSecondary} />
          <Text style={styles.searchText}>{t('Search settings')}</Text>
        </Pressable>
        <SettingsGroup title={t('Account & connection')}>
          <View style={[settingsStyles.row, styles.profileRow]}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
            <View style={settingsStyles.rowLabelBox}>
              <Text style={styles.profileName}>{name}</Text>
              <Text style={settingsStyles.rowDescription} numberOfLines={1}>{detail}</Text>
            </View>
          </View>
          {auth && (serverOffline || hasDownloads) ? <SwitchList options={[{
            label: t('Offline mode'), value: serverOffline,
            onChange: (on) => { if (on) { void goOffline(false); toast(t('Offline')); } else { void goOnline(); } router.replace('/(tabs)'); },
          }]} /> : null}
          {auth ? <SettingRow label={t('Network')} icon="git-network-outline" chevron onPress={() => router.push('/settings/network')} /> : null}
          <SettingRow label={offline && !auth ? t('Exit local mode') : t('Change profile')} icon="people-outline" chevron onPress={() => logout()} />
        </SettingsGroup>
        {SETTINGS_HOME_GROUPS.map((group) => <SettingsGroup key={group.title} title={t(group.title)}>
          {group.rows.map((item) => <SettingsDestinationRow key={item.route} item={item} />)}
        </SettingsGroup>)}
      </DockScrollView>
    </View>
  </SettingsSafeArea>;
}
const styles = themed((colors) => ({
  searchRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderRadius: radius.lg, backgroundColor: colors.surface, marginBottom: 4 },
  searchText: { color: colors.textSecondary, fontSize: fontSize.md },
  profileRow: { minHeight: 80 },
  avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.text, fontSize: fontSize.lg, fontWeight: '600' },
  profileName: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
}));
