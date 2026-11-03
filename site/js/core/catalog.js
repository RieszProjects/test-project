/**
 * The catalogue of selectable time zones and the search over it.
 *
 * Zones come from Intl.supportedValuesOf('timeZone') when available. A curated
 * list of frequently used cities adds Chinese names and search aliases
 * (country names, common abbreviations such as EST / JST, nearby cities).
 */

import { getOffsetMinutes, isValidZone } from './tz.js';

/** [zone id, Chinese city name, aliases…] — order defines the default listing order. */
const FEATURED = [
  ['Asia/Shanghai', '上海', '北京', '中国', '北京时间', 'China', 'Beijing', 'CST'],
  ['Asia/Hong_Kong', '香港', 'HKT'],
  ['Asia/Taipei', '台北', '台湾'],
  ['Asia/Macau', '澳门'],
  ['Asia/Tokyo', '东京', '日本', '大阪', 'Japan', 'Osaka', 'JST'],
  ['Asia/Seoul', '首尔', '韩国', 'Korea', 'KST'],
  ['Asia/Singapore', '新加坡', 'SGT'],
  ['Asia/Kuala_Lumpur', '吉隆坡', '马来西亚', 'Malaysia'],
  ['Asia/Bangkok', '曼谷', '泰国', 'Thailand', 'ICT'],
  ['Asia/Ho_Chi_Minh', '胡志明市', '越南', 'Vietnam', 'Saigon'],
  ['Asia/Jakarta', '雅加达', '印度尼西亚', 'Indonesia', 'WIB'],
  ['Asia/Manila', '马尼拉', '菲律宾', 'Philippines'],
  ['Asia/Kolkata', '加尔各答', '印度', '新德里', '孟买', '班加罗尔', 'India', 'Delhi', 'Mumbai', 'Bangalore', 'IST'],
  ['Asia/Kathmandu', '加德满都', '尼泊尔', 'Nepal'],
  ['Asia/Dhaka', '达卡', '孟加拉', 'Bangladesh'],
  ['Asia/Karachi', '卡拉奇', '巴基斯坦', 'Pakistan', 'PKT'],
  ['Asia/Dubai', '迪拜', '阿联酋', '阿布扎比', 'UAE', 'Abu Dhabi', 'GST'],
  ['Asia/Riyadh', '利雅得', '沙特', 'Saudi Arabia'],
  ['Asia/Tehran', '德黑兰', '伊朗', 'Iran'],
  ['Asia/Jerusalem', '耶路撒冷', '以色列', '特拉维夫', 'Israel', 'Tel Aviv'],
  ['Europe/Istanbul', '伊斯坦布尔', '土耳其', 'Turkey'],
  ['Europe/Moscow', '莫斯科', '俄罗斯', 'Russia', 'MSK'],
  ['Europe/London', '伦敦', '英国', 'UK', 'Britain', 'BST', 'GMT'],
  ['Europe/Dublin', '都柏林', '爱尔兰', 'Ireland'],
  ['Europe/Lisbon', '里斯本', '葡萄牙', 'Portugal', 'WET'],
  ['Europe/Paris', '巴黎', '法国', 'France', 'CET', 'CEST'],
  ['Europe/Berlin', '柏林', '德国', '慕尼黑', 'Germany', 'Munich', 'CET', 'CEST'],
  ['Europe/Madrid', '马德里', '西班牙', 'Spain'],
  ['Europe/Rome', '罗马', '意大利', '米兰', 'Italy', 'Milan'],
  ['Europe/Amsterdam', '阿姆斯特丹', '荷兰', 'Netherlands'],
  ['Europe/Zurich', '苏黎世', '瑞士', '日内瓦', 'Switzerland', 'Geneva'],
  ['Europe/Stockholm', '斯德哥尔摩', '瑞典', 'Sweden'],
  ['Europe/Athens', '雅典', '希腊', 'Greece', 'EET'],
  ['Europe/Kyiv', '基辅', '乌克兰', 'Ukraine', 'Kiev'],
  ['Europe/Kiev', '基辅', '乌克兰', 'Ukraine', 'Kyiv'],
  ['Africa/Cairo', '开罗', '埃及', 'Egypt'],
  ['Africa/Johannesburg', '约翰内斯堡', '南非', 'South Africa', 'SAST'],
  ['Africa/Lagos', '拉各斯', '尼日利亚', 'Nigeria', 'WAT'],
  ['Africa/Nairobi', '内罗毕', '肯尼亚', 'Kenya', 'EAT'],
  ['America/New_York', '纽约', '美东', '东部时间', '华盛顿', '波士顿', 'Washington', 'Boston', 'EST', 'EDT', 'ET'],
  ['America/Detroit', '底特律', '安娜堡', '密歇根', 'Ann Arbor', 'Michigan'],
  ['America/Toronto', '多伦多', '加拿大', 'Canada', 'Montreal'],
  ['America/Chicago', '芝加哥', '美中', '中部时间', '休斯顿', '达拉斯', 'Houston', 'Dallas', 'CST', 'CDT', 'CT'],
  ['America/Denver', '丹佛', '山地时间', 'MST', 'MDT', 'MT'],
  ['America/Phoenix', '菲尼克斯', '亚利桑那', 'Arizona'],
  ['America/Los_Angeles', '洛杉矶', '美西', '太平洋时间', '旧金山', '西雅图', '硅谷', 'San Francisco', 'Seattle', 'PST', 'PDT', 'PT'],
  ['America/Vancouver', '温哥华'],
  ['America/Anchorage', '安克雷奇', '阿拉斯加', 'Alaska', 'AKST'],
  ['Pacific/Honolulu', '檀香山', '夏威夷', 'Hawaii', 'HST'],
  ['America/Mexico_City', '墨西哥城', '墨西哥', 'Mexico'],
  ['America/Bogota', '波哥大', '哥伦比亚', 'Colombia'],
  ['America/Lima', '利马', '秘鲁', 'Peru'],
  ['America/Santiago', '圣地亚哥', '智利', 'Chile'],
  ['America/Sao_Paulo', '圣保罗', '巴西', '里约热内卢', 'Brazil', 'Rio de Janeiro', 'BRT'],
  ['America/Argentina/Buenos_Aires', '布宜诺斯艾利斯', '阿根廷', 'Argentina'],
  ['Australia/Sydney', '悉尼', '澳大利亚', '堪培拉', 'Australia', 'Canberra', 'AEST', 'AEDT'],
  ['Australia/Melbourne', '墨尔本'],
  ['Australia/Brisbane', '布里斯班'],
  ['Australia/Adelaide', '阿德莱德', 'ACST'],
  ['Australia/Perth', '珀斯', 'AWST'],
  ['Pacific/Auckland', '奥克兰', '新西兰', '惠灵顿', 'New Zealand', 'Wellington', 'NZST', 'NZDT'],
  ['UTC', '协调世界时', '世界时', 'GMT', 'Zulu', 'Z'],
];

/** Default comparison zones for a first visit. */
export const DEFAULT_ZONES = [
  'Asia/Shanghai',
  'America/New_York',
  'Europe/London',
  'Asia/Tokyo',
  'America/Los_Angeles',
];

/** Fallback when Intl.supportedValuesOf is unavailable. */
const FALLBACK_IDS = FEATURED.map(([id]) => id);

let cachedEntries = null;
const entryIndex = new Map();

function cityFromId(id) {
  const tail = id.split('/').pop() ?? id;
  return tail.replace(/_/g, ' ');
}

function regionFromId(id) {
  return id.includes('/') ? id.split('/')[0] : '';
}

function makeEntry(id, featuredRow, rank) {
  const [, cityZh = '', ...aliases] = featuredRow ?? [];
  const city = id === 'UTC' ? 'UTC' : cityFromId(id);
  return {
    id,
    city,
    cityZh,
    region: regionFromId(id),
    aliases,
    rank, // lower = shown earlier when not searching
    haystack: [id, city, cityZh, ...aliases].join('\u0001').toLowerCase(),
  };
}

function runtimeZoneIds() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone');
  } catch {
    /* fall through to the curated list */
  }
  return FALLBACK_IDS;
}

/** All selectable zones: featured cities first, then the rest alphabetically. */
export function listZones() {
  if (cachedEntries) return cachedEntries;

  const featuredById = new Map();
  FEATURED.forEach((row, i) => {
    if (!featuredById.has(row[0])) featuredById.set(row[0], { row, rank: i });
  });

  const ids = new Set(runtimeZoneIds());
  ids.add('UTC');
  for (const id of featuredById.keys()) ids.add(id);

  const entries = [];
  const seenFeaturedNames = new Set();
  for (const id of ids) {
    if (!isValidZone(id)) continue;
    const featured = featuredById.get(id);
    // Europe/Kyiv vs Europe/Kiev: keep only one spelling per featured city.
    if (featured) {
      if (seenFeaturedNames.has(featured.row[1])) continue;
      seenFeaturedNames.add(featured.row[1]);
    }
    entries.push(makeEntry(id, featured?.row, featured ? featured.rank : Infinity));
  }

  entries.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  cachedEntries = entries;
  for (const entry of entries) entryIndex.set(entry.id, entry);
  return entries;
}

/** Catalogue entry for any valid zone id, including ids not in the listing. */
export function describeZone(id) {
  listZones();
  if (entryIndex.has(id)) return entryIndex.get(id);
  const featured = FEATURED.find((row) => row[0] === id);
  const entry = makeEntry(id, featured, Infinity);
  entryIndex.set(id, entry);
  return entry;
}

/** Primary display name: Chinese city name when known, otherwise the English city. */
export function displayName(entry) {
  return entry.cityZh || entry.city;
}

const OFFSET_QUERY = /^(?:utc|gmt)?\s*([+\-−])\s*(\d{1,2})(?:[:：.]?(\d{2}))?$/i;

/** Parses "+8", "UTC-5", "gmt+05:30", "−3:00" into minutes; null if not an offset query. */
export function parseOffsetQuery(query) {
  const match = OFFSET_QUERY.exec(query.trim());
  if (!match) return null;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? 0);
  if (hours > 14 || minutes > 59) return null;
  return sign * (hours * 60 + minutes);
}

/**
 * Ranked search. Matches Chinese names, English city names, zone ids,
 * aliases (countries, abbreviations) and UTC offsets ("+8", "UTC-5").
 * Offsets are evaluated at `instant` so daylight saving is respected.
 */
export function searchZones(query, { instant = Date.now() } = {}) {
  const entries = listZones();
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return entries;

  const offsetQuery = parseOffsetQuery(q);
  if (offsetQuery !== null) {
    return entries.filter((e) => getOffsetMinutes(instant, e.id) === offsetQuery);
  }

  const scored = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, q);
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.rank - b.entry.rank || a.entry.id.localeCompare(b.entry.id));
  return scored.map((s) => s.entry);
}

function scoreEntry(entry, q) {
  const names = [entry.cityZh, entry.city, ...entry.aliases].map((s) => s.toLowerCase());
  if (names.some((n) => n === q)) return 100;
  if (names.some((n) => n.startsWith(q))) return 80;
  if (entry.id.toLowerCase().startsWith(q)) return 60;
  if (names.some((n) => n.includes(q))) return 50;
  if (entry.haystack.includes(q)) return 30;
  // Allow "new york" to match "America/New_York".
  if (entry.haystack.includes(q.replace(/\s+/g, '_'))) return 25;
  return 0;
}
