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
    ['/settings/personalization#Home title', '/settings/home-layout', 'Home title'],
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
