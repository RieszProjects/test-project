/**
 * Application state and every operation that changes it.
 *
 * State shape:
 *   refZone  – IANA zone of the reference clock
 *   zones    – comparison zones (never contains refZone)
 *   instant  – the moment being compared (epoch ms)
 *   live     – follow the current time every second
 *   notice   – explanation shown when a typed time hits a DST gap/overlap
 *   hour12   – 12-hour display
 *   theme    – "dark" | "light"
 *   viewingShare – zones/reference came from a share link; they are not
 *                  saved as the visitor's own preferences until edited
 */

import { DEFAULT_ZONES } from '../core/catalog.js';
import { formatClock, formatOffset } from '../core/format.js';
import { loadPrefs, readShareHash } from '../core/persistence.js';
import { HOUR_MS, MINUTE_MS, deviceZone, getOffsetMinutes, getZonedFields, zonedToInstant } from '../core/tz.js';

export const MAX_ZONES = 12;

export function createInitialState(hash) {
  const prefs = loadPrefs();
  const shared = readShareHash(hash);
  const refZone = shared?.refZone ?? prefs.refZone ?? deviceZone();
  const zones = (shared?.zones ?? prefs.zones ?? DEFAULT_ZONES).filter((z) => z !== refZone).slice(0, MAX_ZONES);

  const base = {
    refZone,
    zones,
    instant: Date.now(),
    live: true,
    notice: null,
    hour12: prefs.hour12 ?? false,
    theme: prefs.theme ?? 'dark',
    viewingShare: false,
  };
  if (!shared) return base;

  const resolution = zonedToInstant(shared.fields, refZone);
  return {
    ...base,
    instant: resolution.instant,
    live: false,
    notice: describeResolution(resolution, refZone),
    viewingShare: true,
  };
}

/** Builds the user-facing explanation for a DST gap or overlap (null when unambiguous). */
export function describeResolution(resolution, zone) {
  if (resolution.status === 'gap') {
    const shown = formatClock(getZonedFields(resolution.instant, zone)).time;
    return {
      kind: 'gap',
      text: `输入的时刻在该时区并不存在（夏令时开始，时钟拨快跳过了这一段），已顺延为 ${shown}。`,
    };
  }
  if (resolution.status === 'ambiguous') {
    return {
      kind: 'ambiguous',
      text: `该时刻在此时区出现两次（夏令时结束，时钟回拨），当前按第一次（${formatOffset(
        getOffsetMinutes(resolution.instant, zone),
      )}）计算。`,
      alternative: resolution.later,
      alternativeLabel: `改用第二次（${formatOffset(getOffsetMinutes(resolution.later, zone))}）`,
    };
  }
  return null;
}

const floorToMinute = (instant) => Math.floor(instant / MINUTE_MS) * MINUTE_MS;

export function createActions(store) {
  const refFields = () => {
    const { instant, refZone } = store.get();
    return getZonedFields(instant, refZone);
  };

  const setReferenceFields = (fields) => {
    const { refZone } = store.get();
    const resolution = zonedToInstant({ ...fields, second: 0 }, refZone);
    store.set({ instant: resolution.instant, live: false, notice: describeResolution(resolution, refZone) });
  };

  return {
    setTime({ hour, minute }) {
      setReferenceFields({ ...refFields(), hour, minute });
    },

    setDate({ year, month, day }) {
      setReferenceFields({ ...refFields(), year, month, day });
    },

    setMinuteOfDay(minuteOfDay) {
      setReferenceFields({ ...refFields(), hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 });
    },

    /** Moves the reference by a number of minutes (crossing midnight as needed). */
    shift(minutes) {
      store.set((s) => ({ instant: floorToMinute(s.instant) + minutes * MINUTE_MS, live: false, notice: null }));
    },

    /** Jumps to the hour starting at `hourInstant`, keeping the current minute. */
    jumpToHour(hourInstant) {
      const { minute } = refFields();
      const target = hourInstant + minute * MINUTE_MS;
      store.set({ instant: Math.min(target, hourInstant + HOUR_MS - MINUTE_MS), live: false, notice: null });
    },

    /**
     * Changes the reference zone. A frozen time keeps its wall-clock reading
     * ("09:00 here" becomes "09:00 there"); a live clock keeps the moment.
     * If the new reference was a comparison zone, the old reference takes its slot.
     */
    setRefZone(zone) {
      const state = store.get();
      if (zone === state.refZone) return;
      const zones = state.zones.map((z) => (z === zone ? state.refZone : z));
      if (state.live) {
        store.set({ refZone: zone, zones, notice: null, viewingShare: false });
        return;
      }
      const fields = getZonedFields(state.instant, state.refZone);
      const resolution = zonedToInstant(fields, zone);
      store.set({
        refZone: zone,
        zones,
        instant: resolution.instant,
        notice: describeResolution(resolution, zone),
        viewingShare: false,
      });
    },

    /** Swaps a comparison zone with the reference, keeping the same moment. */
    makeReference(zone) {
      store.set((s) => ({
        refZone: zone,
        zones: s.zones.map((z) => (z === zone ? s.refZone : z)),
        notice: null,
        viewingShare: false,
      }));
    },

    addZone(zone) {
      store.set((s) => {
        if (zone === s.refZone || s.zones.includes(zone) || s.zones.length >= MAX_ZONES) return {};
        return { zones: [...s.zones, zone], viewingShare: false };
      });
    },

    removeZone(zone) {
      store.set((s) => ({ zones: s.zones.filter((z) => z !== zone), viewingShare: false }));
    },

    useAlternative() {
      const { notice } = store.get();
      if (notice?.alternative == null) return;
      store.set({
        instant: notice.alternative,
        notice: { kind: 'ambiguous', text: '该时刻在此时区出现两次，当前按第二次（时钟回拨之后）计算。' },
      });
    },

    loadShared(shared) {
      const resolution = zonedToInstant(shared.fields, shared.refZone);
      store.set({
        refZone: shared.refZone,
        zones: shared.zones.slice(0, MAX_ZONES),
        instant: resolution.instant,
        live: false,
        notice: describeResolution(resolution, shared.refZone),
        viewingShare: true,
      });
    },

    goLive() {
      store.set({ live: true, instant: Date.now(), notice: null });
    },

    tick() {
      if (store.get().live) store.set({ instant: Date.now() });
    },

    toggleHour12() {
      store.set((s) => ({ hour12: !s.hour12 }));
    },

    toggleTheme() {
      store.set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }));
    },
  };
}
