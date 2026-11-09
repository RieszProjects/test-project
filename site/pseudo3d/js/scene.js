// Loads an exported reconstruction: scene.json, mesh.bin and one image per source view.

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`无法加载 ${url}`));
    img.src = url;
  });
}

const TYPED = { float32: Float32Array, int16: Int16Array, uint16: Uint16Array, uint32: Uint32Array };

export async function loadScene(baseUrl, onProgress = () => {}) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const res = await fetch(`${base}scene.json`);
  if (!res.ok) throw new Error(`无法加载 ${base}scene.json`);
  const scene = await res.json();
  const total = scene.views.length + 1;
  let done = 0;
  const tick = () => onProgress(++done / total);

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
  const imagePromises = scene.views.map((v) => loadImage(`${base}${v.file}`).then((img) => {
    tick();
    return img;
  }));
  const [mesh, images] = await Promise.all([meshPromise, Promise.all(imagePromises)]);
  scene.views.forEach((v, i) => {
    v.image = images[i];
    v.url = `${base}${v.file}`;
  });
  return { ...scene, meshData: mesh };
}
