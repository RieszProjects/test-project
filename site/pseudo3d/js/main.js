// Entry point: loads a reconstruction, wires the controls and runs the render loop.
import { loadScene, unitDir } from './scene.js';
import { Renderer } from './renderer.js';
import { OrbitCamera, DEG } from './orbit.js';
import { buildStrip, bindControls, buildObjectNav, showToast } from './ui.js';
import { buildViewMap } from './viewmap.js';

const params = new URLSearchParams(location.search);
const objectName = (params.get('object') || 'pistol').replace(/[^a-z0-9_-]/gi, '');
const STRIP_MAX_VIEWS = 30;   // more views than this are shown on a direction map instead of a strip
const HOME = { yaw: 28, pitch: 16 };

const settings = {
  mode: 'blend',
  blendCount: 2,
  blendSharpness: 1,
  fade: 0,          // seconds; > 0 switches between photos by a cross-fade in time (see Renderer)
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
  const homeDir = unitDir(HOME.yaw, HOME.pitch);
  const scene = await loadScene(`assets/${objectName}`, (p) => {
    fill.style.transform = `scaleX(${p})`;
  }, { focus: homeDir });

  // per-object defaults stored with the reconstruction (e.g. a narrower blend for faces)
  Object.assign(settings, scene.viewer?.settings || {});
  document.getElementById('obj-title').textContent = scene.title || scene.object;
  document.getElementById('obj-count').textContent = scene.views.length;
  document.title = `伪 3D 重建 · ${scene.title || scene.object}`;

  const renderer = new Renderer(canvas, scene);
  await renderer.prime(homeDir);
  const R = scene.radius;
  // frame the bounding sphere (vertical field of view 30 degrees); narrow screens need more distance
  const fit = scene.viewer?.distance ?? 4.2;   // round objects need a little more room than flat ones
  const homeDistance = () => R * fit * Math.max(1, 1.25 / (window.innerWidth / window.innerHeight));
  const camera = new OrbitCamera(canvas, { distance: homeDistance(), minDistance: R * 0.6, maxDistance: R * 16 });
  camera.home = { yaw: HOME.yaw * DEG, pitch: HOME.pitch * DEG, roll: 0, distance: homeDistance(), target: [0, 0, 0] };
  window.addEventListener('resize', () => { camera.home.distance = homeDistance(); });
  camera.yaw = -40 * DEG;
  camera.pitch = 8 * DEG;
  camera.flyTo(camera.home, 1.6);

  const select = (i) => {
    const v = scene.views[i];
    settings.autoRotate = false;
    controls.sync();
    camera.flyTo({ yaw: v.az * DEG, pitch: v.el * DEG, roll: v.roll * DEG, target: [0, 0, 0] });
  };
  const many = scene.views.length > STRIP_MAX_VIEWS;
  const browser = many
    ? buildViewMap(document.getElementById('viewmap'), scene.views, { onSelect: select })
    : buildStrip(document.getElementById('strip'), scene.views, {
      onSelect: select,
      onToggle: (i, on) => {
        renderer.viewOn[i] = on ? 1 : 0;
        if (!renderer.viewOn.some((x) => x > 0.5)) {
          renderer.viewOn[i] = 1;
          showToast('至少保留一张照片');
          return false;
        }
        return true;
      },
    });
  document.getElementById(many ? 'strip' : 'viewmap').hidden = true;

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

  let pending = false;
  // handle for automated checks and console experiments; ready() resolves once the views needed
  // for the current camera are on the GPU and drawn
  window.viewer = {
    scene, renderer, camera, settings, controls,
    ready: () => new Promise((resolve) => {
      const check = () => (pending || renderer.dirty ? setTimeout(check, 50) : resolve());
      setTimeout(check, 50);
    }),
  };

  let last = performance.now();
  let lastKey = '';
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    camera.autoRotate = settings.autoRotate;
    camera.update(dt);
    const back = camera.basis().back;
    scene.store.setFocus(back);
    pending = renderer.updateResidency(back);
    const fading = renderer.updateWeights(back, settings, dt);
    const resized = renderer.resize();
    const key = JSON.stringify([camera.yaw, camera.pitch, camera.roll, camera.distance, camera.target,
      settings, Array.from(renderer.viewOn)]);
    if (resized || key !== lastKey || renderer.dirty || fading) {
      lastKey = key;
      renderer.draw(camera, settings);
      browser.update(renderer.shownW, back);
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
