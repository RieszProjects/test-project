/** Entry point: wires state, view models and UI components together. */

import { buildHourGrid, buildReferenceView, buildZoneCard, summarize } from './app/model.js';
import { createReferencePanel } from './app/referencePanel.js';
import { MAX_ZONES, createActions, createInitialState } from './app/state.js';
import { describeZone, displayName } from './core/catalog.js';
import { buildShareHash, loadPrefs, readShareHash, savePrefs } from './core/persistence.js';
import { createStore } from './core/store.js';
import { MINUTE_MS } from './core/tz.js';
import { copyText } from './ui/clipboard.js';
import { icon, rafThrottle } from './ui/dom.js';
import { createHourGrid } from './ui/hourGrid.js';
import { closePopover, isPopoverOpenFor } from './ui/popover.js';
import { toast } from './ui/toast.js';
import { createZoneBoard } from './ui/zoneBoard.js';
import { openZonePicker } from './ui/zonePicker.js';

const store = createStore(createInitialState(location.hash));
const actions = createActions(store);
const $ = (selector) => document.querySelector(selector);

let latest = { reference: null, cards: [] };
let freshZone = null;

const referencePanel = createReferencePanel($('#reference'), { actions, getState: store.get });

const board = createZoneBoard($('#zone-board'), {
  onAdd(anchor) {
    if (isPopoverOpenFor(anchor)) return closePopover();
    const { instant, refZone, zones } = store.get();
    openZonePicker(anchor, {
      instant,
      taken: [refZone, ...zones],
      title: '添加时区',
      onSelect(zone) {
        freshZone = zone;
        actions.addZone(zone);
        toast(`已添加 ${displayName(describeZone(zone))}`, 'success');
      },
    });
  },
  onRemove(zone) {
    actions.removeZone(zone);
    toast(`已移除 ${displayName(describeZone(zone))}`);
  },
  onMakeReference(zone) {
    actions.makeReference(zone);
    toast(`已将 ${displayName(describeZone(zone))} 设为基准`);
  },
  async onCopy(zone) {
    const card = latest.cards.find((c) => c.zone === zone);
    if (!card) return;
    const text = summarize({ reference: latest.reference, cards: [card], hour12: store.get().hour12 });
    notifyCopy(await copyText(text), '已复制该时刻');
  },
});

const grid = createHourGrid($('#hour-grid'), { onPick: actions.jumpToHour });

function notifyCopy(ok, message) {
  toast(ok ? message : '复制失败，请检查浏览器的剪贴板权限', ok ? 'success' : 'error');
}

// ── Toolbar ────────────────────────────────────────────────────────────────
$('#toggle-hour12').addEventListener('click', actions.toggleHour12);
$('#toggle-theme').addEventListener('click', actions.toggleTheme);
$('#copy-all').addEventListener('click', async () => {
  const text = summarize({ ...latest, hour12: store.get().hour12 });
  notifyCopy(await copyText(text), '已复制全部时刻');
});
$('#share').addEventListener('click', async () => {
  const { refZone, zones } = store.get();
  const hash = buildShareHash({ fields: latest.reference.fields, refZone, zones });
  history.replaceState(null, '', hash);
  notifyCopy(await copyText(location.href), '分享链接已复制');
});

window.addEventListener('hashchange', () => {
  const shared = readShareHash(location.hash);
  if (shared) actions.loadShared(shared);
});

// ── Rendering ──────────────────────────────────────────────────────────────
let lastBoardKey = '';

const render = rafThrottle(() => {
  const state = store.get();
  const reference = buildReferenceView(state);
  referencePanel.render(reference, state);

  // Cards and the hour grid only change when the minute (or layout) changes,
  // so the per-second live tick does not rebuild them.
  const boardKey = [Math.floor(state.instant / MINUTE_MS), state.refZone, state.zones.join(','), state.hour12].join('|');
  if (boardKey !== lastBoardKey) {
    lastBoardKey = boardKey;
    const cards = state.zones.map((zone) =>
      buildZoneCard({ instant: state.instant, zone, refZone: state.refZone, refFields: reference.fields, hour12: state.hour12 }),
    );
    board.render(cards, { canAdd: state.zones.length < MAX_ZONES, freshZone });
    freshZone = null;
    grid.render(buildHourGrid({ instant: state.instant, refZone: state.refZone, zones: state.zones, hour12: state.hour12 }));
    latest = { reference, cards };
  } else {
    latest = { ...latest, reference };
  }

  document.documentElement.dataset.theme = state.theme;
  $('#toggle-hour12').replaceChildren(icon('clock'), state.hour12 ? '12 小时制' : '24 小时制');
  $('#toggle-hour12').setAttribute('aria-pressed', String(state.hour12));
  $('#toggle-theme').replaceChildren(icon(state.theme === 'dark' ? 'sun' : 'moon'));
  $('#toggle-theme').setAttribute('data-tip', state.theme === 'dark' ? '切换到羊皮纸主题' : '切换到暗色主题');
});

// While a shared link is being viewed, only display preferences are saved so
// the visitor's own zone list is not replaced by someone else's.
let lastSavedPrefs = '';
store.subscribe((state) => {
  render();
  const own = state.viewingShare ? {} : { refZone: state.refZone, zones: state.zones };
  const prefs = { ...loadPrefs(), ...own, hour12: state.hour12, theme: state.theme };
  const serialized = JSON.stringify(prefs);
  if (serialized !== lastSavedPrefs) {
    lastSavedPrefs = serialized;
    savePrefs(prefs);
  }
});

render();
setInterval(actions.tick, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) actions.tick();
});
