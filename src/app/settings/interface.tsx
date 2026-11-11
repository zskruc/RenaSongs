import { useRouter } from 'expo-router';
import { DockScrollView } from '@/components/DockScrollView';
import { canBlurBars } from '@/components/BarBlur';
import { SelectList, SettingRow, SettingsGroup, SettingsPage, SwitchList, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useSettings, type DefaultTab, type SwipeAction } from '@/store/settings';

export default function InterfaceSettings() {
  const t = useT(), router = useRouter();
  const alwaysShowTabs = useSettings((s) => s.alwaysShowTabs), setAlwaysShowTabs = useSettings((s) => s.setAlwaysShowTabs);
  const showTabLabels = useSettings((s) => s.showTabLabels), setShowTabLabels = useSettings((s) => s.setShowTabLabels);
  const blurBars = useSettings((s) => s.blurBars), setBlurBars = useSettings((s) => s.setBlurBars);
  const defaultTab = useSettings((s) => s.defaultTab), setDefaultTab = useSettings((s) => s.setDefaultTab);
  const swipeAction = useSettings((s) => s.swipeAction), setSwipeAction = useSettings((s) => s.setSwipeAction);
  const swipeLeftAction = useSettings((s) => s.swipeLeftAction), setSwipeLeftAction = useSettings((s) => s.setSwipeLeftAction);
  const hapticsEnabled = useSettings((s) => s.hapticsEnabled), setHapticsEnabled = useSettings((s) => s.setHapticsEnabled);
  const swipeOptions = [
    { value: 'off' as const, label: t('Off') }, { value: 'queue' as const, label: t('Add to queue') }, { value: 'next' as const, label: t('Play next') },
    { value: 'favorite' as const, label: t('Add to favorites') }, { value: 'menu' as const, label: t('More options') },
  ];
  return <SettingsPage title={t('Navigation & gestures')}><DockScrollView contentContainerStyle={settingsStyles.content}>
    <SettingsGroup title={t('Navigation')}>
      <SelectList<DefaultTab> label={t('Open the app on')} value={defaultTab} onChange={setDefaultTab} options={[
        { value: 'index', label: t('Home') }, { value: 'search', label: t('Search') }, { value: 'explore', label: t('Explore') }, { value: 'library', label: t('Your library') },
      ]} />
      <SettingRow label={t('Navigation bar')} description={t('Tab order and visible destinations')} chevron onPress={() => router.push('/settings/navigation-bar')} />
      <SwitchList options={[
        { label: t('Always show the navigation bar'), value: alwaysShowTabs, onChange: setAlwaysShowTabs },
        { label: t('Show tab names'), value: showTabLabels, onChange: setShowTabLabels },
        ...(canBlurBars ? [{ label: t('Navigation bar blur'), value: blurBars, onChange: setBlurBars }] : []),
      ]} />
    </SettingsGroup>
    <SettingsGroup title={t('List gestures')}>
      <SelectList<SwipeAction> label={t('Swipe right')} value={swipeAction} onChange={setSwipeAction} options={swipeOptions} />
      <SelectList<SwipeAction> label={t('Swipe left')} value={swipeLeftAction} onChange={setSwipeLeftAction} options={swipeOptions} />
      <SwitchList options={[{ label: t('Haptic feedback'), value: hapticsEnabled, onChange: (value) => { setHapticsEnabled(value); if (value) haptic('medium'); } }]} />
    </SettingsGroup>
  </DockScrollView></SettingsPage>;
}
