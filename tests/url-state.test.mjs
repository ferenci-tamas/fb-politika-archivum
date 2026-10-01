import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeViewToHash, decodeHashToView } from '../src/lib/url-state.js';

const ENC = { defaultSort: 'date_desc', defaultPageSize: 50 };
const DEC = { validSorts: ['date_desc', 'date_asc', 'author'], pageSizes: [50, 100, 250], defaultSort: 'date_desc', defaultPageSize: 50 };

test('encodes nothing when everything is at default', () => {
  const hash = encodeViewToHash({ search: '', accentSensitive: false, authorNames: [], dateFrom: '', dateTo: '', sort: 'date_desc', pageSize: 50 }, ENC);
  assert.equal(hash, '');
});

test('round-trips a full view (authors by name, with diacritics/spaces)', () => {
  const view = { search: 'orbán kormány', accentSensitive: true, authorNames: ['Áder János', 'Bányai Gábor'], dateFrom: '2020-01-01', dateTo: '2020-12-31', sort: 'author', pageSize: 100 };
  const back = decodeHashToView(encodeViewToHash(view, ENC), DEC);
  assert.equal(back.search, view.search);
  assert.equal(back.accentSensitive, true);
  assert.deepEqual(back.authorNames, view.authorNames);
  assert.equal(back.dateFrom, '2020-01-01');
  assert.equal(back.dateTo, '2020-12-31');
  assert.equal(back.sort, 'author');
  assert.equal(back.pageSize, 100);
});

test('omits default sort and page size', () => {
  assert.equal(encodeViewToHash({ search: 'x', accentSensitive: false, authorNames: [], dateFrom: '', dateTo: '', sort: 'date_desc', pageSize: 50 }, ENC), 'q=x');
});

test('decode rejects invalid sort, size and dates', () => {
  const v = decodeHashToView('sort=bogus&size=999&from=nope&to=2020-13-40', DEC);
  assert.equal(v.sort, 'date_desc');
  assert.equal(v.pageSize, 50);
  assert.equal(v.dateFrom, '');
  assert.equal(v.dateTo, '');
});

test('decode tolerates a leading # and empty input', () => {
  assert.deepEqual(decodeHashToView('', DEC).authorNames, []);
  assert.equal(decodeHashToView('#q=hello&accent=1', DEC).search, 'hello');
  assert.equal(decodeHashToView('#q=hello&accent=1', DEC).accentSensitive, true);
});
