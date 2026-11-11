import { SettingsCategoryPage } from '@/components/SettingsCategoryPage';
import { SETTINGS_CATEGORY_PAGES } from '@/lib/settingsNavigation';

export default function DataToolsSettings() {
  return <SettingsCategoryPage {...SETTINGS_CATEGORY_PAGES.data} />;
}
