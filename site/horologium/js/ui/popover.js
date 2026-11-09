/**
 * Anchored popover used by the zone picker and the date picker.
 * Only one popover is open at a time; it closes on outside click, Escape,
 * or when the same anchor is activated again.
 */

import { h } from './dom.js';

let active = null;

export function isPopoverOpenFor(anchor) {
  return active?.anchor === anchor;
}

export function closePopover() {
  active?.close();
}

/**
 * Opens `content` next to `anchor`.
 * @returns {{ el: HTMLElement, close: () => void, reposition: () => void }}
 */
export function openPopover(anchor, content, { className = '', label = '', onClose } = {}) {
  closePopover();

  const el = h('div', { class: `popover ${className}`.trim(), role: 'dialog', 'aria-label': label }, content);
  document.body.append(el);
  anchor.setAttribute('aria-expanded', 'true');

  const reposition = () => {
    const margin = 12;
    const gap = 8;
    const a = anchor.getBoundingClientRect();
    const p = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;

    let top = a.bottom + gap;
    if (top + p.height > vh - margin && a.top - gap - p.height > margin) top = a.top - gap - p.height;
    top = Math.max(margin, Math.min(top, vh - p.height - margin));
    const left = Math.max(margin, Math.min(a.left, vw - p.width - margin));

    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  };

  const onPointerDown = (event) => {
    if (!el.contains(event.target) && !anchor.contains(event.target)) close();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      anchor.focus();
    }
  };

  function close() {
    if (active?.el !== el) return;
    active = null;
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    anchor.setAttribute('aria-expanded', 'false');
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 250);
    onClose?.();
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);

  reposition();
  active = { anchor, el, close };
  return { el, close, reposition };
}
