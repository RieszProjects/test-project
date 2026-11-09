/**
 * Searchable time-zone picker rendered inside a popover.
 * Keyboard: ↑/↓ to move, Enter to choose, Esc to close.
 */

import { displayName, searchZones } from '../core/catalog.js';
import { formatOffset } from '../core/format.js';
import { getOffsetMinutes } from '../core/tz.js';
import { h, icon } from './dom.js';
import { openPopover } from './popover.js';

const MAX_RESULTS = 250;

export function openZonePicker(anchor, { instant, current = null, taken = [], title = '选择时区', onSelect }) {
  const takenSet = new Set(taken);
  const offsetCache = new Map();
  const offsetOf = (zone) => {
    if (!offsetCache.has(zone)) offsetCache.set(zone, getOffsetMinutes(instant, zone));
    return offsetCache.get(zone);
  };

  const input = h('input', {
    class: 'zp__input',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: '城市、国家、缩写或偏移，如 东京 / Paris / EST / +8',
    'aria-label': '搜索时区',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'zp-list',
  });
  const list = h('ul', { class: 'zp__list scroll-area', id: 'zp-list', role: 'listbox' });
  const count = h('span', { class: 'zp__count' });

  let results = [];
  let cursor = 0;

  const content = h(
    'div',
    { class: 'zp' },
    h('div', { class: 'zp__head' }, h('span', { class: 'zp__title' }, title), count),
    h('label', { class: 'zp__search' }, icon('search'), input),
    list,
  );

  const popover = openPopover(anchor, content, { className: 'popover--zone', label: title });

  function choose(index) {
    const entry = results[index];
    if (!entry || takenSet.has(entry.id)) return;
    popover.close();
    anchor.focus();
    onSelect(entry.id);
  }

  function moveCursor(next) {
    if (!results.length) return;
    cursor = (next + results.length) % results.length;
    for (const item of list.children) {
      const selected = Number(item.dataset.index) === cursor;
      item.setAttribute('aria-selected', String(selected));
      if (selected) item.scrollIntoView({ block: 'nearest' });
    }
  }

  function render() {
    results = searchZones(input.value, { instant }).slice(0, MAX_RESULTS);
    cursor = Math.max(0, results.findIndex((e) => !takenSet.has(e.id)));
    count.textContent = results.length ? `${results.length}${results.length === MAX_RESULTS ? '+' : ''} 项` : '';

    list.replaceChildren(
      ...results.map((entry, index) =>
        h(
          'li',
          {
            class: `zp__item${entry.id === current ? ' is-current' : ''}${takenSet.has(entry.id) ? ' is-taken' : ''}`,
            role: 'option',
            'aria-selected': String(index === cursor),
            'aria-disabled': takenSet.has(entry.id) ? 'true' : null,
            dataset: { index: String(index) },
          },
          h(
            'span',
            { class: 'zp__names' },
            h('span', { class: 'zp__name' }, displayName(entry)),
            h('span', { class: 'zp__id' }, entry.cityZh ? `${entry.city} · ${entry.id}` : entry.id),
          ),
          h(
            'span',
            { class: 'zp__meta' },
            takenSet.has(entry.id) ? h('span', { class: 'zp__tag' }, entry.id === current ? '当前' : '已添加') : null,
            h('span', { class: 'zp__offset' }, formatOffset(offsetOf(entry.id))),
          ),
        ),
      ),
    );

    if (!results.length) {
      list.append(h('li', { class: 'zp__empty' }, '没有匹配的时区。试试城市英文名、国家或 “+8” 这样的偏移。'));
    }
    list.scrollTop = 0;
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveCursor(cursor + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveCursor(cursor - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(cursor);
    }
  });
  list.addEventListener('click', (event) => {
    const item = event.target.closest('.zp__item');
    if (item) choose(Number(item.dataset.index));
  });
  list.addEventListener('pointermove', (event) => {
    const item = event.target.closest('.zp__item');
    if (item && Number(item.dataset.index) !== cursor) {
      cursor = Number(item.dataset.index);
      for (const li of list.children) li.setAttribute('aria-selected', String(li === item));
    }
  });

  render();
  popover.reposition();
  input.focus({ preventScroll: true });
}
