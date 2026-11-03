/**
 * Large segmented HH:MM input.
 * - Type digits; focus advances from hours to minutes automatically.
 * - ↑/↓ or the mouse wheel step by one unit (Shift: hours ±6, minutes ±15).
 *   Steps are reported as minute deltas so they roll over into the next day.
 */

import { pad2 } from '../core/format.js';
import { h } from './dom.js';

export function createTimeField({ onCommit, onStep }) {
  const makeSegment = (label, max) =>
    h('input', {
      class: 'tf__seg',
      type: 'text',
      inputmode: 'numeric',
      maxlength: '2',
      autocomplete: 'off',
      'aria-label': label,
      dataset: { max: String(max) },
    });

  const hour = makeSegment('小时', 23);
  const minute = makeSegment('分钟', 59);
  const seconds = h('span', { class: 'tf__seconds', 'aria-hidden': 'true' });
  const el = h('div', { class: 'tf', role: 'group', 'aria-label': '基准时间' }, hour, h('span', { class: 'tf__colon' }, ':'), minute, seconds);

  let value = { hour: 0, minute: 0 };

  const commit = () => {
    const next = {
      hour: clamp(parseInt(hour.value, 10), 0, 23, value.hour),
      minute: clamp(parseInt(minute.value, 10), 0, 59, value.minute),
    };
    hour.value = pad2(next.hour);
    minute.value = pad2(next.minute);
    if (next.hour !== value.hour || next.minute !== value.minute) {
      value = next;
      onCommit(next);
    }
  };

  const stepFor = (segment, direction, big) => {
    const unit = segment === hour ? 60 : 1;
    const multiplier = big ? (segment === hour ? 6 : 15) : 1;
    onStep(direction * unit * multiplier);
  };

  for (const segment of [hour, minute]) {
    segment.addEventListener('focus', () => segment.select());
    segment.addEventListener('input', () => {
      segment.value = segment.value.replace(/\D/g, '').slice(0, 2);
      const firstDigitLimit = segment === hour ? 2 : 5;
      const complete = segment.value.length === 2 || Number(segment.value) > firstDigitLimit;
      if (complete) {
        commit();
        if (segment === hour) minute.focus();
      }
    });
    segment.addEventListener('blur', commit);
    segment.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        commit();
        stepFor(segment, event.key === 'ArrowUp' ? 1 : -1, event.shiftKey);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        commit();
        segment.select();
      } else if (event.key === ':' && segment === hour) {
        event.preventDefault();
        commit();
        minute.focus();
      } else if (event.key === 'Backspace' && segment === minute && minute.selectionStart === 0 && minute.selectionEnd === 0) {
        hour.focus();
      }
    });
    segment.addEventListener(
      'wheel',
      (event) => {
        if (document.activeElement !== segment) return;
        event.preventDefault();
        stepFor(segment, event.deltaY < 0 ? 1 : -1, event.shiftKey);
      },
      { passive: false },
    );
  }

  return {
    el,
    /** Updates the displayed value; segments being edited are left alone. */
    setValue({ hour: hh, minute: mm, second }, { showSeconds = false } = {}) {
      value = { hour: hh, minute: mm };
      if (document.activeElement !== hour) hour.value = pad2(hh);
      if (document.activeElement !== minute) minute.value = pad2(mm);
      // The seconds slot keeps its width when hidden so the layout does not jump.
      seconds.textContent = `:${pad2(showSeconds ? second ?? 0 : 0)}`;
      seconds.style.visibility = showSeconds ? 'visible' : 'hidden';
    },
  };
}

function clamp(n, min, max, fallback) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
