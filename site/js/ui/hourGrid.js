/**
 * Hour-by-hour comparison table ("time band"). Each column is one hour of the
 * reference day; clicking a column moves the reference time to that hour.
 */

import { h } from './dom.js';

/**
 * @param {HTMLElement} container
 * @param {{ onPick: (columnInstant: number) => void }} handlers
 */
export function createHourGrid(container, { onPick }) {
  let columns = [];
  let shownIndex = null;

  container.addEventListener('click', (event) => {
    const cell = event.target.closest('[data-col]');
    if (cell && container.contains(cell)) onPick(columns[Number(cell.dataset.col)]);
  });

  return {
    render(model) {
      columns = model.columns;
      const table = h(
        'table',
        { class: 'hour-grid' },
        h(
          'tbody',
          {},
          model.rows.map((row) =>
            h(
              'tr',
              { class: row.isReference ? 'is-reference' : '' },
              h(
                'th',
                { scope: 'row', class: 'hour-grid__zone' },
                h('span', { class: 'hour-grid__title' }, row.title),
                h(
                  'span',
                  { class: 'hour-grid__offset' },
                  row.isReference ? '基准' : row.compactDiff,
                  h('span', { class: 'dot-sep' }, '·'),
                  row.offsetLabel,
                ),
              ),
              row.cells.map((cell, col) =>
                h(
                  'td',
                  {
                    class: `hour-cell band-${cell.band}${col === model.currentIndex ? ' is-current' : ''}`,
                    dataset: { col: String(col) },
                  },
                  cell.dateMark ? h('span', { class: 'hour-cell__date' }, cell.dateMark) : null,
                  h('span', { class: 'hour-cell__hour' }, cell.label),
                ),
              ),
            ),
          ),
        ),
      );

      const previousScroll = container.scrollLeft;
      container.replaceChildren(table);
      container.scrollLeft = previousScroll;

      if (model.currentIndex !== shownIndex) {
        revealCurrent(container, shownIndex === null ? 'auto' : 'smooth');
        shownIndex = model.currentIndex;
      }
    },
  };
}

/** Scrolls horizontally just enough to bring the highlighted column into view. */
function revealCurrent(container, behavior) {
  const current = container.querySelector('.is-reference .is-current');
  const zoneColumn = container.querySelector('.hour-grid__zone');
  if (!current || !zoneColumn) return;
  const stickyWidth = zoneColumn.offsetWidth;
  const visibleStart = container.scrollLeft + stickyWidth;
  const visibleEnd = container.scrollLeft + container.clientWidth;
  const cellStart = current.offsetLeft;
  const cellEnd = cellStart + current.offsetWidth;
  if (cellStart >= visibleStart && cellEnd <= visibleEnd) return;
  const centred = cellStart - stickyWidth - (container.clientWidth - stickyWidth - current.offsetWidth) / 2;
  container.scrollTo({ left: Math.max(0, centred), behavior });
}
