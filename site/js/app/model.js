/**
 * View models: pure functions that turn application state into the data each
 * part of the interface renders. Keeping this DOM-free makes it testable.
 */

import { describeZone, displayName } from '../core/catalog.js';
import {
  dayDelta,
  dayPeriod,
  formatClock,
  formatCompactDiff,
  formatDate,
  formatOffset,
  formatOffsetDiff,
  relativeDayLabel,
} from '../core/format.js';
import {
  HOUR_MS,
  getOffsetMinutes,
  getZoneName,
  getZonedFields,
  isDaylightSaving,
  zonedToInstant,
} from '../core/tz.js';

/** Static facts about a zone at an instant, shared by the cards and the grid. */
export function describeZoneAt(instant, zone) {
  const entry = describeZone(zone);
  const offset = getOffsetMinutes(instant, zone);
  return {
    zone,
    title: displayName(entry),
    subtitle: entry.cityZh ? entry.city : entry.region || zone,
    longName: getZoneName(instant, zone) || zone,
    offset,
    offsetLabel: formatOffset(offset),
    dst: isDaylightSaving(instant, zone),
  };
}

export function buildReferenceView({ instant, refZone }) {
  const fields = getZonedFields(instant, refZone);
  return {
    ...describeZoneAt(instant, refZone),
    fields,
    dateLabel: formatDate(fields, { withYear: true }),
  };
}

export function buildZoneCard({ instant, zone, refZone, refFields, hour12 }) {
  const info = describeZoneAt(instant, zone);
  const fields = getZonedFields(instant, zone);
  const diff = info.offset - getOffsetMinutes(instant, refZone);
  const delta = dayDelta(refFields, fields);
  return {
    ...info,
    fields,
    clock: formatClock(fields, hour12),
    dateLabel: formatDate(fields),
    dayDelta: delta,
    dayBadge: relativeDayLabel(delta),
    diffLabel: formatOffsetDiff(diff),
    compactDiff: formatCompactDiff(diff),
    period: dayPeriod(fields.hour),
  };
}

/**
 * The hour grid: 24 columns starting at local midnight of the reference day,
 * one row per zone (reference first). Each cell shows the local hour there.
 */
export function buildHourGrid({ instant, refZone, zones, hour12 }) {
  const refFields = getZonedFields(instant, refZone);
  const dayStart = zonedToInstant({ ...refFields, hour: 0, minute: 0, second: 0 }, refZone).instant;
  const columns = Array.from({ length: 24 }, (_, i) => dayStart + i * HOUR_MS);
  const currentIndex = Math.min(23, Math.max(0, Math.floor((instant - dayStart) / HOUR_MS)));

  const rows = [refZone, ...zones].map((zone, rowIndex) => {
    const info = describeZoneAt(instant, zone);
    const diff = info.offset - getOffsetMinutes(instant, refZone);
    let previous = null;
    const cells = columns.map((columnInstant) => {
      const fields = getZonedFields(columnInstant, zone);
      // Label the first cell of each row and every cell where the local date changes.
      const showDate = previous === null || dayDelta(previous, fields) !== 0;
      previous = fields;
      return {
        label: formatCellHour(fields, hour12),
        band: dayPeriod(fields.hour).band,
        dateMark: showDate ? `${fields.month}/${fields.day}` : '',
      };
    });
    return {
      zone,
      title: info.title,
      offsetLabel: info.offsetLabel,
      compactDiff: formatCompactDiff(diff),
      isReference: rowIndex === 0,
      cells,
    };
  });

  return { columns, currentIndex, rows };
}

function formatCellHour({ hour, minute }, hour12) {
  const suffix = minute ? `:${String(minute).padStart(2, '0')}` : '';
  if (!hour12) return `${hour}${suffix}`;
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${suffix}${hour < 12 ? 'a' : 'p'}`;
}

/** Plain-text summary of all clocks, used by the "copy" actions. */
export function summarize({ reference, cards, hour12 }) {
  const line = (title, fields, offsetLabel) => {
    const { time, meridiem } = formatClock(fields, hour12);
    return `${title}  ${formatDate(fields, { withYear: true })} ${meridiem}${time}  (${offsetLabel})`;
  };
  return [
    line(`${reference.title}（基准）`, reference.fields, reference.offsetLabel),
    ...cards.map((card) => line(card.title, card.fields, card.offsetLabel)),
  ].join('\n');
}
