import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import * as math from '../src/lib/listeningMath';
import * as presentation from '../src/lib/listeningPresentation';
import type { ListeningReport } from '../src/lib/listeningDb';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const element = React.createElement;
function flatten(style: unknown): Record<string, any> {
  return Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : typeof style === 'object' && style !== null ? style as Record<string, any> : {};
}
function sample(): ListeningReport {
  const song = { id: 'song', title: 'Recorded song', artist: 'Artist', artistId: 'artist', album: 'Album', albumId: 'album' };
  return { seconds: 3600, plays: 8, songs: 3, activeDays: 2, artistCount: 1, albumCount: 1,
    days: [{ day: '2026-11-11', seconds: 1800, plays: 3 }, { day: '2026-11-12', seconds: 1800, plays: 5 }],
    top: [{ song, seconds: 3600, plays: 8 }], artists: [{ name: 'Artist', seconds: 3600 }],
    artistRanks: [{ key: 'artist', id: 'artist', name: 'Artist', song, seconds: 3600, plays: 8 }],
    albumRanks: [{ key: 'album', id: 'album', name: 'Album', artist: 'Artist', song, seconds: 3600, plays: 8 }],
  };
}
const translate = (key: string, values?: Record<string, string | number>) => key.replace(/\{(\w+)\}/g, (_m, name) => String(values?.[name] ?? `{${name}}`));
function modules(mode: 'dark' | 'light' = 'dark', corrections: Record<string, { title?: string; artist?: string; album?: string }> = {}) {
  const colors = { background: mode === 'dark' ? '#141619' : '#ffffff', surface: mode === 'dark' ? '#1e2026' : '#f2f3f5',
    surfaceHighlight: mode === 'dark' ? '#2a2c33' : '#e6e8ed', text: mode === 'dark' ? '#ffffff' : '#111111',
    textSecondary: mode === 'dark' ? '#a0a3ab' : '#555555', textMuted: '#777777', accent: '#1db954', border: '#34363c' };
  const imports: Record<string, any> = {
    react: React, 'react/jsx-runtime': JSX,
    'react-native': { ActivityIndicator: 'Spinner', View: 'View', Text: 'Text', Pressable: 'Button' },
    '@/components/Icon': { __esModule: true, default: 'Icon' }, '@/components/Cover': { Cover: 'Cover' },
    '@/components/SettingsUI': { SelectList: 'Select' },
    '@/components/SettingAnchor': { SettingAnchor: ({ children }: { children: React.ReactNode }) => element(React.Fragment, null, children) },
    '@/hooks/useLocalMetadata': { useDisplaySong: (song: { id: string }) => ({ ...song, ...corrections[song.id] }) },
    '@/i18n': { useT: () => translate }, '@/lib/listeningMath': math, '@/lib/listeningPresentation': presentation,
    '@/api/data': { COVER: { thumb: 80 }, coverArtUrl: (id?: string) => id ? `artist:${id}` : undefined, songCoverUrl: (song: { id: string }) => `song:${song.id}` },
    '@/theme': { useTheme: () => colors, useThemeMode: () => mode, fontSize: { sm: 14, md: 16, lg: 20, xl: 24 }, themed: (factory: (palette: typeof colors) => unknown) => factory(colors) },
  };
  const load = (name: string) => {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/components/stats/${name}.tsx`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, require(key: string) { assert.ok(Object.hasOwn(imports, key), key); return imports[key]; } });
    return exports;
  };
  return { dashboard: load('ListeningDashboard'), rankings: load('ListeningRankings'), colors };
}
function props(more: Record<string, unknown> = {}) {
  return { report: sample(), period: 'week', year: 2026, at: new Date(2026, 10, 12, 12).getTime(), range: { from: '2026-11-06', until: '2026-11-13' },
    language: 'en-US', kind: 'music', pending: false, refreshing: false, error: false,
    controls: element('Controls'), rankingControls: element('RankingControls'), podium: element('Podium'), onRefresh() {}, ...more };
}
const inlineText = (value: any): string => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(inlineText).join('') : React.isValidElement<{ children?: React.ReactNode }>(value) ? inlineText(value.props.children) : '';
const texts = (root: ReactTestRenderer) => root.root.findAllByType('Text' as any).map((node) => inlineText(node.props.children));
const buttons = (root: ReactTestRenderer) => root.root.findAllByType('Button' as any);

test('actual dashboard distinguishes loading, failed reads and a genuinely empty period in both appearances', async () => {
  for (const mode of ['dark', 'light'] as const) {
    const { dashboard } = modules(mode); let root!: ReactTestRenderer; let retries = 0;
    try {
      await act(async () => { root = create(element(dashboard.ListeningDashboardHeader, props({ report: undefined, pending: true }))); });
      const metricLabels = root.root.findAllByType('View' as any).map((node) => node.props.accessibilityLabel).filter((value) => typeof value === 'string');
      assert.ok(metricLabels.includes('Listening time: —')); assert.ok(metricLabels.includes('Qualified plays: —'));
      assert.ok(texts(root).includes('Loading listening report')); assert.ok(!texts(root).includes('Your next listen starts the story'));
      await act(async () => { root.update(element(dashboard.ListeningDashboardHeader, props({ report: undefined, pending: false, error: true, onRefresh: () => { retries++; } }))); });
      assert.equal(root.root.findAllByProps({ accessibilityRole: 'alert' }).length, 1);
      const retry = buttons(root).find((button) => button.findAllByType('Text' as any).some((node) => node.props.children === 'Retry'))!;
      await act(async () => retry.props.onPress()); assert.equal(retries, 1);
      const empty = { ...sample(), seconds: 0, plays: 0, songs: 0, days: [], activeDays: 0, top: [], artistRanks: [], albumRanks: [] };
      await act(async () => { root.update(element(dashboard.ListeningDashboardHeader, props({ report: empty }))); });
      assert.ok(texts(root).includes('Your next listen starts the story'));
      assert.ok(!texts(root).includes('Listening rankings')); assert.ok(!texts(root).includes('Listening calendar'));
    } finally { await act(async () => root?.unmount()); }
  }
});

test('actual calendar disables days outside the selected week and shows real day details when selected', async () => {
  const { dashboard } = modules(); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(element(dashboard.ListeningDashboardHeader, props())); });
    const days = () => buttons(root).filter((button) => /^2026-\d{2}-\d{2}/.test(button.props.accessibilityLabel ?? ''));
    assert.equal(days().length, 42); assert.equal(days().filter((button) => !button.props.disabled).length, 7);
    assert.equal(days().find((button) => button.props.accessibilityLabel === '2026-11-05')!.props.disabled, true);
    const day = days().find((button) => button.props.accessibilityLabel.startsWith('2026-11-12:'))!;
    assert.equal(day.props.disabled, false); await act(async () => day.props.onPress());
    assert.ok(texts(root).includes('30 Minutes · 5 plays'));
    assert.equal(days().find((button) => button.props.accessibilityLabel.startsWith('2026-11-12:'))!.props.accessibilityState.selected, true);
    assert.equal(buttons(root).find((button) => button.props.accessibilityLabel === 'Previous month')!.props.disabled, true);
    assert.equal(buttons(root).find((button) => button.props.accessibilityLabel === 'Next month')!.props.disabled, true);
  } finally { await act(async () => root?.unmount()); }
});

test('calendar month navigation respects an exclusive year end instead of offering an empty following January', async () => {
  const { dashboard } = modules(); let root!: ReactTestRenderer;
  const data = { ...sample(), days: [{ day: '2025-12-20', seconds: 3600, plays: 8 }] };
  try {
    await act(async () => { root = create(element(dashboard.ListeningDashboardHeader, props({ report: data, period: 'year', year: 2025,
      range: { from: '2025-01-01', until: '2026-01-01' } }))); });
    assert.ok(texts(root).includes('December 2025'));
    const next = () => buttons(root).find((button) => button.props.accessibilityLabel === 'Next month')!;
    assert.equal(next().props.disabled, true);
    await act(async () => buttons(root).find((button) => button.props.accessibilityLabel === 'Previous month')!.props.onPress());
    assert.ok(texts(root).includes('November 2025')); assert.equal(next().props.disabled, false);
    await act(async () => next().props.onPress()); assert.ok(texts(root).includes('December 2025')); assert.equal(next().props.disabled, true);
  } finally { await act(async () => root?.unmount()); }
});

test('an impossible legacy day cannot crash the all-time calendar or erase its preserved report totals', async () => {
  const { dashboard } = modules(); let root!: ReactTestRenderer;
  const data = { ...sample(), days: [{ day: '2026-00-05', seconds: 3600, plays: 8 }] };
  try {
    await act(async () => { root = create(element(dashboard.ListeningDashboardHeader, props({ report: data, period: 'all',
      range: { from: '1970-01-01', until: '2026-11-13' } }))); });
    assert.ok(texts(root).includes('November 2026'));
    const metricLabels = root.root.findAllByType('View' as any).map((node) => node.props.accessibilityLabel);
    assert.ok(metricLabels.includes('Listening time: 1 Hours')); assert.ok(metricLabels.includes('Qualified plays: 8'));
    assert.equal(buttons(root).filter((button) => /^2026-\d{2}-\d{2}/.test(button.props.accessibilityLabel ?? '')).length, 42);
    assert.deepEqual(presentation.listeningCalendarCells('2026-00', data.days, '1970-01-01', '2026-11-13'), []);
    assert.deepEqual(presentation.listeningCalendarCells('2026-13', data.days, '1970-01-01', '2026-11-13'), []);
    assert.equal(presentation.listeningDateLabel('2026-00-05', 'en-US'), '2026-00-05');
  } finally { await act(async () => root?.unmount()); }
});

test('chart selection and accessibility adjustment keep the chosen day when switching from time to qualified plays', async () => {
  const { dashboard } = modules(); let root!: ReactTestRenderer;
  try {
    await act(async () => { root = create(element(dashboard.ListeningDashboardHeader, props())); });
    const chart = () => buttons(root).find((button) => button.props.accessibilityRole === 'adjustable')!;
    await act(async () => { chart().props.onLayout({ nativeEvent: { layout: { width: 700 } } }); });
    await act(async () => chart().props.onPress({ nativeEvent: { locationX: 650 } }));
    assert.equal(chart().props.accessibilityValue.now, 6); assert.match(chart().props.accessibilityValue.text, /Nov 12: 30 Minutes/);
    const playCount = chart().parent!.findAllByType('Button' as any).find((button) => button.findAllByType('Text' as any).some((node) => node.props.children === 'Play count'))!;
    await act(async () => playCount.props.onPress()); assert.match(chart().props.accessibilityValue.text, /Nov 12: 5 plays/);
    await act(async () => chart().props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
    assert.equal(chart().props.accessibilityValue.now, 5); assert.match(chart().props.accessibilityValue.text, /Nov 11: 3 plays/);
  } finally { await act(async () => root?.unmount()); }
});

test('podium order, artwork and ranking bars preserve IDs and leave unresolvable artist names noninteractive', async () => {
  const { rankings, colors } = modules(); let root!: ReactTestRenderer;
  const items = [0, 1, 2].map((index) => ({ key: `artist:${index}`, kind: 'artists' as const, id: `artist-${index}`, title: ['First', 'Second', 'Third'][index],
    song: { id: `song-${index}`, title: 'Song' }, seconds: 1800 - index * 100, plays: 8 - index }));
  const opened: presentation.ListeningRankItem[] = [];
  try {
    await act(async () => { root = create(element(rankings.ListeningPodium, { items, language: 'en-US', onOpen: (item: presentation.ListeningRankItem) => opened.push(item) })); });
    assert.deepEqual(buttons(root).map((button) => button.props.accessibilityLabel), ['Rank 2: Second', 'Rank 1: First', 'Rank 3: Third']);
    assert.deepEqual(root.root.findAllByType('Cover' as any).map((cover) => cover.props.uri), ['artist:artist-1', 'artist:artist-0', 'artist:artist-2']);
    await act(async () => buttons(root)[1].props.onPress()); assert.equal(opened[0], items[0]);
    const item = { ...items[0], kind: 'songs' as const, title: 'Song' };
    await act(async () => { root.update(element(rankings.ListeningRankRow, { item, position: 1, language: 'en-US', sort: 'plays', peak: 10, current: true, onOpen() {} })); });
    const fill = root.root.findAllByType('View' as any).find((node) => flatten(node.props.style).height === '100%')!;
    assert.equal(flatten(fill.props.style).width, '80%');
    const title = root.root.findAllByType('Text' as any).find((node) => node.props.children === 'Song')!;
    assert.equal(flatten(title.props.style).color, colors.accent); assert.ok(texts(root).includes('8 plays')); assert.ok(texts(root).includes('30 Minutes'));
    await act(async () => { root.update(element(rankings.ListeningRankRow, { item: { ...items[0], id: undefined }, position: 1,
      language: 'en-US', sort: 'seconds', peak: 3600, current: false, onOpen() {} })); });
    assert.equal(buttons(root)[0].props.disabled, true);
  } finally { await act(async () => root?.unmount()); }
});

test('podium promotes the selected ranking metric while retaining the other real value below it', async () => {
  const { rankings } = modules(); let root!: ReactTestRenderer;
  const items = [0, 1, 2].map((index) => ({ key: `song:${index}`, kind: 'songs' as const, id: `song-${index}`, title: `Song ${index}`,
    song: { id: `song-${index}`, title: `Song ${index}` }, seconds: 1800, plays: 8 - index }));
  try {
    await act(async () => { root = create(element(rankings.ListeningPodium, { items, language: 'en-US', sort: 'plays', onOpen() {} })); });
    let winner = buttons(root).find((button) => button.props.accessibilityLabel === 'Rank 1: Song 0')!;
    const primary = (button: typeof winner) => button.findAllByType('Text' as any).find((node) => flatten(node.props.style).fontSize === 12)!;
    const secondary = (button: typeof winner) => button.findAllByType('Text' as any).find((node) => flatten(node.props.style).fontSize === 10)!;
    assert.equal(inlineText(primary(winner).props.children), '8 plays'); assert.equal(inlineText(secondary(winner).props.children), '30 Minutes');
    await act(async () => { root.update(element(rankings.ListeningPodium, { items, language: 'en-US', sort: 'seconds', onOpen() {} })); });
    winner = buttons(root).find((button) => button.props.accessibilityLabel === 'Rank 1: Song 0')!;
    assert.equal(inlineText(primary(winner).props.children), '30 Minutes'); assert.equal(inlineText(secondary(winner).props.children), '8 plays');
  } finally { await act(async () => root?.unmount()); }
});

test('private display corrections appear in rows and podium without replacing original navigation identities', async () => {
  const corrections = Object.fromEntries([0, 1, 2].map((index) => [`source-${index}`, { title: `Private title ${index}`, artist: `Private artist ${index}`, album: `Private album ${index}` }]));
  const { rankings } = modules('dark', corrections); let root!: ReactTestRenderer;
  const opened: presentation.ListeningRankItem[] = [];
  try {
    for (const kind of ['songs', 'artists', 'albums'] as const) {
      const items = [0, 1, 2].map((index) => ({ key: `${kind}:${index}`, kind, id: `${kind}-original-${index}`, title: `Server name ${index}`,
        song: { id: `source-${index}`, title: `Server title ${index}`, artist: 'Server artist', album: 'Server album' }, seconds: 1800, plays: 8 - index }));
      const title = kind === 'songs' ? 'Private title 0' : kind === 'artists' ? 'Private artist 0' : 'Private album 0';
      await act(async () => {
        if (root) root.update(element(rankings.ListeningRankRow, { item: items[0], position: 1, language: 'en-US', sort: 'seconds', peak: 1800, current: false, onOpen: (item: presentation.ListeningRankItem) => opened.push(item) }));
        else root = create(element(rankings.ListeningRankRow, { item: items[0], position: 1, language: 'en-US', sort: 'seconds', peak: 1800, current: false, onOpen: (item: presentation.ListeningRankItem) => opened.push(item) }));
      });
      assert.ok(texts(root).includes(title)); assert.equal(buttons(root)[0].props.accessibilityLabel, `Rank 1: ${title}`);
      await act(async () => buttons(root)[0].props.onPress()); assert.equal(opened.at(-1), items[0]); assert.equal(opened.at(-1)?.song.id, 'source-0');
      await act(async () => { root.update(element(rankings.ListeningPodium, { items, language: 'en-US', sort: 'plays', onOpen: (item: presentation.ListeningRankItem) => opened.push(item) })); });
      const winner = buttons(root).find((button) => button.props.accessibilityLabel === `Rank 1: ${title}`)!; assert.ok(winner);
      await act(async () => winner.props.onPress()); assert.equal(opened.at(-1), items[0]); assert.equal(opened.at(-1)?.id, `${kind}-original-0`);
      const winnerCover = winner.findAllByType('Cover' as any)[0];
      assert.equal(winnerCover.props.uri, kind === 'artists' ? 'artist:artists-original-0' : 'song:source-0');
    }
  } finally { await act(async () => root?.unmount()); }
});

test('heatmap text stays readable against the actual blended cell across dark/light themes and accent colors', () => {
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const surface of ['#FFFFFF', '#F2F3F5', '#141619', '#1E2026', '#000000']) {
    for (const accent of ['#FFFFFF', '#000000', '#1DB954', '#FFDD00', '#3377CC', '#E11655', '#708150', '#808080', 'invalid']) {
      for (const fraction of [-1, 0, 0.1, 0.4, 0.7, 1, Infinity, NaN]) {
        const tone = presentation.listeningHeatmapTone(accent, surface, fraction);
        assert.match(tone.backgroundColor, /^#[0-9a-f]{6}$/i); assert.ok(tone.color === '#000000' || tone.color === '#FFFFFF');
        const a = luminance(tone.color), b = luminance(tone.backgroundColor);
        const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        assert.ok(contrast >= 4.5, `${surface}/${accent}/${fraction}: ${contrast}`);
      }
    }
  }
});

test('calendar grids retain the same local-day membership through DST in multiple host timezones', () => {
  const script = `import {listeningCalendarCells,calendarMonthShift} from './src/lib/listeningPresentation.ts';
    const rows=listeningCalendarCells('2026-03',[{day:'2026-03-08',seconds:120,plays:2}],'2026-03-06','2026-03-13');
    console.log(JSON.stringify({keys:rows.filter(row=>row.enabled).map(row=>row.key),recorded:rows.find(row=>row.key==='2026-03-08'),next:calendarMonthShift('2026-03',1)}));`;
  const outputs = ['Asia/Shanghai', 'America/New_York', 'Europe/Berlin'].map((TZ) => JSON.parse(execFileSync(process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', './scripts/ts-register.mjs', '--input-type=module', '-e', script],
    { cwd: new URL('..', import.meta.url), env: { ...process.env, TZ }, encoding: 'utf8' })));
  assert.deepEqual(outputs[0], outputs[1]); assert.deepEqual(outputs[1], outputs[2]);
  assert.deepEqual(outputs[0].keys, ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12']);
  assert.equal(outputs[0].recorded.seconds, 120); assert.equal(outputs[0].next, '2026-04');
});
