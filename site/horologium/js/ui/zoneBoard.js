/**
 * Grid of comparison clocks. Rendering is a pure function of the card view
 * models; actions are dispatched through a single delegated listener.
 */

import { fill, h, icon } from './dom.js';

/**
 * @param {HTMLElement} container
 * @param {{ onAdd: (anchor: HTMLElement) => void, onRemove: (zone: string) => void,
 *           onMakeReference: (zone: string) => void, onCopy: (zone: string) => void }} handlers
 */
export function createZoneBoard(container, handlers) {
  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || !container.contains(button)) return;
    const { action, zone } = button.dataset;
    if (action === 'add') handlers.onAdd(button);
    else if (action === 'remove') handlers.onRemove(zone);
    else if (action === 'reference') handlers.onMakeReference(zone);
    else if (action === 'copy') handlers.onCopy(zone);
  });

  return {
    /** `freshZone` marks a just-added card so only it plays the entrance animation. */
    render(cards, { canAdd = true, freshZone = null } = {}) {
      fill(
        container,
        cards.map((card) => renderCard(card, card.zone === freshZone)),
        canAdd ? renderAddCard() : null,
      );
    },
  };
}

function actionButton(action, zone, iconName, tip) {
  return h(
    'button',
    { class: 'icon-btn', type: 'button', 'aria-label': tip, 'data-tip': tip, dataset: { action, zone } },
    icon(iconName),
  );
}

function renderCard(card, fresh) {
  return h(
    'article',
    { class: `zone-card band-${card.period.band}${fresh ? ' is-fresh' : ''}`, 'aria-label': `${card.title} 时间` },
    h(
      'header',
      { class: 'zone-card__head' },
      h(
        'div',
        { class: 'zone-card__names' },
        h('h3', { class: 'zone-card__title' }, card.title),
        h('p', { class: 'zone-card__subtitle' }, card.subtitle, h('span', { class: 'dot-sep' }, '·'), card.longName),
      ),
      h(
        'div',
        { class: 'zone-card__badges' },
        card.dayBadge ? h('span', { class: `badge ${card.dayDelta > 0 ? 'badge--ahead' : 'badge--behind'}` }, card.dayBadge) : null,
        card.dst ? h('span', { class: 'badge badge--dst', 'data-tip': '正在实行夏令时' }, '夏令时') : null,
      ),
    ),
    h(
      'div',
      { class: 'zone-card__clock' },
      card.clock.meridiem ? h('span', { class: 'zone-card__meridiem' }, card.clock.meridiem) : null,
      h('span', { class: 'zone-card__time' }, card.clock.time),
    ),
    h(
      'p',
      { class: 'zone-card__date' },
      card.dateLabel,
      h('span', { class: `period period--${card.period.band}` }, card.period.label),
    ),
    h(
      'footer',
      { class: 'zone-card__foot' },
      h(
        'div',
        { class: 'zone-card__offsets' },
        h('span', { class: 'mono' }, card.offsetLabel),
        h('span', { class: 'zone-card__diff' }, card.diffLabel),
      ),
      h(
        'div',
        { class: 'zone-card__actions' },
        actionButton('reference', card.zone, 'anchor', '设为基准'),
        actionButton('copy', card.zone, 'copy', '复制此时刻'),
        actionButton('remove', card.zone, 'close', '移除'),
      ),
    ),
  );
}

function renderAddCard() {
  return h(
    'button',
    { class: 'zone-card zone-card--add', type: 'button', dataset: { action: 'add' }, 'aria-haspopup': 'dialog' },
    icon('plus', 'icon--large'),
    h('span', { class: 'zone-card--add__label' }, '添加时区'),
    h('span', { class: 'zone-card--add__hint' }, '城市 · 国家 · 缩写 · 偏移'),
  );
}
