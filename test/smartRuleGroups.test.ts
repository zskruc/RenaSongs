import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_RULE, evaluateSmartRule, normalizeSmartRule, smartRuleNeedsFavorites, type SmartRule } from '../src/lib/smartRules';
import type { Song } from '../src/api/subsonic';
const song = (id: string, more = {}): Song => ({ id, title: id, ...more });
const rule = (more: Partial<SmartRule>): SmartRule => ({ ...EMPTY_RULE, name: 'Rule', id: 'rule', ...more });
test('AND/OR groups support (pop OR rock) AND a real release year, without changing basic filters', async () => {
  const value = rule({ groups: [
    { match: 'any', conditions: [{ field: 'genre', operator: 'contains', value: 'pop' }, { field: 'genre', operator: 'contains', value: 'rock' }] },
    { match: 'all', conditions: [{ field: 'year', operator: 'at-least', value: 2000 }] },
  ], groupMatch: 'all', minRating: 3 });
  const songs = [song('pop', { genre: 'Pop', year: 2020, userRating: 3 }), song('rock', { genre: 'ROCK', year: 2001, userRating: 5 }), song('old', { genre: 'Pop', year: 1990, userRating: 4 }),
    song('missing', { genre: 'Rock', userRating: 5 }), song('unrated', { genre: 'Pop', year: 2010 })];
  assert.deepEqual((await evaluateSmartRule(songs, value)).map((s) => s.id), ['pop', 'rock']);
});
test('OR between AND groups preserves ratings, favorite identities and local counts; unknown dates cannot prove a match', async () => {
  const now = Date.now(), value = rule({ groups: [
    { match: 'all', conditions: [{ field: 'favorite', operator: 'is', value: true }, { field: 'rating', operator: 'at-least', value: 4 }] },
    { match: 'all', conditions: [{ field: 'added-days', operator: 'within', value: 7 }, { field: 'plays', operator: 'equals', value: 0 }] },
  ], groupMatch: 'any' });
  assert.equal(smartRuleNeedsFavorites(value), true);
  assert.deepEqual((await evaluateSmartRule([song('fav', { userRating: 5 }), song('new', { addedAt: now }), song('played', { addedAt: now }), song('unknown')], value,
    { now, favoriteIds: new Set(['fav']), counts: { played: 1 } })).map((s) => s.id), ['fav', 'new']);
});
test('legacy rules keep old semantics and new malformed/unbounded conditions are rejected rather than ignored', async () => {
  assert.equal(normalizeSmartRule(rule({}))?.groups, undefined);
  assert.equal(normalizeSmartRule(rule({ groups: [{ match: 'all', conditions: [{ field: 'genre', operator: 'contains', value: '' }] }] })), null);
  assert.equal(normalizeSmartRule(rule({ groups: Array.from({ length: 9 }, () => ({ match: 'all', conditions: [] })) })), null);
  assert.equal(normalizeSmartRule(rule({ groups: [{ match: 'all', conditions: [{ field: 'year', operator: 'at-least', value: 99 }] }] })), null);
  const value = rule({ groups: [{ match: 'all', conditions: [{ field: 'genre', operator: 'not-contains', value: 'pop' }] }] });
  assert.deepEqual((await evaluateSmartRule([song('missing'), song('rock', { genre: 'Rock' })], value)).map((s) => s.id), ['rock']);
});
