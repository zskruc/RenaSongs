import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { Song } from '../src/api/subsonic';
import { songContentKind } from '../src/lib/contentKind';
import { listeningBars, listeningInsights, listeningRange } from '../src/lib/listeningMath';

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  const reads: string[] = [];
  let hold: (() => Promise<void>) | undefined;
  const values = (args: any[]) => args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  const adapter: any = {
    execAsync: async (sql: string) => sqlite.exec(sql),
    runAsync: async (sql: string, ...args: any[]) => sqlite.prepare(sql).run(...values(args)),
    getFirstAsync: async (sql: string, ...args: any[]) => {
      reads.push(sql); const result = sqlite.prepare(sql).get(...values(args)); await hold?.(); return result;
    },
    getAllAsync: async (sql: string, ...args: any[]) => { reads.push(sql); return sqlite.prepare(sql).all(...values(args)); },
    withTransactionAsync: async (work: () => Promise<void>) => {
      sqlite.exec('BEGIN'); try { await work(); sqlite.exec('COMMIT'); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  adapter.withExclusiveTransactionAsync = async (work: (tx: typeof adapter) => Promise<void>) => adapter.withTransactionAsync(() => work(adapter));
  const imports: Record<string, unknown> = {
    'expo-sqlite': { openDatabaseAsync: async () => adapter },
    './currentContentKind': { getSongContentKind: songContentKind }, './smartRules': { normalizeSmartRule: () => null },
  };
  const module: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/listeningDb.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: module, require(name: string) { assert.ok(name in imports, name); return imports[name]; }, setTimeout, clearTimeout });
  const credit = (song: Song, seconds: number, plays: number, day = '2026-11-11', profile = 'A') => {
    module.queueListeningCredit({ profile, day, song, seconds, plays, at: new Date(`${day}T12:00:00`).getTime() });
  };
  return { module, sqlite, reads, credit, holdReads(fn?: () => Promise<void>) { hold = fn; } };
}
const song = (id: string, patch: Partial<Song> = {}): Song => ({ id, title: id, artist: 'Artist', album: 'Album', ...patch });
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

test('full-range counts and seconds/plays ranking are computed before bounded result limits', async () => {
  const h = harness();
  try {
    for (let index = 0; index < 35; index++) h.credit(song(`long-${index}`, { artist: `Artist ${index}`, album: `Album ${index}` }), 1_000 + index, 1);
    h.credit(song('frequent', { artist: 'Frequent artist', album: 'Frequent album' }), 20, 100);
    await h.module.flushListeningCredits();
    const time = await h.module.listeningReport('A', '2026-11-01', '2026-12-01', 'music', 'seconds');
    assert.equal(time.songs, 36); assert.equal(time.artistCount, 36); assert.equal(time.albumCount, 36); assert.equal(time.activeDays, 1);
    assert.equal(time.top.length, 30); assert.equal(time.artistRanks.length, 30); assert.equal(time.albumRanks.length, 30);
    assert.equal(time.top[0].song.id, 'long-34'); assert.ok(!time.top.some((row: any) => row.song.id === 'frequent'));
    const plays = await h.module.listeningReport('A', '2026-11-01', '2026-12-01', 'music', 'plays');
    assert.equal(plays.top[0].song.id, 'frequent'); assert.equal(plays.artistRanks[0].name, 'Frequent artist'); assert.equal(plays.albumRanks[0].name, 'Frequent album');
    assert.equal(plays.plays, 135); assert.deepEqual(plain(plays.days), [{ day: '2026-11-11', seconds: time.seconds, plays: 135 }]);
    const summary = await h.module.listeningSummary('A', '2026-11-01', '2026-12-01');
    assert.equal(summary.top[0].song.id, 'long-34', 'widget summary keeps its existing time ranking');
    assert.equal(summary.artistRanks, undefined, 'widget query does not inherit expensive optional report work');
  } finally { h.sqlite.close(); }
});

test('album identity distinguishes same-name releases while server IDs join guest tracks; representative metadata is recent', async () => {
  const h = harness();
  try {
    h.credit(song('a', { artist: 'First', album: 'Greatest Hits' }), 60, 1);
    h.credit(song('b', { artist: 'Second', album: 'Greatest Hits' }), 80, 1);
    h.credit(song('c', { artist: 'Lead', artistId: 'lead', album: 'Collaboration', albumId: 'shared' }), 90, 1);
    h.credit(song('d', { artist: 'Guest', artistId: 'guest', album: 'Collaboration', albumId: 'shared' }), 30, 1);
    h.credit(song('renamed', { title: 'Old title', artist: 'Same name', artistId: 'identity-one', albumId: 'renamed-album', coverArt: 'old-cover' }), 100, 1, '2026-11-01');
    h.credit(song('renamed', { title: 'New title', artist: 'Same name', artistId: 'identity-one', albumId: 'renamed-album', coverArt: 'new-cover' }), 50, 1, '2026-11-02');
    h.credit(song('other', { artist: 'Same name', artistId: 'identity-two', albumId: 'other-album' }), 40, 1);
    const report = await h.module.listeningReport('A', '2026-11-01', '2026-12-01');
    assert.equal(report.albumCount, 5); assert.equal(report.artistCount, 6);
    assert.equal(report.albumRanks.filter((row: any) => row.name === 'Greatest Hits').length, 2);
    assert.equal(report.albumRanks.find((row: any) => row.id === 'shared').seconds, 120);
    assert.equal(report.artistRanks.filter((row: any) => row.name === 'Same name').length, 2);
    const renamed = report.top.find((row: any) => row.song.id === 'renamed');
    assert.equal(renamed.song.title, 'New title'); assert.equal(renamed.song.coverArt, 'new-cover'); assert.equal(renamed.seconds, 150);
  } finally { h.sqlite.close(); }
});

test('reports isolate profiles, dates and content kinds, and tolerate damaged metadata without losing listening totals', async () => {
  const h = harness();
  try {
    h.credit(song('same'), 10, 1);
    h.credit(song('same', { mediaKind: 'podcast', podcastChannelId: 'show' }), 20, 2);
    h.credit(song('same', { mediaKind: 'audiobook' }), 30, 3);
    h.credit(song('same'), 40, 4, '2026-11-11', 'B');
    h.credit(song('past'), 100, 1, '2026-10-31'); h.credit(song('next'), 200, 1, '2026-12-01');
    await h.module.flushListeningCredits();
    h.sqlite.prepare('INSERT INTO listening_days VALUES(?,?,?,?,?,?,?)').run('A', '2026-11-12', 'damaged', 'not-json', 'Known artist', 42, 2);
    h.sqlite.prepare('INSERT INTO listening_days VALUES(?,?,?,?,?,?,?)').run('A', '2026-11-12', 'wrong', JSON.stringify({ id: 'different', title: 'Wrong' }), '', 12, 1);
    h.sqlite.prepare('INSERT INTO listening_days VALUES(?,?,?,?,?,?,?)').run('A', '2026-11-13', 'zero', JSON.stringify(song('zero')), 'Artist', 0, 0);
    const report = await h.module.listeningReport('A', '2026-11-01', '2026-12-01');
    assert.equal(report.seconds, 64); assert.equal(report.plays, 4); assert.equal(report.songs, 3); assert.equal(report.activeDays, 2);
    assert.equal(report.top.length, 1); assert.equal(report.top[0].song.id, 'same');
    assert.equal((await h.module.listeningReport('A', '2026-11-01', '2026-12-01', 'podcast')).seconds, 20);
    assert.equal((await h.module.listeningReport('A', '2026-11-01', '2026-12-01', 'audiobook')).seconds, 30);
    assert.equal((await h.module.listeningReport('B', '2026-11-01', '2026-12-01')).seconds, 40);
    const empty = await h.module.listeningReport('C', '2026-11-01', '2026-12-01');
    assert.equal(empty.seconds, 0); assert.equal(empty.activeDays, 0); assert.deepEqual(plain(empty.top), []); assert.deepEqual(plain(empty.albumRanks), []);
  } finally { h.sqlite.close(); }
});

test('report reads strip private fields and cancel before returning another account or a deleted profile snapshot', async () => {
  for (const deleting of [false, true]) {
    const h = harness();
    try {
      h.credit(song('safe'), 10, 1); await h.module.flushListeningCredits();
      h.sqlite.prepare('UPDATE listening_days SET song=? WHERE profile=?').run(JSON.stringify({ ...song('safe'), url: 'https://private.invalid/?token=SECRET', localUri: 'file:///SECRET', coverArt: 'https://private.invalid/SECRET' }), 'A');
      const before = await h.module.listeningReport('A', '2026-11-01', '2026-12-01'); assert.equal(JSON.stringify(before).includes('SECRET'), false);
      const readsBeforeCancel = h.reads.length;
      let release!: () => void, started!: () => void, current = true;
      const ready = new Promise<void>((resolve) => { started = resolve; });
      h.holdReads(() => { started(); return new Promise<void>((resolve) => { release = resolve; }); });
      const report = h.module.listeningReport('A', '2026-11-01', '2026-12-01', 'music', 'seconds', () => current);
      await ready;
      let clearing: Promise<unknown> | undefined;
      if (deleting) clearing = h.module.clearMusicToolsProfile('A'); else current = false;
      release(); h.holdReads(); await assert.rejects(report, /report changed/);
      await clearing;
      assert.equal(h.reads.length, readsBeforeCancel + 1, 'a canceled snapshot stops after the held read instead of scheduling more work');
      if (deleting) assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM listening_days WHERE profile=?').get('A')?.n, 0);
    } finally { h.sqlite.close(); }
  }
});

test('year availability uses actual imported ledger history, independently of recent preferences and selected range', async () => {
  const h = harness();
  try {
    h.credit(song('recent'), 40, 1, '2026-11-11'); await h.module.flushListeningCredits();
    const original = await h.module.listeningPreferences('A');
    await h.module.importListeningLedger('A', { version: 1, preferences: { enabled: false, startedAt: new Date('2024-06-05T12:00:00').getTime() },
      rows: [{ day: '2024-06-05', song: song('imported'), seconds: 90, plays: 2 }] }, () => true);
    await h.module.importListeningLedger('A', { version: 1, preferences: { enabled: true },
      rows: [{ day: '2020-02-29', song: song('podcast', { mediaKind: 'podcast', podcastChannelId: 'show' }), seconds: 70, plays: 1 }] }, () => true);
    h.credit(song('foreign'), 100, 1, '2000-01-01', 'B'); await h.module.flushListeningCredits();
    h.sqlite.prepare('INSERT INTO listening_days VALUES(?,?,?,?,?,?,?)').run('A', '0001-02-30', 'bad-calendar', JSON.stringify(song('bad-calendar')), 'Artist', 5, 1);
    h.sqlite.prepare('INSERT INTO listening_days VALUES(?,?,?,?,?,?,?)').run('A', '1971-01-01', 'empty', JSON.stringify(song('empty')), 'Artist', 0, 0);
    const report = await h.module.listeningReport('A', '2026-01-01', '2027-01-01');
    assert.equal(report.firstRecordedDay, '2024-06-05'); assert.equal(report.seconds, 40, 'the visible report still honors its selected window');
    assert.equal((await h.module.listeningPreferences('A')).startedAt, original.startedAt, 'import and report do not rewrite the recording preference');
    assert.equal((await h.module.listeningReport('A', '2026-01-01', '2027-01-01', 'podcast')).firstRecordedDay, '2020-02-29');
    assert.equal((await h.module.listeningReport('B', '2026-01-01', '2027-01-01')).firstRecordedDay, '2000-01-01');
    assert.equal((await h.module.listeningReport('missing', '2026-01-01', '2027-01-01')).firstRecordedDay, undefined);
  } finally { h.sqlite.close(); }
});

test('all-time chart aggregates every recorded year into at most twenty honest year buckets', () => {
  const at = new Date(2026, 10, 12, 12).getTime();
  assert.deepEqual(listeningRange('all', 2026, at), { from: '1970-01-01', until: '2026-11-13' });
  const rows = Array.from({ length: 57 }, (_, index) => ({ day: `${1970 + index}-01-02`, seconds: index + 1, plays: 2 }));
  const bars = listeningBars(rows, 'all', 2026, at);
  assert.ok(bars.length <= 20); assert.equal(bars[0].label, '1970–1972');
  assert.equal(bars.reduce((sum, row) => sum + row.seconds, 0), rows.reduce((sum, row) => sum + row.seconds, 0));
  assert.equal(bars.reduce((sum, row) => sum + row.plays, 0), 114);
  const one = listeningBars([{ day: '2026-11-11', seconds: 120, plays: 3 }], 'all', 2026, at);
  assert.deepEqual(one, [{ key: '2026', label: '2026', seconds: 120, plays: 3 }]);
  assert.equal(listeningBars([], 'year', 2024, at).length, 12);
  assert.ok(listeningBars([], 'year', 2024, at).every((row) => row.seconds === 0 && row.plays === 0));
});

test('daily insights merge real days, ignore invalid/out-of-range samples and count calendar streaks across DST', () => {
  const rows = [{ day: '2026-03-07', seconds: 60, plays: 1 }, { day: '2026-03-08', seconds: 120, plays: 2 },
    { day: '2026-03-08', seconds: 60, plays: 1 }, { day: '2026-03-09', seconds: 30, plays: 1 },
    { day: '2026-03-11', seconds: 90, plays: 1 }, { day: '2026-03-10', seconds: 0, plays: 0 },
    { day: '2026-02-30', seconds: 1_000, plays: 100 }, { day: '2026-03-12', seconds: 9_999, plays: 100 }];
  const report = listeningInsights(rows, '2026-03-07', '2026-03-12');
  assert.equal(report.activeDays, 4); assert.equal(report.totalDays, 5); assert.equal(report.longestStreak, 3);
  assert.equal(report.dailyAverageSeconds, 90); assert.deepEqual(report.busiestDay, { day: '2026-03-08', seconds: 180, plays: 3 });
  assert.equal(listeningInsights(rows, 'bad', '2026-03-12').dailyAverageSeconds, 0);
  assert.equal(listeningInsights([], '1970-01-01', '2026-03-12').dailyAverageSeconds, 0);
});
