/** Non-blocking notifications stacked at the bottom of the viewport. */

import { h, icon } from './dom.js';

const DURATION_MS = 2600;

function root() {
  let el = document.getElementById('toast-root');
  if (!el) {
    el = h('div', { id: 'toast-root', class: 'toast-root', 'aria-live': 'polite' });
    document.body.append(el);
  }
  return el;
}

/** @param {'success'|'error'|'info'} tone */
export function toast(message, tone = 'info') {
  const iconName = tone === 'success' ? 'check' : tone === 'error' ? 'alert' : 'clock';
  const el = h('div', { class: `toast toast--${tone}`, role: 'status' }, icon(iconName), h('span', {}, message));
  root().append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  }, DURATION_MS);
}
