// Direction map of the source views (azimuth across, elevation up), used instead of a thumbnail strip
// when there are many views. Hovering a dot previews the photo, clicking flies the camera there.

const wrap = (a) => ((a + 180) % 360 + 360) % 360 - 180;
const AZ_LABELS = [[0, '正面'], [90, '左侧'], [-90, '右侧'], [180, '背面']];

export function buildViewMap(container, views, { onSelect }) {
  container.innerHTML = `
    <canvas class="viewmap-canvas" aria-label="源照片方向分布"></canvas>
    <div class="viewmap-tip" hidden><img alt="" /><span></span></div>`;
  const canvas = container.querySelector('canvas');
  const tip = container.querySelector('.viewmap-tip');
  const tipImg = tip.querySelector('img');
  const tipText = tip.querySelector('span');
  const ctx = canvas.getContext('2d');
  const pad = { l: 14, r: 14, t: 12, b: 22 };
  let weights = views.map(() => 0);
  let camDir = [0, 0, 1];
  let hover = -1;

  const geom = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return { w, h, x: (az) => pad.l + ((wrap(az) + 180) / 360) * (w - pad.l - pad.r),
      y: (el) => pad.t + ((90 - el) / 180) * (h - pad.t - pad.b) };
  };

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const g = geom();
    if (canvas.width !== Math.round(g.w * dpr)) {
      canvas.width = Math.round(g.w * dpr);
      canvas.height = Math.round(g.h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.w, g.h);
    const style = getComputedStyle(container);
    const brass = style.getPropertyValue('--brass').trim() || '#cfa75e';
    const line = 'rgba(214, 186, 128, 0.14)';
    ctx.lineWidth = 1;
    ctx.strokeStyle = line;
    for (let el = -60; el <= 60; el += 30) {
      ctx.beginPath();
      ctx.moveTo(g.x(-180), g.y(el) + 0.5);
      ctx.lineTo(g.x(180), g.y(el) + 0.5);
      ctx.stroke();
    }
    ctx.font = '11px "Noto Serif SC", serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(205, 189, 156, 0.55)';
    for (const [az, label] of AZ_LABELS) {
      ctx.beginPath();
      ctx.moveTo(g.x(az) + 0.5, g.y(90));
      ctx.lineTo(g.x(az) + 0.5, g.y(-90));
      ctx.stroke();
      if (az !== 180) ctx.fillText(label, g.x(az), g.h - 6);
    }
    ctx.textAlign = 'left';
    ctx.fillText('背面', g.x(-180) + 2, g.h - 6);
    const maxW = Math.max(...weights) || 1;
    views.forEach((v, i) => {
      const w = weights[i] / maxW;
      ctx.beginPath();
      ctx.arc(g.x(v.az), g.y(v.el), i === hover ? 4.5 : 2.6 + 1.6 * w, 0, Math.PI * 2);
      ctx.fillStyle = w > 0.01 ? brass : 'rgba(205, 189, 156, 0.45)';
      ctx.globalAlpha = w > 0.01 ? 0.45 + 0.55 * w : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    // current camera direction
    const caz = (Math.atan2(camDir[0], camDir[2]) * 180) / Math.PI;
    const cel = (Math.asin(Math.max(-1, Math.min(1, camDir[1]))) * 180) / Math.PI;
    ctx.beginPath();
    ctx.arc(g.x(caz), g.y(cel), 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#ecc77f';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    const g = geom();
    const mx = ev.clientX - r.left;
    const my = ev.clientY - r.top;
    let best = -1;
    let bestD = 10 * 10;
    views.forEach((v, i) => {
      const d = (g.x(v.az) - mx) ** 2 + (g.y(v.el) - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return { i: best, mx, my };
  }

  canvas.addEventListener('pointermove', (ev) => {
    const { i, mx, my } = pick(ev);
    if (i !== hover) {
      hover = i;
      draw();
    }
    canvas.style.cursor = i >= 0 ? 'pointer' : 'default';
    if (i < 0) {
      tip.hidden = true;
      return;
    }
    if (tipImg.dataset.src !== views[i].url) {
      tipImg.src = views[i].url;
      tipImg.dataset.src = views[i].url;
    }
    tipText.textContent = views[i].label || views[i].name;
    tip.hidden = false;
    const left = Math.min(Math.max(mx - 60, 0), canvas.clientWidth - 120);
    tip.style.transform = `translate(${left}px, ${my - 150}px)`;
  });
  canvas.addEventListener('pointerleave', () => {
    hover = -1;
    tip.hidden = true;
    draw();
  });
  canvas.addEventListener('click', (ev) => {
    const { i } = pick(ev);
    if (i >= 0) onSelect(i);
  });
  window.addEventListener('resize', draw);
  container.hidden = false;
  draw();

  return {
    update(w, dir) {
      weights = w;
      camDir = dir;
      draw();
    },
  };
}
