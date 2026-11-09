/**
 * Time-zone arithmetic built purely on Intl.DateTimeFormat.
 *
 * Conventions used throughout the app:
 * - An "instant" is a number of epoch milliseconds (an absolute moment).
 * - "Wall-clock fields" are plain objects
 *   { year, month (1-12), day, hour, minute, second? }
 *   describing what a clock in some IANA zone displays.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const partsFormatters = new Map();
const nameFormatters = new Map();

function partsFormatter(zone) {
  let fmt = partsFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormatters.set(zone, fmt);
  }
  return fmt;
}

/** Returns true when the runtime recognises `zone` as an IANA time zone. */
export function isValidZone(zone) {
  if (typeof zone !== 'string' || zone.length === 0) return false;
  try {
    partsFormatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** The zone configured on the current device, falling back to UTC. */
export function deviceZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Wall-clock fields shown in `zone` at `instant`. */
export function getZonedFields(instant, zone) {
  const fields = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const { type, value } of partsFormatter(zone).formatToParts(instant)) {
    if (type in fields) fields[type] = Number(value);
  }
  // Some older engines render midnight as "24" even with hourCycle h23.
  if (fields.hour === 24) fields.hour = 0;
  return fields;
}

/** Interprets wall-clock fields as if they were UTC and returns epoch ms. */
export function wallClockAsUtc({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/** UTC offset of `zone` at `instant`, in minutes (east of Greenwich is positive). */
export function getOffsetMinutes(instant, zone) {
  const wall = wallClockAsUtc(getZonedFields(instant, zone));
  const truncated = Math.floor(instant / 1000) * 1000;
  return Math.round((wall - truncated) / MINUTE_MS);
}

/**
 * Converts wall-clock fields in `zone` to an instant.
 *
 * Daylight-saving transitions make this mapping irregular, so the result
 * carries a status:
 * - "ok":        exactly one instant shows these fields.
 * - "ambiguous": the time occurs twice (clocks fall back); the earlier
 *                instant is returned and the later one is in `later`.
 * - "gap":       the time never occurs (clocks spring forward); the instant
 *                is computed with the pre-transition offset, which lands the
 *                same distance past the gap (02:30 becomes 03:30).
 */
export function zonedToInstant(fields, zone) {
  const local = wallClockAsUtc(fields);
  const offsetBefore = getOffsetMinutes(local - DAY_MS, zone);
  const offsetAfter = getOffsetMinutes(local + DAY_MS, zone);
  const offsetAt = getOffsetMinutes(local, zone);

  const candidates = [...new Set([offsetBefore, offsetAt, offsetAfter])]
    .map((offset) => local - offset * MINUTE_MS)
    .filter((instant) => wallClockAsUtc(getZonedFields(instant, zone)) === local)
    .sort((a, b) => a - b);
  const unique = [...new Set(candidates)];

  if (unique.length === 0) {
    return { instant: local - offsetBefore * MINUTE_MS, status: 'gap' };
  }
  if (unique.length > 1) {
    return { instant: unique[0], status: 'ambiguous', later: unique[unique.length - 1] };
  }
  return { instant: unique[0], status: 'ok' };
}

/** True when `zone` is observing its summer (daylight-saving) offset at `instant`. */
export function isDaylightSaving(instant, zone) {
  const { year } = getZonedFields(instant, zone);
  const january = getOffsetMinutes(Date.UTC(year, 0, 1), zone);
  const july = getOffsetMinutes(Date.UTC(year, 6, 1), zone);
  if (january === july) return false;
  return getOffsetMinutes(instant, zone) === Math.max(january, july);
}

/**
 * Localised name of the zone at `instant`, e.g. "日本标准时间" (long) or
 * "GMT+9" (short). Returns an empty string if the runtime cannot name it.
 */
export function getZoneName(instant, zone, { style = 'long', locale = 'zh-CN' } = {}) {
  const key = `${zone}|${style}|${locale}`;
  let fmt = nameFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: style });
    nameFormatters.set(key, fmt);
  }
  const part = fmt.formatToParts(instant).find((p) => p.type === 'timeZoneName');
  return part ? part.value : '';
}
