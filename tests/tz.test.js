import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getOffsetMinutes,
  getZonedFields,
  isDaylightSaving,
  isValidZone,
  zonedToInstant,
} from '../site/horologium/js/core/tz.js';

const at = (iso) => Date.parse(iso);

test('offsets for fixed and DST zones', () => {
  assert.equal(getOffsetMinutes(at('2026-01-15T12:00:00Z'), 'Asia/Shanghai'), 480);
  assert.equal(getOffsetMinutes(at('2026-01-15T12:00:00Z'), 'Asia/Kolkata'), 330);
  assert.equal(getOffsetMinutes(at('2026-01-15T12:00:00Z'), 'Asia/Kathmandu'), 345);
  assert.equal(getOffsetMinutes(at('2026-01-15T12:00:00Z'), 'America/New_York'), -300);
  assert.equal(getOffsetMinutes(at('2026-07-15T12:00:00Z'), 'America/New_York'), -240);
  assert.equal(getOffsetMinutes(at('2026-07-15T12:00:00Z'), 'Australia/Sydney'), 600);
  assert.equal(getOffsetMinutes(at('2026-01-15T12:00:00Z'), 'Australia/Sydney'), 660);
});

test('getZonedFields reads the wall clock, including midnight as hour 0', () => {
  assert.deepEqual(getZonedFields(at('2026-11-03T16:00:00Z'), 'Asia/Shanghai'), {
    year: 2026, month: 11, day: 4, hour: 0, minute: 0, second: 0,
  });
});

test('zonedToInstant round-trips ordinary times', () => {
  const result = zonedToInstant({ year: 2026, month: 11, day: 3, hour: 9, minute: 30 }, 'Asia/Shanghai');
  assert.equal(result.status, 'ok');
  assert.equal(result.instant, at('2026-11-03T01:30:00Z'));

  const ny = zonedToInstant({ year: 2026, month: 7, day: 4, hour: 20, minute: 0 }, 'America/New_York');
  assert.equal(ny.instant, at('2026-07-05T00:00:00Z'));
});

test('spring-forward gap is pushed past the gap', () => {
  // 2026-03-08 02:30 does not exist in New York (02:00 → 03:00).
  const result = zonedToInstant({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York');
  assert.equal(result.status, 'gap');
  assert.deepEqual(
    { hour: getZonedFields(result.instant, 'America/New_York').hour, minute: getZonedFields(result.instant, 'America/New_York').minute },
    { hour: 3, minute: 30 },
  );
});

test('fall-back overlap reports both instants, earliest first', () => {
  // 2026-11-01 01:30 happens twice in New York.
  const result = zonedToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/New_York');
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.instant, at('2026-11-01T05:30:00Z'));
  assert.equal(result.later, at('2026-11-01T06:30:00Z'));
});

test('half-hour DST (Lord Howe) and southern hemisphere transitions', () => {
  const summer = getOffsetMinutes(at('2026-01-15T00:00:00Z'), 'Australia/Lord_Howe');
  const winter = getOffsetMinutes(at('2026-07-15T00:00:00Z'), 'Australia/Lord_Howe');
  assert.equal(summer - winter, 30);
  assert.equal(isDaylightSaving(at('2026-01-15T00:00:00Z'), 'Australia/Sydney'), true);
  assert.equal(isDaylightSaving(at('2026-07-15T00:00:00Z'), 'Australia/Sydney'), false);
});

test('isDaylightSaving and isValidZone', () => {
  assert.equal(isDaylightSaving(at('2026-07-01T00:00:00Z'), 'Europe/London'), true);
  assert.equal(isDaylightSaving(at('2026-12-01T00:00:00Z'), 'Europe/London'), false);
  assert.equal(isDaylightSaving(at('2026-07-01T00:00:00Z'), 'Asia/Tokyo'), false);
  assert.equal(isValidZone('Europe/Paris'), true);
  assert.equal(isValidZone('Mars/Olympus_Mons'), false);
  assert.equal(isValidZone(''), false);
});
