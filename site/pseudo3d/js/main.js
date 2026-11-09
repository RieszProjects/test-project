// Entry point: loads a reconstruction, wires the controls and runs the render loop.
import { loadScene } from './scene.js';
import { Renderer } from './renderer.js';
import { OrbitCamera, DEG } from './orbit.js';
import { buildStrip, bindControls, buildObjectNav, showToast } from './ui.js';

const params = new URLSearchParams(location.search);
const objectName = (params.get('object') || 'pistol').replace(/[^a-z0-9_-]/gi, '');

const settings = {
  mode: 'blend',
  blendCount: 2,
  blendSharpness: 1,
  cards: false,
  shadow: true,
  ortho: false,
  autoRotate: true,
};

async function start() {
  fetch('assets/index.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => buildObjectNav(document.getElementById('objects'), list, objectName))
    .catch(() => {});
  const canvas = document.getElementById('view');
  const fill = document.getElementById('loading-fill');
  const scene = await loadScene(`assets/${objectName}`, (p) => {
    fill.style.transform = `scaleX(${p})`;
  });

  // per-object defaults stored with the reconstruction (e.g. a narrower blend for faces)
  Object.assign(settings, scene.viewer?.settings || {});
  document.getElementById('obj-title').textContent = scene.title || scene.object;
  document.getElementById('obj-count').textContent = scene.views.length;
  document.title = `伪 3D 重建 · ${scene.title || scene.object}`;

  const renderer = new Renderer(canvas, scene);
  const R = scene.radius;
  // frame the bounding sphere (vertical field of view 30 degrees); narrow screens need more distance
  const homeDistance = () => R * 4.2 * Math.max(1, 1.25 / (window.innerWidth / window.innerHeight));
  const camera = new OrbitCamera(canvas, { distance: homeDistance(), minDistance: R * 0.6, maxDistance: R * 16 });
  camera.home = { yaw: 28 * DEG, pitch: 16 * DEG, roll: 0, distance: homeDistance(), target: [0, 0, 0] };
  window.addEventListener('resize', () => { camera.home.distance = homeDistance(); });
  camera.yaw = -40 * DEG;
  camera.pitch = 8 * DEG;
  camera.flyTo(camera.home, 1.6);

  const strip = buildStrip(document.getElementById('strip'), scene.views, {
    onSelect: (i) => {
      const v = scene.views[i];
      settings.autoRotate = false;
      controls.sync();
      camera.flyTo({ yaw: v.az * DEG, pitch: v.el * DEG, roll: v.roll * DEG, target: [0, 0, 0] });
    },
    onToggle: (i, on) => {
      renderer.viewOn[i] = on ? 1 : 0;
      if (!renderer.viewOn.some((x, k) => k < scene.views.length && x > 0.5)) {
        renderer.viewOn[i] = 1;
        showToast('至少保留一张照片');
        return false;
      }
      return true;
    },
  });

  const controls = bindControls(settings);
  requestAnimationFrame(() => controls.updateFraming());  // the strip has its height only now
  camera.onInteract = () => {
    if (settings.autoRotate) {
      settings.autoRotate = false;
      controls.sync();
    }
  };

  const m = scene.mesh;
  document.getElementById('stats').innerHTML = [
    ['顶点', m.vertexCount.toLocaleString('zh-CN')],
    ['三角面', (m.indexCount / 3).toLocaleString('zh-CN')],
    ['照片', scene.views.length],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');

  document.getElementById('loading').classList.add('done');
  // handle for automated checks and console experiments
  window.viewer = { scene, renderer, camera, settings, controls };

  let last = performance.now();
  let lastKey = '';
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    camera.autoRotate = settings.autoRotate;
    camera.update(dt);
    const resized = renderer.resize();
    const key = JSON.stringify([camera.yaw, camera.pitch, camera.roll, camera.distance, camera.target,
      settings, Array.from(renderer.viewOn)]);
    if (resized || key !== lastKey) {
      lastKey = key;
      renderer.draw(camera, settings);
      strip.update(renderer.viewWeights(camera.basis().back, settings.blendCount + 1, settings.blendSharpness));
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'r' || e.key === 'R') camera.flyTo(camera.home);
  });
}

start().catch((err) => {
  console.error(err);
  document.getElementById('loading').classList.add('done');
  showToast(err.message || String(err), true);
});
