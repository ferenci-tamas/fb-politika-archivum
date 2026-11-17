import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcriptFilename } from '../src/ui/transcript-dialog.js';

test('transcript file name: author without accents, Hungarian local date, post id', () => {
  // 2020-05-01 23:30 UTC is already 2 May in Budapest (CEST, UTC+2).
  const time = Date.UTC(2020, 4, 1, 23, 30) / 1000;
  assert.equal(
    transcriptFilename({ authorname: 'Őry Űrsula Tünde', time, postId: '1234567890' }),
    'leirat_ory-ursula-tunde_2020-05-02_1234567890.txt'
  );
});

test('transcript file name: unsafe characters never reach the file name', () => {
  const name = transcriptFilename({ authorname: '../Fidesz – Magyar Polgári Szövetség / KDNP', time: 0, postId: 'a/b\\c:d' });
  assert.match(name, /^[a-z0-9_.-]+$/);
  assert.equal(name, 'leirat_fidesz-magyar-polgari-szovetseg-kdnp_1970-01-01_a-b-c-d.txt');
});

test('transcript file name: missing parts are skipped', () => {
  assert.equal(transcriptFilename({}), 'leirat.txt');
  assert.equal(transcriptFilename({ authorname: 'Teszt', time: NaN }), 'leirat_teszt.txt');
});
