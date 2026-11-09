/**
 * Presentation helpers: turn numbers and wall-clock fields into the short
 * Chinese labels the interface displays. No DOM access here.
 */

export const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const pad2 = (n) => String(n).padStart(2, '0');

/** "UTC+05:30", "UTC−03:00" (true minus sign for typography). */
export function formatOffset(minutes) {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** Compact signed offset difference for tight spaces: "+13", "−4:30", "±0". */
export function formatCompactDiff(minutes) {
  if (minutes === 0) return '±0';
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return rest ? `${sign}${hours}:${pad2(rest)}` : `${sign}${hours}`;
}

/** Human description of how far a zone is ahead of / behind the reference. */
export function formatOffsetDiff(minutes) {
  if (minutes === 0) return '与基准同一时刻';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  const amount = [hours ? `${hours} 小时` : '', rest ? `${rest} 分钟` : '']
    .filter(Boolean)
    .join(' ');
  return minutes > 0 ? `比基准快 ${amount}` : `比基准慢 ${amount}`;
}

/** { time: "09:05", meridiem: "" } or, in 12-hour mode, { time: "9:05", meridiem: "上午" }. */
export function formatClock({ hour, minute }, hour12 = false) {
  if (!hour12) return { time: `${pad2(hour)}:${pad2(minute)}`, meridiem: '' };
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return { time: `${h}:${pad2(minute)}`, meridiem: hour < 12 ? '上午' : '下午' };
}

/** Days since 1970-01-01 for a civil date, independent of any zone. */
export function civilDayNumber({ year, month, day }) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.round(date.getTime() / 86_400_000);
}

/** Calendar days from date `from` to date `to` (positive when `to` is later). */
export function dayDelta(from, to) {
  return civilDayNumber(to) - civilDayNumber(from);
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekdayOf(fields) {
  return (((civilDayNumber(fields) + 4) % 7) + 7) % 7;
}

/** "11月3日 周二", or "2026年11月3日 周二" with `withYear`. */
export function formatDate(fields, { withYear = false } = {}) {
  const prefix = withYear ? `${fields.year}年` : '';
  return `${prefix}${fields.month}月${fields.day}日 ${WEEKDAYS_ZH[weekdayOf(fields)]}`;
}

/** Badge text for a date that differs from the reference date. */
export function relativeDayLabel(delta) {
  if (delta === 0) return '';
  if (delta === 1) return '次日';
  if (delta === -1) return '前一日';
  return delta > 0 ? `+${delta} 日` : `${delta} 日`;
}

/**
 * Coarse period of the day used for colour bands and labels.
 * band: "night" | "twilight" | "work".
 */
export function dayPeriod(hour) {
  if (hour < 6) return { band: 'night', label: '深夜' };
  if (hour < 9) return { band: 'twilight', label: '清晨' };
  if (hour < 12) return { band: 'work', label: '上午' };
  if (hour < 14) return { band: 'work', label: '午间' };
  if (hour < 18) return { band: 'work', label: '下午' };
  if (hour < 22) return { band: 'twilight', label: '晚间' };
  return { band: 'night', label: '夜间' };
}

/** Serialises wall-clock fields as "YYYY-MM-DDTHH:MM" (used in share links). */
export function toIsoLocal({ year, month, day, hour, minute }) {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`;
}

/** Parses "YYYY-MM-DDTHH:MM"; returns null for malformed or impossible values. */
export function parseIsoLocal(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day, hour, minute, second: 0 };
}

export function daysInMonth(year, month) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}
