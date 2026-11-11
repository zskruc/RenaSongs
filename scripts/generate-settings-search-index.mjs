/** Index only labels attached to real settings controls; no setting values or account data. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
const root = new URL('../', import.meta.url);
const chinese = JSON.parse(readFileSync(new URL('src/i18n/locales/zh-CN.json', root), 'utf8'));
const titleOf = (key) => chinese[key] ?? chinese[key.split('::')[0]] ?? key.split('::')[0];
function translated(expression) {
  if (ts.isParenthesizedExpression(expression)) return translated(expression.expression);
  // The false branch is the base screen; previews/offline headings are transient variants.
  if (ts.isConditionalExpression(expression)) return translated(expression.whenFalse) ?? translated(expression.whenTrue);
  return ts.isCallExpression(expression) && expression.expression.getText() === 't'
    && expression.arguments[0] && ts.isStringLiteral(expression.arguments[0]) ? expression.arguments[0].text : undefined;
}
const attr = (node, key) => node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.text === key)?.initializer;
/** Match the categories visible on Settings home. Routes and saved search IDs stay stable. */
const categoryRoutes = {
  'Playback & sound': ['playback', 'equalizer', 'scrobbling', 'shuffle', 'shuffle-links', 'silence-trim', 'loudness-analysis'],
  'Player & lyrics': ['player', 'player-buttons', 'lyrics', 'lyrics-tools', 'lyric-fonts', 'lyric-sources'],
  'Podcasts & long audio': ['longform', 'audiobooks', 'long-audio', 'chapters', 'listening-tools'],
  'Appearance & layout': ['personalization', 'page-layouts', 'home-layout', 'interface', 'theme', 'glass', 'font', 'language', 'discovery-layout', 'home-title', 'home-buttons', 'home-sections', 'home-chips', 'quick-grid', 'greeting', 'home-widgets', 'navigation-bar', 'explore-sections', 'library-chips', 'song-lists'],
  'Library & metadata': ['music-tools', 'library', 'music-search', 'listening-stats', 'smart-playlists', 'duplicates', 'local-customizations'],
  'Downloads & storage': ['storage', 'downloads', 'download-manager', 'cache', 'media-cache', 'podcast-storage'],
  'Backup & transfer': ['data-tools', 'personal-backup', 'preferences-file', 'playlist-recovery', 'playlist-exchange', 'pending-marks', 'recently-deleted', 'wifi-transfer'],
  'About & diagnostics': ['about', 'diagnostics'],
  Account: ['network'],
};
const externalPages = [
  { file: 'metadata/index.tsx', route: '/metadata', category: 'Library & metadata' },
  { file: 'metadata/bulk.tsx', route: '/metadata/bulk', category: 'Library & metadata' },
  { file: 'metadata/sources.tsx', route: '/metadata/sources', category: 'Library & metadata' },
  { file: 'playback-range.tsx', route: '/playback-range', category: 'Playback & sound' },
  { file: 'cue-import.tsx', route: '/cue-import', category: 'Library & metadata' },
  { file: 'media-collections.tsx', route: '/media-collections', category: 'Library & metadata' },
  { file: 'listening-intents.tsx', route: '/listening-intents', category: 'Podcasts & long audio' },
  { file: 'local-podcasts.tsx', route: '/local-podcasts', category: 'Podcasts & long audio' },
  { file: 'radio-discover.tsx', route: '/radio-discover', category: 'Podcasts & long audio' },
];
const pages = readdirSync(new URL('src/app/settings/', root))
  .filter((name) => name.endsWith('.tsx') && !['index.tsx', 'search.tsx'].includes(name)).sort()
  .map((file) => {
    const slug = file.slice(0, -4);
    const category = Object.entries(categoryRoutes).find(([, routes]) => routes.includes(slug))?.[0];
    if (!category) throw new Error(`Add a Settings category for ${file} before indexing it.`);
    return { file: `settings/${file}`, route: `/settings/${slug}`, category };
  });
const movedPreferenceLabels = new Set(['Export settings', 'Import settings', 'Restore default settings']);
const movedLyricLabels = new Set(['Lyrics source', 'Lyrics size', 'Lyrics weight', 'Lyrics alignment',
  'Blur inactive lyrics', 'Show lyrics card', 'Lyrics background', 'Lyrics card background']);
// The small category screens are rendered from this shared route catalog.
const navigationTitles = new Map();
const navigationSource = ts.createSourceFile('settingsNavigation.ts', readFileSync(new URL('src/lib/settingsNavigation.ts', root), 'utf8'), ts.ScriptTarget.Latest, true);
function visitNavigation(node) {
  if (ts.isObjectLiteralExpression(node)) {
    const get = (name) => node.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(navigationSource) === name)?.initializer;
    const route = get('route'), title = get('title');
    if (route && title && ts.isStringLiteral(route) && ts.isStringLiteral(title)) {
      const titles = navigationTitles.get(route.text) ?? [];
      navigationTitles.set(route.text, [...new Set([...titles, title.text])]);
    }
  }
  node.forEachChild(visitNavigation);
}
visitNavigation(navigationSource);
const entries = [];
for (const { file, route, category } of [...pages, ...externalPages]) {
  const source = ts.createSourceFile(file, readFileSync(new URL(`src/app/${file}`, root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const labels = new Set(), optionAliases = new Map(); let heading;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(source);
      if (['SettingsPage', 'ScreenHeader'].includes(name)) {
        const title = attr(node, 'title'); if (title && ts.isJsxExpression(title) && title.expression) heading ??= translated(title.expression);
      }
      if (['SettingRow', 'Field', 'SliderRow', 'TextRow', 'SelectList'].includes(name)) {
        const label = attr(node, 'label');
        if (label && ts.isJsxExpression(label) && label.expression) { const key = translated(label.expression); if (key) labels.add(key); }
      }
      if (name === 'SelectList') {
        const label = attr(node, 'label'), options = attr(node, 'options');
        const key = label && ts.isJsxExpression(label) && label.expression ? translated(label.expression) : undefined;
        if (key && options) {
          const choices = new Set();
          const scan = (child) => {
            if (ts.isPropertyAssignment(child) && child.name.getText(source) === 'label') {
              const choice = translated(child.initializer); if (choice) choices.add(choice);
            }
            child.forEachChild(scan);
          };
          scan(options); optionAliases.set(key, [...choices]);
        }
      }
      const collapsible = attr(node, 'collapsible');
      if (name === 'SwitchList' || (name === 'SelectList' && collapsible?.getText(source) === '{false}')) {
        const options = attr(node, 'options');
        const walk = (child) => {
          if (ts.isPropertyAssignment(child) && child.name.getText(source) === 'label') { const key = translated(child.initializer); if (key) labels.add(key); }
          child.forEachChild(walk);
        };
        if (options) walk(options);
      }
    }
    node.forEachChild(visit);
  }
  visit(source);
  if (file === 'settings/glass.tsx') {
    // ParameterSlider explicitly wraps these labels with SettingAnchor.
    const findParameters = (node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'PARAMETERS' && node.initializer) {
        const scan = (child) => {
          if (ts.isPropertyAssignment(child) && child.name.getText(source) === 'label' && ts.isStringLiteral(child.initializer)) labels.add(child.initializer.text);
          child.forEachChild(scan);
        };
        scan(node.initializer);
      }
      node.forEachChild(findParameters);
    };
    findParameters(source);
  }
  const slug = route.split('/').at(-1), words = slug.replaceAll('-', ' ');
  heading ??= navigationTitles.get(route)?.[0]
    ?? ({ cache: 'Cached songs', glass: 'Glass lab', player: 'Player', theme: 'Theme', 'long-audio': 'Long audio', shuffle: 'Shuffle preferences' })[slug]
    ?? words.charAt(0).toUpperCase() + words.slice(1);
  const breadcrumbs = category === heading ? [category] : [category, heading];
  const aliases = [...new Set([...breadcrumbs.map(titleOf).filter((value, index) => value !== breadcrumbs[index]),
    ...(navigationTitles.get(route) ?? []).flatMap((title) => [title, titleOf(title)])])].filter((value) => value !== heading);
  entries.push({ id: route, route, title: heading, chinese: titleOf(heading), section: heading, breadcrumbs, aliases });
  for (const label of labels) {
    const oldRoute = route === '/settings/preferences-file' && movedPreferenceLabels.has(label) ? '/settings/about'
      : route === '/settings/lyrics' && movedLyricLabels.has(label) ? '/settings/player' : route;
    const choices = optionAliases.get(label) ?? [];
    const controlAliases = [...new Set([...aliases, ...choices.flatMap((choice) => [choice, titleOf(choice)])])];
    entries.push({ id: `${oldRoute}#${label}`, route, title: label, chinese: titleOf(label), section: heading, breadcrumbs, aliases: controlAliases, anchor: label });
  }
}
// Navigation rows no longer shown on a large catch-all page should keep working
// from Recent settings without adding duplicate rows to new search results.
const byId = new Map(entries.map((entry) => [entry.id, entry]));
function keepHistory(oldRoute, labels, targetRoute, anchor) {
  for (const label of labels) {
    const oldId = `${oldRoute}#${label}`;
    if (byId.has(oldId)) continue;
    const entry = byId.get(anchor ? `${targetRoute}#${anchor}` : `${targetRoute}#${label}`) ?? byId.get(targetRoute);
    if (!entry) throw new Error(`Missing destination for previous settings result ${oldId}`);
    entry.legacyIds = [...(entry.legacyIds ?? []), oldId];
    entry.aliases = [...new Set([...(entry.aliases ?? []), label, titleOf(label)])];
  }
}
for (const [label, target] of [
  ['Listening statistics', '/settings/listening-stats'], ['Smart playlists', '/settings/smart-playlists'],
  ['Duplicates and versions', '/settings/duplicates'], ['Playlist import and export', '/settings/playlist-exchange'],
]) keepHistory('/settings/library', [label], target);
keepHistory('/settings/downloads', ['Podcast storage'], '/settings/podcast-storage');
for (const [label, target] of [['Home screen widgets', '/settings/home-widgets'], ['Wi-Fi music transfer', '/settings/wifi-transfer']]) {
  keepHistory('/settings/listening-tools', [label], target);
}
keepHistory('/settings/lyrics-tools', ['Lyric fonts'], '/settings/lyric-fonts');
for (const [label, target] of [
  ['Home and search layouts', '/settings/discovery-layout'], ['Pinyin library search', '/settings/music-search'],
  ['Listening scenes', '/listening-intents'], ['Discover internet radio', '/radio-discover'], ['Media folders and tags', '/media-collections'],
  ['Listening sessions, groups and chapters', '/settings/listening-tools'], ['Local edits and artist aliases', '/settings/local-customizations'],
  ['Lyric language fonts', '/settings/lyric-fonts'], ['Home screen widgets', '/settings/home-widgets'],
  ['Personal backup and restore', '/settings/personal-backup'], ['Wi-Fi music transfer', '/settings/wifi-transfer'],
  ['Pending favorites and ratings', '/settings/pending-marks'], ['Playlist recovery', '/settings/playlist-recovery'],
  ['Playlist import and export', '/settings/playlist-exchange'],
]) keepHistory('/settings/music-tools', [label], target);
keepHistory('/settings/personalization', ['Home and search layouts'], '/settings/discovery-layout');
keepHistory('/settings/personalization', ['Lyric language fonts'], '/settings/lyric-fonts');
keepHistory('/settings/personalization', ['Apple Music style', 'Spotify style'], '/settings/page-layouts', 'UI style');
keepHistory('/settings/personalization', ['Primuse', 'Artist page layout', 'Volta', 'Minidisc'], '/settings/page-layouts', 'Album page style');
keepHistory('/settings/personalization', ['Compact layout'], '/settings/page-layouts', 'Playlist page style');
keepHistory('/settings/personalization', ['Cover corners', 'Song lists'], '/settings/page-layouts');
keepHistory('/settings/personalization', ['Always show the navigation bar', 'Show tab names', 'Navigation bar', 'Navigation bar blur',
  'Open the app on', 'Swipe right', 'Swipe left', 'Haptic feedback'], '/settings/interface');
keepHistory('/settings/personalization', ['Explore sections', 'Your library chips', 'Folder browsing', 'Home title', 'Playing on other devices',
  'Home buttons', 'Quick grid', 'Home chips', 'Home sections', 'Greeting', 'Start on your playlists'], '/settings/home-layout');
keepHistory('/settings/player', ['Lyrics tools'], '/settings/lyrics-tools');
keepHistory('/settings/player', ['Long audio and bookmarks'], '/settings/long-audio');
keepHistory('/settings/player', ['Shuffle preference', 'Skip leading and trailing silence'], '/settings/playback');
keepHistory('/settings/theme', ['System', 'Dark', 'Light', 'Scheduled'], '/settings/theme', 'Mode');
keepHistory('/settings/theme', ['Choose a color', 'Follow album artwork'], '/settings/theme', 'Accent color');
writeFileSync(new URL('src/lib/settingsSearchEntries.ts', root), `/** Generated from real SettingsUI control labels by scripts/generate-settings-search-index.mjs. */\nimport type { SettingsSearchEntry } from './settingsSearch';\nimport { SETTINGS_SEARCH_EXTRAS } from './settingsSearchExtras';\nexport const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [...${JSON.stringify(entries, null, 2)}, ...SETTINGS_SEARCH_EXTRAS];\n`);
process.stdout.write(`${entries.length} settings routes and controls indexed.\n`);
