import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dayDelta,
  formatClock,
  formatCompactDiff,
  formatDate,
  formatOffset,
  formatOffsetDiff,
  parseIsoLocal,
  relativeDayLabel,
  toIsoLocal,
  weekdayOf,
} from '../site/js/core/format.js';

test('offset labels', () => {
  assert.equal(formatOffset(480), 'UTC+08:00');
  assert.equal(formatOffset(-210), 'UTC−03:30');
  assert.equal(formatOffset(0), 'UTC+00:00');
  assert.equal(formatCompactDiff(-270), '−4:30');
  assert.equal(formatCompactDiff(780), '+13');
  assert.equal(formatOffsetDiff(780), '比基准快 13 小时');
  assert.equal(formatOffsetDiff(-330), '比基准慢 5 小时 30 分钟');
  assert.equal(formatOffsetDiff(0), '与基准同一时刻');
});

test('clock formatting in 24h and 12h modes', () => {
  assert.deepEqual(formatClock({ hour: 9, minute: 5 }), { time: '09:05', meridiem: '' });
  assert.deepEqual(formatClock({ hour: 0, minute: 0 }, true), { time: '12:00', meridiem: '上午' });
  assert.deepEqual(formatClock({ hour: 12, minute: 30 }, true), { time: '12:30', meridiem: '下午' });
  assert.deepEqual(formatClock({ hour: 23, minute: 59 }, true), { time: '11:59', meridiem: '下午' });
});

test('dates, weekdays and relative days', () => {
  assert.equal(weekdayOf({ year: 2026, month: 11, day: 3 }), 2);
  assert.equal(formatDate({ year: 2026, month: 11, day: 3 }, { withYear: true }), '2026年11月3日 周二');
  assert.equal(dayDelta({ year: 2026, month: 12, day: 31 }, { year: 2027, month: 1, day: 1 }), 1);
  assert.equal(relativeDayLabel(1), '次日');
  assert.equal(relativeDayLabel(-1), '前一日');
  assert.equal(relativeDayLabel(0), '');
});

test('ISO local round trip and validation', () => {
  const fields = { year: 2026, month: 2, day: 28, hour: 7, minute: 45 };
  assert.equal(toIsoLocal(fields), '2026-02-28T07:45');
  assert.deepEqual(parseIsoLocal('2026-02-28T07:45'), { ...fields, second: 0 });
  assert.equal(parseIsoLocal('2026-02-29T07:45'), null);
  assert.equal(parseIsoLocal('2026-13-01T00:00'), null);
  assert.equal(parseIsoLocal('garbage'), null);
});
