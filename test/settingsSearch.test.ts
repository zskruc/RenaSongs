import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { SETTINGS_SEARCH_ENTRIES } from '../src/lib/settingsSearchEntries';
import { withSettingsSearchAliases } from '../src/lib/settingsSearchExtras';
import { createSettingsSearchHistory, normalizeSettingsQuery, searchSettings, settingsRecentIds, settingScrollOffset } from '../src/lib/settingsSearch';

const entries = SETTINGS_SEARCH_ENTRIES.map(withSettingsSearchAliases);
function sourceForRoute(route: string): URL {
  const direct = new URL(`../src/app${route}.tsx`, import.meta.url);
  return existsSync(direct) ? direct : new URL(`../src/app${route}/index.tsx`, import.meta.url);
}
test('the real registry points at existing settings screens, has unique ids and indexes real labelled options', () => {
  const ids = new Set<string>();
  for (const entry of entries) {
    assert.ok(!ids.has(entry.id), entry.id); ids.add(entry.id);
    assert.ok(entry.route.startsWith('/'));
    assert.ok(existsSync(sourceForRoute(entry.route)), entry.route);
    if (entry.anchor) assert.ok(readFileSync(sourceForRoute(entry.route), 'utf8').includes(entry.anchor), entry.id);
  }
  assert.ok(entries.length > 180);
  assert.ok(entries.some((entry) => entry.route === '/settings/player' && !!entry.anchor));
  for (const entry of entries) for (const id of entry.legacyIds ?? []) {
    assert.ok(!ids.has(id), `History alias collides with a live result: ${id}`); ids.add(id);
  }
});
test('every settings page and the previously hidden metadata tools have a searchable category path', () => {
  for (const name of readdirSync(new URL('../src/app/settings/', import.meta.url))) {
    if (!name.endsWith('.tsx') || ['index.tsx', 'search.tsx'].includes(name)) continue;
    const route = `/settings/${name.slice(0, -4)}`;
    const entry = entries.find((item) => item.id === route);
    assert.ok(entry, `Missing Settings page ${route}`);
    assert.ok(entry.breadcrumbs?.length, `Missing category path for ${route}`);
    assert.equal(entry.breadcrumbs.at(-1), entry.section);
  }
  for (const route of ['/metadata', '/metadata/bulk', '/metadata/sources']) {
    const entry = entries.find((item) => item.id === route);
    assert.ok(entry, `Missing metadata entry ${route}`);
    assert.equal(entry.breadcrumbs?.[0], 'Library & metadata');
  }
});
test('recent search IDs follow moved lyric and backup controls without retaining obsolete destinations', () => {
  for (const label of ['Export settings', 'Import settings', 'Restore default settings']) {
    const entry = entries.find((item) => item.id === `/settings/about#${label}`);
    assert.equal(entry?.route, '/settings/preferences-file', label);
    assert.equal(entry.anchor, label);
    assert.equal(entry.breadcrumbs?.[0], 'Backup & transfer');
  }
  for (const label of ['Lyrics source', 'Lyrics size', 'Lyrics weight', 'Lyrics alignment', 'Blur inactive lyrics',
    'Show lyrics card', 'Lyrics background', 'Lyrics card background']) {
    const entry = entries.find((item) => item.id === `/settings/player#${label}`);
    assert.equal(entry?.route, '/settings/lyrics', label);
    assert.equal(entry.anchor, label);
    assert.equal(entry.breadcrumbs?.[0], 'Player & lyrics');
  }
});
test('category keywords find related controls and exact option names still rank first', () => {
  const results = searchSettings(entries, 'Downloads & storage');
  for (const route of ['/settings/downloads', '/settings/download-manager', '/settings/media-cache', '/settings/podcast-storage']) {
    assert.ok(results.some((entry) => entry.route === route), route);
  }
  assert.equal(searchSettings(entries, 'Lyrics size')[0]?.anchor, 'Lyrics size');
  assert.equal(searchSettings(entries, 'Batch scrape metadata')[0]?.route, '/metadata/bulk');
  assert.equal(searchSettings(entries, 'Lyrics')[0]?.route, '/settings/lyrics');
});
test('recent history for moved navigation and collapsed choices resolves to one current destination', async () => {
  const index = new Map(entries.flatMap((entry) => [entry.id, ...(entry.legacyIds ?? [])].map((id) => [id, entry] as const)));
  const previous: [string, string, string | undefined][] = [
    ['/settings/personalization#Spotify style', '/settings/page-layouts', 'UI style'],
    ['/settings/personalization#Swipe right', '/settings/interface', 'Swipe right'],
    ['/settings/personalization#Home title', '/settings/home-title', undefined],
    ['/settings/library#Smart playlists', '/settings/smart-playlists', undefined],
    ['/settings/music-tools#Pending favorites and ratings', '/settings/pending-marks', undefined],
    ['/settings/theme#Follow album artwork', '/settings/theme', 'Accent color'],
  ];
  const history = createSettingsSearchHistory({ read: async () => JSON.stringify(previous.map(([id]) => id)), write: async () => {} }, new Set(index.keys()));
  const saved = await history.load('existing-account');
  assert.equal(saved.length, 5);
  for (const [id, route, anchor] of previous) {
    const destination = index.get(id);
    assert.equal(destination?.route, route, id);
    assert.equal(destination?.anchor, anchor, id);
  }
  assert.ok(searchSettings(entries, 'Follow album artwork').some((entry) => entry.route === '/settings/theme' && entry.anchor === 'Accent color'));
  assert.ok(searchSettings(entries, 'Spotify style').some((entry) => entry.route === '/settings/page-layouts' && entry.anchor === 'UI style'));
});
test('navigation links canonicalize to the destination page while keeping every previous link ID usable', () => {
  const index = new Map(entries.flatMap((entry) => [entry.id, ...(entry.legacyIds ?? [])].map((id) => [id, entry] as const)));
  for (const [oldId, route] of [
    ['/settings/personalization#Glass tuning', '/settings/glass'],
    ['/settings/playback#Equalizer', '/settings/equalizer'],
    ['/settings/player#Lyrics', '/settings/lyrics'],
    ['/settings/lyrics#Lyric sources', '/settings/lyric-sources'],
    ['/metadata#Batch scrape metadata', '/metadata/bulk'],
    ['/metadata#Custom scraping sources', '/metadata/sources'],
  ]) {
    assert.equal(index.get(oldId)?.id, route, oldId);
    assert.equal(index.get(oldId)?.route, route, oldId);
    assert.equal(index.get(oldId)?.anchor, undefined, oldId);
    assert.equal(entries.some((entry) => entry.id === oldId), false, 'the intermediate link is not another visible result');
  }
  for (const query of ['boli', 'Glass tuning', '玻璃调节室']) {
    const glass = searchSettings(entries, query).filter((entry) => entry.title === 'Glass tuning');
    assert.equal(glass.length, 1, query);
    assert.equal(glass[0].route, '/settings/glass');
  }
  // Same-page controls and actions are distinct from a navigation row.
  for (const [id, route, anchor] of [
    ['/settings/player#Lyrics source', '/settings/lyrics', 'Lyrics source'],
    ['/settings/player#Blur inactive lyrics', '/settings/lyrics', 'Blur inactive lyrics'],
    ['/settings/page-layouts#Album page style', '/settings/page-layouts', 'Album page style'],
    ['/settings/about#Import settings', '/settings/preferences-file', 'Import settings'],
  ]) {
    assert.equal(index.get(id)?.route, route, id);
    assert.equal(index.get(id)?.anchor, anchor, id);
  }
});

test('the generator proves direct static navigation instead of collapsing lookalike actions or conditional controls', () => {
  const generator = ts.createSourceFile('generator.js', readFileSync(new URL('../scripts/generate-settings-search-index.mjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = generator.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'navigationTarget');
  assert.ok(fn);
  const api: Record<string, any> = {};
  runInNewContext(`${fn.getText(generator)}\nexports.navigationTarget=navigationTarget;`, { ts, exports: api });
  for (const [callback, expected] of [
    ["() => router.push('/settings/glass')", '/settings/glass'],
    ["() => { router.push('/metadata/bulk'); }", '/metadata/bulk'],
    ["() => { return router.push('/metadata/sources'); }", '/metadata/sources'],
    ["() => { save(); router.push('/settings/glass'); }", undefined],
    ["() => enabled ? router.push('/settings/glass') : save()", undefined],
    ["() => router.push(target)", undefined],
    ["() => provider.push('/settings/glass')", undefined],
    ["() => router.push({ pathname: '/metadata/task', params: { id } })", undefined],
  ] as const) {
    const source = ts.createSourceFile('row.tsx', `<SettingRow onPress={${callback}} />`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let initializer: ts.JsxAttributeValue | undefined;
    function find(node: ts.Node) {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onPress') initializer = node.initializer;
      node.forEachChild(find);
    }
    find(source);
    assert.equal(api.navigationTarget(initializer, source), expected, callback);
  }
});
test('search matches English and Chinese regardless of app language, with common pinyin and initialisms', () => {
  for (const query of ['玻璃', 'bo li', 'bōlí', 'LIQUID GLASS', 'ｂｏｌｉ']) {
    assert.ok(searchSettings(entries, query).some((entry) => entry.route === '/settings/glass'), query);
  }
  for (const query of ['歌词', 'geci', 'gc']) assert.ok(searchSettings(entries, query).some((entry) => /lyric/i.test(entry.title)), query);
  for (const query of ['音质', 'yinzhi', 'wusun']) assert.ok(searchSettings(entries, query).some((entry) => entry.route === '/settings/playback'), query);
  assert.equal(normalizeSettingsQuery('Bō Fàng'), 'bofang');
  assert.deepEqual(searchSettings(entries, 'impossible_setting_8270913'), []);
});
test('an exact option wins over broad page aliases and multi-term lyric blur has an exact destination row', () => {
  const first = searchSettings(entries, 'Blur inactive lyrics')[0];
  assert.ok(first); assert.equal(first.anchor, 'Blur inactive lyrics');
  for (const query of ['歌词模糊', 'ge ci mo hu', 'gc mh']) assert.ok(searchSettings(entries, query).some((entry) => entry.anchor === first.anchor), query);
});
test('recent settings are unique, known, capped at five and isolated per captured account key', async () => {
  const data = new Map<string, string>(), valid = new Set(['a', 'b', 'c', 'd', 'e', 'f']);
  const h = createSettingsSearchHistory({ read: async (key) => data.get(key) ?? null, write: async (key, text) => { data.set(key, text); } }, valid);
  await Promise.all(['a', 'b', 'c', 'd', 'e', 'f', 'c'].map((id) => h.add('accountA', id)));
  assert.deepEqual(await h.load('accountA'), ['c', 'f', 'e', 'd', 'b']);
  assert.deepEqual(await h.load('accountB'), []);
  await h.add('accountB', 'a'); await h.clear('accountA');
  assert.deepEqual(await h.load('accountA'), []); assert.deepEqual(await h.load('accountB'), ['a']);
  await assert.rejects(h.add('accountB', 'invented'), /Unknown/);
  assert.deepEqual(settingsRecentIds(['bad', 'a', 'a', 3, 'b'], valid), ['a', 'b']);
});
test('a failed history read never overwrites an unread previous record, and a failed write remains retryable', async () => {
  let readFails = true, writes = 0, writeFails = true, saved = '["a"]';
  const h = createSettingsSearchHistory({ read: async () => { if (readFails) throw new Error('KeyStore unavailable'); return saved; },
    write: async (_key, text) => { writes++; if (writeFails) throw new Error('write failed'); saved = text; } }, new Set(['a', 'b']));
  await assert.rejects(h.add('A', 'b'), /KeyStore/); assert.equal(writes, 0);
  readFails = false; await assert.rejects(h.add('A', 'b'), /write failed/);
  writeFails = false; await h.add('A', 'b'); assert.deepEqual(await h.load('A'), ['b', 'a']);
});
test('search row scroll offsets preserve the target margin without negative or nonfinite movement', () => {
  assert.equal(settingScrollOffset(400), 382); assert.equal(settingScrollOffset(8), 0);
  assert.equal(settingScrollOffset(-5), 0); assert.equal(settingScrollOffset(NaN), 0);
});
test('the real generator resolves conditional page headings to their translated base title, not a lowercase route slug', () => {
  const generator = ts.createSourceFile('generator.js', readFileSync(new URL('../scripts/generate-settings-search-index.mjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = generator.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'translated');
  assert.ok(fn);
  const api: Record<string, any> = {};
  runInNewContext(`${fn.getText(generator)}\nexports.translated=translated;`, { ts, exports: api });
  for (const [route, expected] of [['lyric-sources', 'Lyric sources'], ['library', 'Library']]) {
    const source = ts.createSourceFile('page.tsx', readFileSync(new URL(`../src/app/settings/${route}.tsx`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let expression: ts.Expression | undefined;
    function find(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'SettingsPage') {
        const title = node.attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText(source) === 'title');
        if (title?.initializer && ts.isJsxExpression(title.initializer)) expression = title.initializer.expression;
      }
      node.forEachChild(find);
    }
    source.forEachChild(find); assert.ok(expression);
    assert.equal(api.translated(expression), expected);
    const indexed = entries.find((entry) => entry.id === `/settings/${route}`);
    assert.equal(indexed?.title, expected);
    assert.ok(indexed?.chinese && indexed.chinese !== route.replaceAll('-', ' '));
    assert.ok(entries.filter((entry) => entry.route === `/settings/${route}`).every((entry) => entry.section === expected));
  }
});

// Historical contract: the 359 IDs before the Settings overhaul (bd485351).
const ORIGINAL_SETTINGS_SEARCH_IDS = `/settings/about
/settings/about#Version
/settings/about#What's new
/settings/about#FAQ
/settings/about#Report a bug
/settings/about#Share diagnostic report
/settings/about#Check for updates
/settings/about#Check for updates automatically
/settings/about#Measure performance
/settings/about#Export settings
/settings/about#Import settings
/settings/about#Restore default settings
/settings/audiobooks
/settings/audiobooks#Browse audiobooks
/settings/audiobooks#Save audiobook progress
/settings/audiobooks#Rewind on resume
/settings/audiobooks#Delete audiobook progress
/settings/cache
/settings/chapters
/settings/chapters#Import TXT / JSON chapters
/settings/chapters#Restore publisher chapters
/settings/chapters#Apply chapter import
/settings/chapters#Cancel
/settings/chapters#Stop after chapter
/settings/chapters#Stop after current chapter
/settings/diagnostics
/settings/diagnostics#Share report
/settings/diagnostics#Start over
/settings/discovery-layout
/settings/discovery-layout#Home sections
/settings/discovery-layout#Music search index
/settings/discovery-layout#Listening intentions
/settings/download-manager
/settings/download-manager#Start all
/settings/download-manager#Pause all
/settings/download-manager#Cancel all
/settings/downloads
/settings/downloads#Download manager
/settings/downloads#Bulk artwork & lyrics
/settings/downloads#Podcast storage
/settings/downloads#Download quality
/settings/downloads#Download codec
/settings/downloads#Transcode lossless files only
/settings/downloads#Simultaneous downloads
/settings/downloads#Download over Wi-Fi only
/settings/downloads#Cache songs you play
/settings/downloads#Cache size
/settings/downloads#Cached songs
/settings/downloads#Automatic offline mode
/settings/downloads#Hide unavailable songs
/settings/downloads#Delete all downloads
/settings/duplicates
/settings/equalizer
/settings/equalizer#Equalizer
/settings/equalizer#Preset
/settings/equalizer#Reset bands
/settings/explore-sections
/settings/font
/settings/font#Remove custom font
/settings/glass
/settings/glass#Background blur
/settings/glass#Refraction strength
/settings/glass#Lens edge depth
/settings/glass#Highlight width
/settings/glass#Highlight intensity
/settings/glass#Tint opacity
/settings/greeting
/settings/greeting#Show greeting
/settings/greeting#Custom greeting
/settings/home-buttons
/settings/home-chips
/settings/home-chips#Show chips
/settings/home-chips#Show icons
/settings/home-sections
/settings/home-title
/settings/home-title#Home title
/settings/home-title#Title preview
/settings/home-widgets
/settings/home-widgets#Continue podcasts
/settings/home-widgets#Listening statistics
/settings/home-widgets#Current lyrics
/settings/language
/settings/language#Help translate
/settings/library-chips
/settings/library
/settings/library#Source
/settings/library#Add another folder
/settings/library#Rescan
/settings/library#Change source
/settings/library#Scan status
/settings/library#Scan now
/settings/library#Listening statistics
/settings/library#Smart playlists
/settings/library#Duplicates and versions
/settings/library#Playlist import and export
/settings/library#Clear cache
/settings/listening-stats
/settings/listening-stats#Record listening on this device
/settings/listening-stats#Report period
/settings/listening-stats#Year
/settings/listening-stats#All-time most played
/settings/listening-tools
/settings/listening-tools#Retry
/settings/listening-tools#Separate listening sessions
/settings/listening-tools#Linked songs in shuffle
/settings/listening-tools#Local chapters
/settings/listening-tools#Home screen widgets
/settings/listening-tools#Wi-Fi music transfer
/settings/local-customizations
/settings/local-customizations#Correct current song metadata
/settings/local-customizations#Lyric fonts
/settings/local-customizations#Alias preview
/settings/local-customizations#Apply exact aliases
/settings/local-customizations#Undo this alias mapping
/settings/local-customizations#Preview affected loaded items
/settings/local-customizations#Retry
/settings/long-audio
/settings/long-audio#Song
/settings/long-audio#Artist
/settings/long-audio#Saved position
/settings/long-audio#Remember this audio position
/settings/long-audio#Continue playing
/settings/long-audio#Reset saved position
/settings/long-audio#Remove saved audio
/settings/long-audio#Bookmark note
/settings/long-audio#Bookmark current position
/settings/long-audio#Delete bookmark
/settings/long-audio#Retry
/settings/long-audio#Load more
/settings/lyric-fonts
/settings/lyric-fonts#Import app font
/settings/lyric-fonts#Restore default lyric fonts
/settings/lyric-fonts#Retry
/settings/lyric-sources
/settings/lyric-sources#Automatic lyrics
/settings/lyric-sources#Refresh local and server sources
/settings/lyric-sources#Find LRCLIB candidates
/settings/lyric-sources#Retry
/settings/lyrics-tools
/settings/lyrics-tools#Edit and export lyrics
/settings/lyrics-tools#Lyric fonts
/settings/lyrics-tools#Lyric sources
/settings/lyrics-tools#Song
/settings/lyrics-tools#Artist
/settings/lyrics-tools#Lyric timing
/settings/lyrics-tools#Show lyrics earlier
/settings/lyrics-tools#Show lyrics later
/settings/lyrics-tools#Reset this song timing
/settings/lyrics-tools#Retry
/settings/lyrics-tools#Preview lyrics
/settings/lyrics-tools#Lyric poster
/settings/media-cache
/settings/media-cache#Loading…
/settings/media-cache#Continue
/settings/media-cache#Pause
/settings/media-cache#Scan selected items
/settings/media-cache#Retry failed items only
/settings/media-cache#Cancel task
/settings/music-search
/settings/music-search#Indexed songs
/settings/music-search#Last indexed
/settings/music-tools
/settings/music-tools#Home and search layouts
/settings/music-tools#Pinyin library search
/settings/music-tools#Listening scenes
/settings/music-tools#Discover internet radio
/settings/music-tools#Media folders and tags
/settings/music-tools#Listening sessions, groups and chapters
/settings/music-tools#Local edits and artist aliases
/settings/music-tools#Lyric language fonts
/settings/music-tools#Home screen widgets
/settings/music-tools#Personal backup and restore
/settings/music-tools#Wi-Fi music transfer
/settings/music-tools#Pending favorites and ratings
/settings/music-tools#Playlist recovery
/settings/music-tools#Playlist import and export
/settings/navigation-bar
/settings/network
/settings/network#Automatic URL switching
/settings/pending-marks
/settings/pending-marks#Find matching songs
/settings/pending-marks#Apply selected marks
/settings/pending-marks#Keep pending
/settings/personal-backup
/settings/personal-backup#Export personal backup
/settings/personal-backup#Choose backup and preview
/settings/personal-backup#Cancel
/settings/personal-backup#Apply restore
/settings/personal-backup#Keep as missing track
/settings/personalization
/settings/personalization#Home and search layouts
/settings/personalization#Lyric language fonts
/settings/personalization#Apple Music style
/settings/personalization#Spotify style
/settings/personalization#Primuse
/settings/personalization#Artist page layout
/settings/personalization#Volta
/settings/personalization#Minidisc
/settings/personalization#Compact layout
/settings/personalization#Language
/settings/personalization#Theme
/settings/personalization#Glass tuning
/settings/personalization#Font
/settings/personalization#Cover corners
/settings/personalization#Song lists
/settings/personalization#Always show the navigation bar
/settings/personalization#Show tab names
/settings/personalization#Navigation bar
/settings/personalization#Navigation bar blur
/settings/personalization#Explore sections
/settings/personalization#Your library chips
/settings/personalization#Folder browsing
/settings/personalization#Home title
/settings/personalization#Playing on other devices
/settings/personalization#Home buttons
/settings/personalization#Quick grid
/settings/personalization#Home chips
/settings/personalization#Home sections
/settings/personalization#Greeting
/settings/personalization#Open the app on
/settings/personalization#Start on your playlists
/settings/personalization#Swipe right
/settings/personalization#Swipe left
/settings/personalization#Haptic feedback
/settings/playback
/settings/playback#Play downloaded songs from the phone
/settings/playback#Preload upcoming tracks
/settings/playback#Transcode lossless files only
/settings/playback#Streaming quality (Wi-Fi)
/settings/playback#Streaming codec (Wi-Fi)
/settings/playback#Streaming quality (mobile data)
/settings/playback#Streaming codec (mobile data)
/settings/playback#Crossfade
/settings/playback#Normalize volume
/settings/playback#Pre-amp
/settings/playback#Equalizer
/settings/playback#Autoplay
/settings/playback#Pick up the queue from other players
/settings/playback#Scrobbling
/settings/playback#Keep screen on
/settings/playback#Warn about battery optimization
/settings/player-buttons
/settings/player-buttons#Arrangement
/settings/player
/settings/player#Player layout
/settings/player#Lyrics tools
/settings/player#Long audio and bookmarks
/settings/player#Shuffle preference
/settings/player#Skip leading and trailing silence
/settings/player#Floating popup glass
/settings/player#Show system volume
/settings/player#Show output device name
/settings/player#Artwork palette in full player
/settings/player#Player background
/settings/player#Mini player blur
/settings/player#Buttons next to play
/settings/player#Fit cover art
/settings/player#Animated cover background
/settings/player#On cover tap
/settings/player#On cover double tap
/settings/player#Show album & year
/settings/player#Show quality label
/settings/player#Show rating
/settings/player#Scroll long titles
/settings/player#Show artist card
/settings/player#Show previous tracks
/settings/player#Bottom row
/settings/player#Swap favorite and menu
/settings/player#Skip buttons
/settings/player#Keep paused when skipping
/settings/player#Previous button
/settings/player#Lyrics source
/settings/player#Lyrics size
/settings/player#Lyrics weight
/settings/player#Lyrics alignment
/settings/player#Blur inactive lyrics
/settings/player#Show lyrics card
/settings/player#Lyrics background
/settings/player#Lyrics card background
/settings/playlist-exchange
/settings/playlist-exchange#Export JSON playlist
/settings/playlist-exchange#Export M3U8 playlist
/settings/playlist-exchange#Choose playlist file
/settings/playlist-exchange#Import with missing-track placeholders
/settings/playlist-exchange#Save unmatched tracks
/settings/playlist-exchange#Skip this track
/settings/playlist-recovery
/settings/playlist-recovery#Resume interrupted recovery
/settings/playlist-recovery#Discard recovery intent and review again
/settings/playlist-recovery#Scan library for missing tracks
/settings/playlist-recovery#Restore selected matches in place
/settings/playlist-recovery#Keep as missing track
/settings/podcast-storage
/settings/podcast-storage#Total podcast storage
/settings/podcast-storage#Downloaded podcast audio
/settings/podcast-storage#Offline podcast covers
/settings/podcast-storage#Cached podcast catalog
/settings/podcast-storage#Reusable catalog space
/settings/podcast-storage#Refresh storage usage
/settings/podcast-storage#Clear podcast audio downloads
/settings/podcast-storage#Clear offline podcast covers
/settings/podcast-storage#Clear rebuildable podcast catalog
/settings/podcast-storage#Finished automatic downloads
/settings/podcast-storage#Unsubscribed cached catalog
/settings/podcast-storage#Cleanup schedule
/settings/podcast-storage#Last automatic cleanup
/settings/quick-grid
/settings/quick-grid#Show quick grid
/settings/scrobbling
/settings/scrobbling#Part of the song
/settings/scrobbling#Time played
/settings/scrobbling#Restore defaults
/settings/shuffle-links
/settings/shuffle-links#Previous
/settings/shuffle-links#Next
/settings/shuffle
/settings/shuffle#Could not save shuffle preferences. Retry reading saved settings.
/settings/silence-trim
/settings/silence-trim#Skip song-edge silence
/settings/silence-trim#Silence threshold
/settings/silence-trim#Minimum detected silence
/settings/silence-trim#Maximum scan per edge
/settings/silence-trim#Current song
/settings/silence-trim#Analysis status
/settings/silence-trim#Leading silence trimmed
/settings/silence-trim#Trailing silence trimmed
/settings/silence-trim#Analyze current song
/settings/silence-trim#Restore default silence settings
/settings/smart-playlists
/settings/smart-playlists#Saved smart playlists
/settings/smart-playlists#Favorites only
/settings/smart-playlists#No recorded plays
/settings/smart-playlists#Minimum rating
/settings/smart-playlists#Added within
/settings/smart-playlists#Sort by
/settings/smart-playlists#Result limit
/settings/song-lists
/settings/song-lists#Show artwork
/settings/song-lists#Show song duration
/settings/song-lists#Show rating
/settings/song-lists#Show explicit tag
/settings/song-lists#Show description
/settings/song-lists#Show artist photo
/settings/song-lists#Show disc titles
/settings/song-lists#Show genres
/settings/theme
/settings/theme#System
/settings/theme#Dark
/settings/theme#Light
/settings/theme#Scheduled
/settings/theme#Light from
/settings/theme#Dark from
/settings/theme#Pure black
/settings/theme#Choose a color
/settings/theme#Follow album artwork
/settings/wifi-transfer
/settings/wifi-transfer#Choose audio files to share
/settings/wifi-transfer#Share current downloaded track
/settings/wifi-transfer#Copy address`.split('\n');
test('every one of the 359 original Settings search IDs still resolves after navigation canonicalization', () => {
  const index = new Map(entries.flatMap((entry) => [entry.id, ...(entry.legacyIds ?? [])].map((id) => [id, entry] as const)));
  assert.equal(ORIGINAL_SETTINGS_SEARCH_IDS.length, 359);
  for (const id of ORIGINAL_SETTINGS_SEARCH_IDS) assert.ok(index.has(id), `Lost original Settings search result: ${id}`);
});
