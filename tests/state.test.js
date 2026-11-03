import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildHourGrid, buildZoneCard } from '../site/js/app/model.js';
import { createActions } from '../site/js/app/state.js';
import { buildShareHash, readShareHash } from '../site/js/core/persistence.js';
import { createStore } from '../site/js/core/store.js';
import { getZonedFields } from '../site/js/core/tz.js';

const freshStore = (overrides = {}) =>
  createStore({
    refZone: 'Asia/Shanghai',
    zones: ['America/New_York', 'Europe/London'],
    instant: Date.parse('2026-11-03T01:30:00Z'), // 09:30 in Shanghai
    live: true,
    notice: null,
    hour12: false,
    theme: 'dark',
    ...overrides,
  });

test('share links round-trip and drop invalid zones', () => {
  const hash = buildShareHash({
    fields: { year: 2026, month: 11, day: 3, hour: 9, minute: 30 },
    refZone: 'Asia/Shanghai',
    zones: ['America/New_York', 'Europe/London'],
  });
  assert.equal(hash, '#t=2026-11-03T09:30&from=Asia/Shanghai&to=America/New_York,Europe/London');
  assert.deepEqual(readShareHash(hash), {
    fields: { year: 2026, month: 11, day: 3, hour: 9, minute: 30, second: 0 },
    refZone: 'Asia/Shanghai',
    zones: ['America/New_York', 'Europe/London'],
  });
  assert.deepEqual(readShareHash('#t=2026-11-03T09:30&from=Asia/Shanghai&to=Bogus/Zone,Asia/Shanghai').zones, []);
  assert.equal(readShareHash('#from=Nowhere'), null);
  assert.equal(readShareHash(''), null);
});

test('setting a time freezes the clock and resolves in the reference zone', () => {
  const store = freshStore();
  const actions = createActions(store);
  actions.setTime({ hour: 21, minute: 0 });
  const state = store.get();
  assert.equal(state.live, false);
  assert.equal(state.instant, Date.parse('2026-11-03T13:00:00Z'));
});

test('changing the reference zone keeps the wall-clock reading when frozen', () => {
  const store = freshStore({ live: false });
  const actions = createActions(store);
  actions.setRefZone('Europe/London');
  const state = store.get();
  assert.equal(state.refZone, 'Europe/London');
  assert.deepEqual(state.zones, ['America/New_York', 'Asia/Shanghai']);
  const fields = getZonedFields(state.instant, 'Europe/London');
  assert.equal(`${fields.hour}:${fields.minute}`, '9:30');
});

test('makeReference swaps zones and keeps the moment', () => {
  const store = freshStore();
  const before = store.get().instant;
  createActions(store).makeReference('America/New_York');
  assert.equal(store.get().refZone, 'America/New_York');
  assert.deepEqual(store.get().zones, ['Asia/Shanghai', 'Europe/London']);
  assert.equal(store.get().instant, before);
});

test('ambiguous input produces a notice with an alternative', () => {
  const store = freshStore({ refZone: 'America/New_York', zones: [] });
  const actions = createActions(store);
  actions.setDate({ year: 2026, month: 11, day: 1 });
  actions.setTime({ hour: 1, minute: 30 });
  const { notice, instant } = store.get();
  assert.equal(notice.kind, 'ambiguous');
  assert.equal(instant, Date.parse('2026-11-01T05:30:00Z'));
  actions.useAlternative();
  assert.equal(store.get().instant, Date.parse('2026-11-01T06:30:00Z'));
});

test('zone card reports date shift and offset difference', () => {
  const instant = Date.parse('2026-11-03T15:00:00Z'); // 23:00 Shanghai, 10:00 New York
  const card = buildZoneCard({
    instant,
    zone: 'Asia/Shanghai',
    refZone: 'America/New_York',
    refFields: getZonedFields(instant, 'America/New_York'),
    hour12: false,
  });
  assert.equal(card.clock.time, '23:00');
  assert.equal(card.dayBadge, '');
  assert.equal(card.diffLabel, '比基准快 13 小时');

  const tokyo = buildZoneCard({
    instant,
    zone: 'Asia/Tokyo',
    refZone: 'America/New_York',
    refFields: getZonedFields(instant, 'America/New_York'),
    hour12: true,
  });
  assert.equal(tokyo.dayBadge, '次日');
  assert.deepEqual(tokyo.clock, { time: '12:00', meridiem: '上午' });
});

test('hour grid has 24 columns starting at reference midnight', () => {
  const instant = Date.parse('2026-11-03T01:30:00Z');
  const model = buildHourGrid({ instant, refZone: 'Asia/Shanghai', zones: ['Asia/Kolkata'], hour12: false });
  assert.equal(model.columns.length, 24);
  assert.equal(model.currentIndex, 9);
  assert.equal(model.rows[0].cells[0].label, '0');
  assert.equal(model.rows[0].cells[0].dateMark, '11/3');
  assert.equal(model.rows[1].cells[0].label, '21:30');
  assert.equal(model.rows[1].cells[3].dateMark, '11/3');
});

test('shared views are flagged until the visitor edits the zone list', () => {
  const store = freshStore();
  const actions = createActions(store);
  actions.loadShared({
    fields: { year: 2026, month: 5, day: 1, hour: 8, minute: 0, second: 0 },
    refZone: 'Europe/Paris',
    zones: ['Asia/Tokyo'],
  });
  assert.equal(store.get().viewingShare, true);
  assert.equal(store.get().live, false);
  actions.addZone('Asia/Seoul');
  assert.equal(store.get().viewingShare, false);
  assert.deepEqual(store.get().zones, ['Asia/Tokyo', 'Asia/Seoul']);
});
