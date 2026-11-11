import { useRouter } from 'expo-router';
import Icon from '@/components/Icon';
import { DockScrollView } from '@/components/DockScrollView';
import { SettingRow, SettingsGroup, SettingsIntro, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import type { SettingsDestination, SettingsNavigationGroup } from '@/lib/settingsNavigation';
import { useAuthStore } from '@/store/auth';

/** One row implementation keeps category navigation and offline behavior consistent. */
export function SettingsDestinationRow({ item }: { item: SettingsDestination }) {
  const router = useRouter();
  const t = useT();
  const auth = useAuthStore((state) => state.auth);
  const offline = useAuthStore((state) => state.offline);
  const local = offline && !auth;
  if (item.serverOnly && local) return null;
  const disabled = !!item.library && offline && !!auth;
  return <SettingRow
    label={t(item.library && local ? 'Local music' : item.title)}
    description={disabled ? t('Connect to your server to manage libraries.') : item.description ? t(item.description) : undefined}
    icon={(item.library && local ? 'phone-portrait-outline' : item.icon) as keyof typeof Icon.glyphMap}
    disabled={disabled}
    chevron
    onPress={() => router.push(item.route)}
  />;
}

export function SettingsCategoryPage({ title, description, groups }: {
  title: string; description: string; groups: readonly SettingsNavigationGroup[];
}) {
  const t = useT();
  const local = useAuthStore((state) => state.offline && !state.auth);
  return <SettingsPage title={t(title)}>
    <DockScrollView contentContainerStyle={settingsStyles.content}>
      <SettingsIntro description={t(description)} />
      {groups.map((group) => {
        const rows = group.rows.filter((row) => !(local && row.serverOnly));
        return <SettingsGroup key={group.title} title={t(group.title)} description={group.description ? t(group.description) : undefined}>
          {rows.map((item) => <SettingsDestinationRow key={item.route} item={item} />)}
        </SettingsGroup>;
      })}
    </DockScrollView>
  </SettingsPage>;
}
