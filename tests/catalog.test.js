import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeZone, listZones, parseOffsetQuery, searchZones } from '../site/horologium/js/core/catalog.js';

const ids = (entries) => entries.map((e) => e.id);

test('listing starts with featured cities and has no duplicates', () => {
  const zones = listZones();
  assert.equal(zones[0].id, 'Asia/Shanghai');
  assert.ok(zones.length > 300, `expected a full IANA list, got ${zones.length}`);
  assert.equal(new Set(ids(zones)).size, zones.length);
  assert.ok(ids(zones).includes('UTC'));
});

test('search by Chinese name, alias, English city and abbreviation', () => {
  assert.equal(searchZones('东京')[0].id, 'Asia/Tokyo');
  assert.equal(searchZones('北京')[0].id, 'Asia/Shanghai');
  assert.equal(searchZones('安娜堡')[0].id, 'America/Detroit');
  assert.equal(searchZones('new york')[0].id, 'America/New_York');
  assert.equal(searchZones('JST')[0].id, 'Asia/Tokyo');
  assert.ok(ids(searchZones('Ulaanbaatar')).includes('Asia/Ulaanbaatar'));
  assert.deepEqual(searchZones('zzzz-not-a-zone'), []);
});

test('search by UTC offset respects daylight saving', () => {
  const winter = Date.parse('2026-01-15T12:00:00Z');
  const summer = Date.parse('2026-07-15T12:00:00Z');
  assert.ok(ids(searchZones('+8', { instant: winter })).includes('Asia/Shanghai'));
  assert.ok(ids(searchZones('UTC-5', { instant: winter })).includes('America/New_York'));
  assert.ok(!ids(searchZones('UTC-5', { instant: summer })).includes('America/New_York'));
  assert.ok(ids(searchZones('+5:30', { instant: winter })).includes('Asia/Kolkata'));
});

test('offset query parsing', () => {
  assert.equal(parseOffsetQuery('+8'), 480);
  assert.equal(parseOffsetQuery('gmt-03:30'), -210);
  assert.equal(parseOffsetQuery('−5'), -300);
  assert.equal(parseOffsetQuery('tokyo'), null);
  assert.equal(parseOffsetQuery('+20'), null);
});

test('describeZone works for zones outside the featured list', () => {
  const entry = describeZone('Asia/Ulaanbaatar');
  assert.equal(entry.city, 'Ulaanbaatar');
  assert.equal(entry.cityZh, '');
});
