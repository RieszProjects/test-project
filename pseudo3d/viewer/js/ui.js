// DOM side of the viewer: control panel, source-photo strip and toasts.

export function bindControls(settings) {
  const modeGroup = document.getElementById('mode');
  const blend = document.getElementById('blend');
  const blendOut = document.getElementById('blend-out');
  const toggles = {
    autoRotate: document.getElementById('opt-spin'),
    cards: document.getElementById('opt-cards'),
    shadow: document.getElementById('opt-shadow'),
    ortho: document.getElementById('opt-ortho'),
  };

  modeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    settings.mode = btn.dataset.mode;
    sync();
  });
  blend.addEventListener('input', () => {
    settings.blendCount = Number(blend.value);
    sync();
  });
  Object.entries(toggles).forEach(([key, input]) => {
    input.addEventListener('change', () => {
      settings[key] = input.checked;
    });
  });

  const panel = document.getElementById('panel');
  const panelToggle = document.getElementById('panel-toggle');
  panelToggle.addEventListener('click', () => {
    const open = panel.classList.toggle('closed') === false;
    panelToggle.setAttribute('aria-expanded', String(open));
    updateFraming();
  });
  if (window.matchMedia('(max-width: 720px)').matches) {
    panel.classList.add('closed');
    panelToggle.setAttribute('aria-expanded', 'false');
  }

  // keep the object centred in the part of the canvas not covered by the panel and the photo strip
  const strip = document.getElementById('strip');
  function updateFraming() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const wide = W > 720;
    const panelW = wide && !panel.classList.contains('closed') ? panel.offsetWidth + 20 : 0;
    settings.shiftX = -panelW / W;
    settings.shiftY = (strip.offsetHeight + 18) / H;
  }
  window.addEventListener('resize', updateFraming);
  updateFraming();

  function sync() {
    modeGroup.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode));
    });
    blend.value = settings.blendCount;
    blendOut.textContent = settings.blendCount;
    blend.closest('.slider').classList.toggle('muted', settings.mode === 'geometry' || settings.mode === 'nearest');
    Object.entries(toggles).forEach(([key, input]) => {
      input.checked = settings[key];
    });
  }
  sync();
  return { sync, updateFraming };
}

const fmtAngle = (x) => `${Math.round(x)}°`;

export function buildStrip(container, views, { onSelect, onToggle }) {
  const items = views.map((v, i) => {
    const item = document.createElement('div');
    item.className = 'thumb';
    item.innerHTML = `
      <button class="thumb-main" title="转到此视角">
        <span class="thumb-img"><img alt="" loading="lazy" /></span>
        <span class="thumb-label"></span>
        <span class="thumb-angles"></span>
      </button>
      <button class="thumb-eye" aria-pressed="true" title="参与混合">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>
      </button>
      <span class="thumb-weight"><i></i></span>`;
    item.querySelector('img').src = v.url;
    item.querySelector('.thumb-label').textContent = v.label || v.name;
    item.querySelector('.thumb-angles').textContent = `${fmtAngle(v.az)} / ${fmtAngle(v.el)}`;
    if (v.source) item.dataset.source = v.source;
    item.querySelector('.thumb-main').addEventListener('click', () => onSelect(i));
    const eye = item.querySelector('.thumb-eye');
    eye.addEventListener('click', () => {
      const on = eye.getAttribute('aria-pressed') !== 'true';
      if (onToggle(i, on) === false) return;
      eye.setAttribute('aria-pressed', String(on));
      item.classList.toggle('off', !on);
    });
    container.appendChild(item);
    return item;
  });

  // vertical wheel scrolls the strip sideways
  container.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      container.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });

  return {
    update(weights) {
      const max = Math.max(...weights) || 1;
      items.forEach((item, i) => {
        item.querySelector('.thumb-weight i').style.transform = `scaleX(${weights[i] / max})`;
        item.classList.toggle('active', weights[i] === max);
      });
    },
  };
}

let toastTimer = 0;
export function showToast(message, sticky = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  if (!sticky) {
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 300);
    }, 2400);
  }
}
