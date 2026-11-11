import { SettingsCategoryPage } from '@/components/SettingsCategoryPage';
import { SETTINGS_CATEGORY_PAGES } from '@/lib/settingsNavigation';

export default function LibraryToolsSettings() {
  return <SettingsCategoryPage {...SETTINGS_CATEGORY_PAGES.library} />;
}
