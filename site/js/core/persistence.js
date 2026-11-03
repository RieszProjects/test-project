/**
 * Persistence for user preferences (localStorage) and share links (URL hash).
 * Every storage access is guarded: private windows and blocked site data
 * must never break the tool, they only lose the remembered preferences.
 */

import { parseIsoLocal, toIsoLocal } from './format.js';
import { isValidZone } from './tz.js';

const STORAGE_KEY = 'horologium:prefs:v1';

export function loadPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return sanitizePrefs(parsed);
  } catch {
    return {};
  }
}

export function savePrefs(prefs) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: preferences simply are not remembered */
  }
}

function sanitizePrefs(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const prefs = {};
  if (isValidZone(raw.refZone)) prefs.refZone = raw.refZone;
  if (Array.isArray(raw.zones)) prefs.zones = uniqueValidZones(raw.zones);
  if (typeof raw.hour12 === 'boolean') prefs.hour12 = raw.hour12;
  if (raw.theme === 'dark' || raw.theme === 'light') prefs.theme = raw.theme;
  return prefs;
}

export function uniqueValidZones(list) {
  return [...new Set(list.filter(isValidZone))];
}

/**
 * Share-link format:  #t=2026-11-03T09:00&from=Asia/Shanghai&to=Europe/London,America/New_York
 * The reference is stored as wall-clock time plus zone so the link means the
 * same moment no matter where it is opened.
 */
export function buildShareHash({ fields, refZone, zones }) {
  const params = new URLSearchParams();
  params.set('t', toIsoLocal(fields));
  params.set('from', refZone);
  if (zones.length) params.set('to', zones.join(','));
  // Keep "/", "," and ":" readable in the address bar; all are legal in a fragment.
  return `#${params.toString().replace(/%2F/gi, '/').replace(/%2C/gi, ',').replace(/%3A/gi, ':')}`;
}

/** Returns { fields, refZone, zones } or null when the hash is not a valid share link. */
export function readShareHash(hash) {
  const text = String(hash ?? '').replace(/^#/, '');
  if (!text) return null;
  const params = new URLSearchParams(text);
  const fields = parseIsoLocal(params.get('t'));
  const refZone = params.get('from');
  if (!fields || !isValidZone(refZone)) return null;
  const zones = uniqueValidZones((params.get('to') ?? '').split(',').filter(Boolean)).filter(
    (zone) => zone !== refZone,
  );
  return { fields, refZone, zones };
}
