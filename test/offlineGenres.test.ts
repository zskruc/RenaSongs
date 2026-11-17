import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('all genre query doors avoid authentication and network offline while online requests retain their arguments', async () => {
  const file = ts.createSourceFile('data.ts', readFileSync(new URL('../src/api/data.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const names = ['getGenres', 'getAlbumsByGenre', 'getGenreArt', 'getSongsByGenre'];
  const code = file.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')).map((node) => node.getText(file)).join('\n');
  let offline = true, authCalls = 0;
  const calls: any[] = [], account = { username: 'user' };
  const exports: any = {};
  runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, Promise, isOffline: () => offline, auth: () => { authCalls++; if (offline) throw new Error('must not authenticate offline'); return account; },
    canListNative: () => false,
    Subsonic: { getGenres: async (a: any) => { calls.push(['genres', a]); return []; } },
    subsonicGenreAlbums: async (...args: any[]) => { calls.push(['albums', ...args]); return []; },
    subsonicGenreSongs: async (...args: any[]) => { calls.push(['songs', ...args]); return []; },
  });
  for (const name of names) assert.equal((await exports[name]('Rock', 7, 14)).length, 0);
  assert.equal(authCalls, 0); assert.equal(calls.length, 0);
  offline = false;
  await exports.getGenres(); await exports.getAlbumsByGenre('Rock', 7, 14); await exports.getGenreArt('Jazz', 2); await exports.getSongsByGenre('Pop', 8, 16, 'alpha', 'desc');
  assert.equal(calls.length, 4); assert.equal(calls[0][1], account);
  assert.deepEqual(calls[1].slice(1), [account, 'Rock', 7, 14]);
  assert.deepEqual(calls[2].slice(1), [account, 'Jazz', 2, 0]);
  assert.deepEqual(calls[3].slice(1), [account, 'Pop', 8, 16, 'alpha', 'desc']);
});
