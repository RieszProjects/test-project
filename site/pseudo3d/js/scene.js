// Loads an exported reconstruction: scene.json, mesh.bin and (progressively) one image per view.

const TYPED = { float32: Float32Array, int16: Int16Array, uint16: Uint16Array, uint32: Uint32Array };

const unitDir = (az, el) => {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
};

// Downloads view images as blobs, nearest-first relative to a direction that can change over time.
export class ImageStore {
  constructor(views, { concurrency = 6 } = {}) {
    this.views = views;
    this.blobs = new Array(views.length).fill(null);
    this.pending = new Set();
    this.waiters = new Map();
    this.concurrency = concurrency;
    this.focus = [0, 0, 1];
    this.onLoad = null;
  }

  setFocus(dir) {
    this.focus = dir;
    this.pump();
  }

  has(i) {
    return this.blobs[i] !== null;
  }

  // Resolves when view i has been downloaded (and makes it the next download if it is not).
  get(i) {
    if (this.blobs[i]) return Promise.resolve(this.blobs[i]);
    return new Promise((resolve, reject) => {
      if (!this.waiters.has(i)) this.waiters.set(i, []);
      this.waiters.get(i).push({ resolve, reject });
      this.pump(i);
    });
  }

  next(prefer) {
    if (prefer !== undefined && !this.blobs[prefer] && !this.pending.has(prefer)) return prefer;
    let best = -1;
    let bestDot = -Infinity;
    this.views.forEach((v, i) => {
      if (this.blobs[i] || this.pending.has(i)) return;
      const d = v.dir[0] * this.focus[0] + v.dir[1] * this.focus[1] + v.dir[2] * this.focus[2];
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    });
    return best;
  }

  pump(prefer) {
    while (this.pending.size < this.concurrency) {
      const i = this.next(prefer);
      prefer = undefined;
      if (i < 0) return;
      this.pending.add(i);
      fetch(this.views[i].url)
        .then((r) => {
          if (!r.ok) throw new Error(`无法加载 ${this.views[i].url}`);
          return r.blob();
        })
        .then((blob) => {
          this.blobs[i] = blob;
          (this.waiters.get(i) || []).forEach((w) => w.resolve(blob));
          this.waiters.delete(i);
          if (this.onLoad) this.onLoad(i);
        })
        .catch((err) => {
          (this.waiters.get(i) || []).forEach((w) => w.reject(err));
          this.waiters.delete(i);
        })
        .finally(() => {
          this.pending.delete(i);
          this.pump();
        });
    }
  }
}

export async function loadScene(baseUrl, onProgress = () => {}, { initial = 24, focus = [0, 0, 1] } = {}) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const res = await fetch(`${base}scene.json`);
  if (!res.ok) throw new Error(`无法加载 ${base}scene.json`);
  const scene = await res.json();
  scene.views.forEach((v) => {
    v.url = `${base}${v.file}`;
  });

  // the first images to show: the ones closest to the opening camera direction
  const order = scene.views.map((v, i) => i)
    .sort((a, b) => {
      const da = scene.views[a].dir;
      const db = scene.views[b].dir;
      const dot = (d) => d[0] * focus[0] + d[1] * focus[1] + d[2] * focus[2];
      return dot(db) - dot(da);
    });
  const first = order.slice(0, Math.min(initial, order.length));
  const total = first.length + 1;
  let done = 0;
  const tick = () => onProgress(++done / total);

  const store = new ImageStore(scene.views);
  store.setFocus(focus);
  const meshPromise = fetch(`${base}${scene.mesh.file}`)
    .then((r) => {
      if (!r.ok) throw new Error('无法加载网格');
      return r.arrayBuffer();
    })
    .then((buf) => {
      tick();
      const view = (key) => {
        const info = scene.mesh[key];
        const T = TYPED[info.type];
        return new T(buf, info.offset, info.bytes / T.BYTES_PER_ELEMENT);
      };
      return { positions: view('positions'), normals: view('normals'), indices: view('indices') };
    });
  const [mesh] = await Promise.all([meshPromise, ...first.map((i) => store.get(i).then(tick))]);
  return { ...scene, meshData: mesh, store };
}

export { unitDir };
