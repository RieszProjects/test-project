/** Tiny DOM helpers shared by all UI components. */

import { ICONS } from './icons.js';

/**
 * Creates an element. `props` keys:
 * - class, dataset, html (trusted markup only), on<Event> handlers,
 * - anything else becomes an attribute (true → empty attribute, false/null → omitted).
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

/** Replaces an element's children, skipping null/false entries (unlike replaceChildren). */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

/** Inline SVG icon from the built-in icon set. */
export function icon(name, className = '') {
  return h('span', { class: `icon ${className}`.trim(), 'aria-hidden': 'true', html: ICONS[name] ?? '' });
}

/** Coalesces repeated calls into one per animation frame. */
export function rafThrottle(fn) {
  let scheduled = false;
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...args);
    });
  };
}
