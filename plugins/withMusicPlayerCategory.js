/** Advertise the existing activity as a music player without adding a new
 * receiver or changing launch/auto-start behavior. */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withMusicPlayerCategory(config) {
  return withAndroidManifest(config, (mod) => {
    const activity = mod.modResults.manifest.application?.[0]?.activity?.find((entry) => entry.$?.['android:name'] === '.MainActivity');
    if (!activity) throw new Error('MainActivity missing');
    const filters = activity['intent-filter'] ?? (activity['intent-filter'] = []);
    const category = 'android.intent.category.APP_MUSIC';
    if (!filters.some((filter) => filter.category?.some((entry) => entry.$?.['android:name'] === category))) filters.push({
      action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      category: [{ $: { 'android:name': category } }, { $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    });
    return mod;
  });
};
