/** Month-view calendar rendered inside a popover. Weeks start on Monday. */

import { daysInMonth, weekdayOf } from '../core/format.js';
import { h, icon } from './dom.js';
import { openPopover } from './popover.js';

const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'];

/**
 * @param {HTMLElement} anchor
 * @param {{ value: {year:number, month:number, day:number}, today: {year:number, month:number, day:number},
 *           onSelect: (date: {year:number, month:number, day:number}) => void }} options
 */
export function openDatePicker(anchor, { value, today, onSelect }) {
  let view = { year: value.year, month: value.month };

  const title = h('span', { class: 'dp__title' });
  const grid = h('div', { class: 'dp__grid', role: 'grid' });
  const step = (delta) => {
    const index = view.year * 12 + (view.month - 1) + delta;
    view = { year: Math.floor(index / 12), month: (index % 12) + 1 };
    render();
  };

  const content = h(
    'div',
    { class: 'dp' },
    h(
      'div',
      { class: 'dp__head' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '上个月', onClick: () => step(-1) }, icon('chevronLeft')),
      title,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '下个月', onClick: () => step(1) }, icon('chevronRight')),
    ),
    h('div', { class: 'dp__weekdays' }, WEEK_HEAD.map((d) => h('span', {}, d))),
    grid,
    h(
      'div',
      { class: 'dp__foot' },
      h('button', { class: 'btn btn--ghost btn--small', type: 'button', onClick: () => pick(today) }, '今天'),
    ),
  );

  const popover = openPopover(anchor, content, { className: 'popover--date', label: '选择日期' });

  function pick(date) {
    popover.close();
    anchor.focus();
    onSelect({ year: date.year, month: date.month, day: date.day });
  }

  function render() {
    title.textContent = `${view.year}年${view.month}月`;
    const first = { year: view.year, month: view.month, day: 1 };
    const leading = (weekdayOf(first) + 6) % 7; // Monday-based column of day 1
    const total = daysInMonth(view.year, view.month);

    const cells = [];
    for (let i = 0; i < leading; i++) cells.push(h('span', { class: 'dp__blank' }));
    for (let day = 1; day <= total; day++) {
      const date = { year: view.year, month: view.month, day };
      const isSelected = sameDate(date, value);
      const isToday = sameDate(date, today);
      cells.push(
        h(
          'button',
          {
            type: 'button',
            class: `dp__day${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`,
            'aria-pressed': String(isSelected),
            'aria-label': `${view.year}年${view.month}月${day}日`,
            onClick: () => pick(date),
          },
          String(day),
        ),
      );
    }
    grid.replaceChildren(...cells);
  }

  render();
  popover.reposition();
  (grid.querySelector('.is-selected') ?? grid.querySelector('.dp__day'))?.focus({ preventScroll: true });
}

function sameDate(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}
