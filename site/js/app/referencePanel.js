/**
 * The reference panel: zone and date selectors, the large time field,
 * the day scrubber, the live/now control and the DST notice.
 */

import { getZonedFields } from '../core/tz.js';
import { openDatePicker } from '../ui/datePicker.js';
import { fill, h, icon } from '../ui/dom.js';
import { closePopover, isPopoverOpenFor } from '../ui/popover.js';
import { createTimeField } from '../ui/timeField.js';
import { openZonePicker } from '../ui/zonePicker.js';

export function createReferencePanel(root, { actions, getState }) {
  const zoneButton = root.querySelector('[data-ref="zone"]');
  const dateButton = root.querySelector('[data-ref="date"]');
  const meta = root.querySelector('[data-ref="meta"]');
  const liveButton = root.querySelector('[data-ref="live"]');
  const scrubber = root.querySelector('[data-ref="scrubber"]');
  const notice = root.querySelector('[data-ref="notice"]');

  const timeField = createTimeField({ onCommit: actions.setTime, onStep: actions.shift });
  root.querySelector('[data-ref="time"]').append(timeField.el);

  zoneButton.addEventListener('click', () => {
    if (isPopoverOpenFor(zoneButton)) return closePopover();
    const { instant, refZone } = getState();
    openZonePicker(zoneButton, {
      instant,
      current: refZone,
      taken: [refZone],
      title: '选择基准时区',
      onSelect: actions.setRefZone,
    });
  });

  dateButton.addEventListener('click', () => {
    if (isPopoverOpenFor(dateButton)) return closePopover();
    const { instant, refZone } = getState();
    openDatePicker(dateButton, {
      value: getZonedFields(instant, refZone),
      today: getZonedFields(Date.now(), refZone),
      onSelect: actions.setDate,
    });
  });

  liveButton.addEventListener('click', actions.goLive);

  let scrubbing = false;
  scrubber.addEventListener('pointerdown', () => (scrubbing = true));
  window.addEventListener('pointerup', () => (scrubbing = false));
  scrubber.addEventListener('input', () => actions.setMinuteOfDay(Number(scrubber.value)));

  notice.addEventListener('click', (event) => {
    if (event.target.closest('[data-notice-action]')) actions.useAlternative();
  });

  return {
    render(view, state) {
      zoneButton.replaceChildren(
        h(
          'span',
          { class: 'select-btn__text' },
          h('span', { class: 'select-btn__main' }, view.title),
          h('span', { class: 'select-btn__sub' }, view.zone),
        ),
        icon('chevronDown', 'select-btn__chevron'),
      );
      dateButton.replaceChildren(
        icon('calendar'),
        h('span', { class: 'select-btn__main' }, view.dateLabel),
        icon('chevronDown', 'select-btn__chevron'),
      );
      fill(
        meta,
        h('span', {}, view.longName),
        h('span', { class: 'dot-sep' }, '·'),
        h('span', { class: 'mono' }, view.offsetLabel),
        view.dst ? h('span', { class: 'badge badge--dst' }, '夏令时') : null,
      );

      timeField.setValue(view.fields, { showSeconds: state.live });

      const minuteOfDay = view.fields.hour * 60 + view.fields.minute;
      if (!scrubbing) scrubber.value = String(minuteOfDay - (minuteOfDay % Number(scrubber.step || 1)));
      scrubber.style.setProperty('--progress', `${(minuteOfDay / 1439) * 100}%`);

      liveButton.classList.toggle('is-live', state.live);
      liveButton.setAttribute('aria-pressed', String(state.live));
      liveButton.replaceChildren(
        h('span', { class: 'live-dot', 'aria-hidden': 'true' }),
        state.live ? '实时' : '回到现在',
      );

      notice.hidden = !state.notice;
      if (state.notice) {
        fill(
          notice,
          icon('alert'),
          h('span', {}, state.notice.text),
          state.notice.alternative != null
            ? h('button', { class: 'link-btn', type: 'button', dataset: { noticeAction: 'alternative' } }, state.notice.alternativeLabel)
            : null,
        );
      }
    },
  };
}
