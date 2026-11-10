// WebGL2 renderer: view-dependent projective texturing with a cache of GPU-resident views.
//
// A reconstruction may have hundreds of source views, far more than fit in GPU memory at once. The
// renderer keeps `slots` of them resident (image + depth map layers in two texture arrays) and swaps in
// the views closest to the current viewing direction as the camera moves; views outside the cache
// simply do not contribute until they are loaded.
import { createProgram } from './glutil.js';
import * as M from './mat4.js';
import { vec3 } from './mat4.js';
import { ulrWeights } from './ulr.js';
import {
  MAX_VIEWS, depthVS, depthFS, meshVS, meshFS, cardVS, cardFS, shadowVS, shadowFS,
} from './shaders.js';

const DEPTH_SIZE = 1024;
const UPLOADS_PER_FRAME = 2;
export const MODES = { blend: 0, nearest: 1, geometry: 2, weights: 3 };

export function viewPalette(n) {
  return Array.from({ length: n }, (_, i) => {
    const h = ((i * 137.508) % 360);   // golden-angle hues stay distinct for any n
    const c = (1 - Math.abs(2 * 0.58 - 1)) * 0.62;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = 0.58 - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m];
  });
}

export class Renderer {
  constructor(canvas, scene) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.canvas = canvas;
    this.scene = scene;
    this.store = scene.store;
    this.views = scene.views;
    this.n = this.views.length;
    this.slots = Math.min(this.n, MAX_VIEWS);
    this.palette = viewPalette(this.n);
    this.viewOn = new Float32Array(this.n).fill(1);
    this.shownW = null;   // per-view weights actually used, eased towards the target over time
    this.viewTex = this.views.map((v) => M.fromRows3x4(v.matrix));

    // slot bookkeeping: slotView[s] = view index held (or being loaded) in slot s, -1 if empty
    this.slotView = new Int32Array(this.slots).fill(-1);
    this.slotReady = new Uint8Array(this.slots);
    this.viewSlot = new Int32Array(this.n).fill(-1);
    this.loading = 0;
    this.mipsDirty = false;
    this.cardsDirty = true;
    this.dirty = true;

    // per-slot uniform arrays
    this.slotTex = new Float32Array(16 * MAX_VIEWS);
    this.slotDir = new Float32Array(3 * MAX_VIEWS);
    this.slotColor = new Float32Array(3 * MAX_VIEWS);
    this.slotOn = new Float32Array(MAX_VIEWS);
    this.slotW = new Float32Array(MAX_VIEWS);
    this.highlight = new Float32Array(MAX_VIEWS);
    this.cardFade = new Float32Array(MAX_VIEWS);

    this.programs = {
      depth: createProgram(gl, depthVS, depthFS),
      mesh: createProgram(gl, meshVS, meshFS),
      card: createProgram(gl, cardVS, cardFS),
      shadow: createProgram(gl, shadowVS, shadowFS),
    };
    this.createMesh(scene.meshData);
    this.createImageArray();
    this.createDepthArray();
    this.createCards();
    this.createShadow();
  }

  createMesh({ positions, normals, indices }) {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nb);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.SHORT, true, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.indexCount = indices.length;
    this.indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  }

  createImageArray() {
    const gl = this.gl;
    const size = this.scene.texSize;
    this.images = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.images);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(size)) + 1, gl.RGBA8, size, size, this.slots);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
  }

  createDepthArray() {
    const gl = this.gl;
    this.depths = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.depths);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT32F, DEPTH_SIZE, DEPTH_SIZE, this.slots);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.depthFbo = gl.createFramebuffer();
  }

  // ------------------------------------------------------------------ view cache
  dirScore(i, dir) {
    const d = this.views[i].dir;
    return d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2];
  }

  // Views that should be resident for viewing direction `dir`: the enabled ones closest to it.
  wanted(dir) {
    const idx = [];
    for (let i = 0; i < this.n; i++) if (this.viewOn[i] > 0.5) idx.push(i);
    idx.sort((a, b) => this.dirScore(b, dir) - this.dirScore(a, dir));
    return idx.slice(0, this.slots);
  }

  freeSlot(wantedSet, dir) {
    let best = -1;
    let bestScore = Infinity;
    for (let s = 0; s < this.slots; s++) {
      const v = this.slotView[s];
      if (v < 0) return s;
      if (!this.slotReady[s] || wantedSet.has(v)) continue;
      const score = this.dirScore(v, dir);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  // Start loading missing views for direction `dir`; returns true while the cache is incomplete.
  updateResidency(dir, limit = UPLOADS_PER_FRAME) {
    const wanted = this.wanted(dir);
    const wantedSet = new Set(wanted);
    let started = 0;
    for (const v of wanted) {
      if (this.viewSlot[v] >= 0) continue;
      if (started >= limit) break;
      const slot = this.freeSlot(wantedSet, dir);
      if (slot < 0) break;
      this.loadInto(v, slot);
      started++;
    }
    return this.loading > 0 || wanted.some((v) => this.viewSlot[v] < 0 || !this.slotReady[this.viewSlot[v]]);
  }

  async loadInto(v, slot) {
    const old = this.slotView[slot];
    if (old >= 0) this.viewSlot[old] = -1;
    this.slotView[slot] = v;
    this.slotReady[slot] = 0;
    this.viewSlot[v] = slot;
    this.loading++;
    try {
      const blob = await this.store.get(v);
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      if (this.slotView[slot] === v) {
        const gl = this.gl;
        const size = this.scene.texSize;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.images);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, slot, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
        this.renderDepth(slot, v);
        this.slotTex.set(this.viewTex[v], slot * 16);
        this.slotDir.set(this.views[v].dir, slot * 3);
        this.slotColor.set(this.palette[v], slot * 3);
        this.slotReady[slot] = 1;
        this.mipsDirty = true;
        this.cardsDirty = true;
        this.dirty = true;
      }
      bmp.close();
    } catch (err) {
      console.error(err);
      if (this.slotView[slot] === v) {
        this.slotView[slot] = -1;
        this.viewSlot[v] = -1;
      }
    } finally {
      this.loading--;
    }
  }

  // Load the first views before showing anything, without the per-frame limit.
  async prime(dir) {
    this.updateResidency(dir, this.slots);
    while (this.loading > 0) await new Promise((r) => setTimeout(r, 16));
  }

  // Depth of the mesh as seen by one source camera, stored in the same (u, v) as its photo.
  renderDepth(slot, v) {
    const gl = this.gl;
    const p = this.programs.depth;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.depthFbo);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, this.depths, 0, slot);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.viewport(0, 0, DEPTH_SIZE, DEPTH_SIZE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(p.u('uTexToClip'), false, M.TEX_TO_CLIP);
    gl.uniformMatrix4fv(p.u('uViewTex'), false, this.viewTex[v]);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ------------------------------------------------------------------ cards and shadow
  // One textured quad per resident source photo, hovering in the direction it was taken from.
  createCards() {
    const gl = this.gl;
    this.cardVao = gl.createVertexArray();
    gl.bindVertexArray(this.cardVao);
    this.cardBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cardBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.slots * 4 * 24, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const idx = [];
    for (let s = 0; s < this.slots; s++) {
      const b = s * 4;
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.cardIndexCount = idx.length;
  }

  updateCards() {
    const R = this.scene.radius;
    const data = new Float32Array(this.slots * 4 * 6);
    for (let s = 0; s < this.slots; s++) {
      const v = this.slotView[s];
      if (v < 0 || !this.slotReady[s]) continue;  // degenerate quad (all zeros) for empty slots
      const m = this.views[v].matrix;
      const rowU = [m[0], m[1], m[2]];
      const rowV = [m[4], m[5], m[6]];
      const a = vec3.length(rowU);
      const b = vec3.length(rowV);
      const right = vec3.scale(rowU, 1 / a);
      const down = vec3.scale(rowV, 1 / b);
      const centre = vec3.scale(this.views[v].dir, R * 2.15);
      const k = 0.36;
      const corner = (u, vv) => vec3.add(centre, vec3.add(
        vec3.scale(right, ((u - m[3]) / a) * k), vec3.scale(down, ((vv - m[7]) / b) * k)));
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, vv], c) => {
        data.set([...corner(u, vv), u, vv, s], (s * 4 + c) * 6);
      });
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cardBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    this.cardsDirty = false;
  }

  createShadow() {
    const gl = this.gl;
    this.shadowVao = gl.createVertexArray();
    gl.bindVertexArray(this.shadowVao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const [lo, hi] = this.scene.bounds;
    this.shadowCenter = [0, lo[1] - 0.04 * this.scene.radius, 0];
    this.shadowHalf = [(hi[0] - lo[0]) * 0.62, (hi[2] - lo[2]) * 0.62 + 0.25 * this.scene.radius];
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      return true;
    }
    return false;
  }

  // Relative weight of every view for the current viewing direction, using the same
  // unstructured-lumigraph rule as the shader but ignoring occlusion and surface orientation.
  viewWeights(camBack, k, sharp = 1) {
    const ang = this.views.map((v, i) => (this.viewOn[i] > 0.5
      ? Math.acos(Math.min(1, Math.max(-1, vec3.dot(camBack, v.dir)))) : Infinity));
    return ulrWeights(ang, k, sharp);
  }

  // Ease the shown weights towards the weights of the current viewing direction. With a `fade`
  // time > 0, switching to another photo becomes a short cross-fade in time instead of a blend in
  // space, so a still image never mixes two photos. Returns true while a fade is in progress.
  updateWeights(camBack, settings, dt) {
    const target = this.viewWeights(camBack, settings.blendCount + 1, settings.blendSharpness ?? 1);
    const fade = settings.fade ?? 0;
    if (!this.shownW || !(fade > 0) || !(dt > 0)) {
      this.shownW = Float32Array.from(target);
      return false;
    }
    const a = 1 - Math.exp(-dt / fade);
    let moving = false;
    for (let i = 0; i < this.n; i++) {
      const d = target[i] - this.shownW[i];
      if (Math.abs(d) > 1e-3) moving = true;
      this.shownW[i] = Math.abs(d) > 1e-3 ? this.shownW[i] + d * a : target[i];
    }
    return moving;
  }

  // ------------------------------------------------------------------ frame
  draw(camera, settings) {
    const gl = this.gl;
    const { right, up, back } = camera.basis();
    const eye = camera.eye();
    const aspect = this.canvas.width / this.canvas.height;
    const R = this.scene.radius;
    const fov = 30 * Math.PI / 180;
    const near = Math.max(0.01, camera.distance - R * 4);
    const far = camera.distance + R * 4;
    const proj = settings.ortho
      ? M.orthographic(camera.distance * Math.tan(fov / 2) * aspect, camera.distance * Math.tan(fov / 2), near, far)
      : M.perspective(fov, aspect, Math.max(0.01, camera.distance * 0.05), far);
    const shift = M.identity();
    shift[12] = settings.shiftX || 0;  // NDC offset, applied after projection (keeps perspective)
    shift[13] = settings.shiftY || 0;
    const viewProj = M.multiply(M.multiply(shift, proj), M.lookBasis(eye, right, up, back));

    if (this.mipsDirty) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.images);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      this.mipsDirty = false;
    }
    if (!this.shownW) this.updateWeights(back, settings, 0);
    const weights = this.shownW;
    for (let s = 0; s < this.slots; s++) {
      const v = this.slotView[s];
      const on = v >= 0 && this.slotReady[s] && this.viewOn[v] > 0.5;
      this.slotOn[s] = on ? 1 : 0;
      this.slotW[s] = on ? weights[v] : 0;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (settings.shadow) {
      const p = this.programs.shadow;
      gl.useProgram(p.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.uniformMatrix4fv(p.u('uViewProj'), false, viewProj);
      gl.uniform3fv(p.u('uCenter'), this.shadowCenter);
      gl.uniform2fv(p.u('uHalf'), this.shadowHalf);
      gl.uniform1f(p.u('uStrength'), 0.5);
      gl.bindVertexArray(this.shadowVao);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }

    const p = this.programs.mesh;
    gl.useProgram(p.program);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.uniformMatrix4fv(p.u('uViewProj'), false, viewProj);
    gl.uniformMatrix4fv(p.u('uViewTex'), false, this.slotTex);
    gl.uniform3fv(p.u('uViewDir'), this.slotDir);
    gl.uniform3fv(p.u('uViewColor'), this.slotColor);
    gl.uniform1fv(p.u('uViewOn'), this.slotOn);
    gl.uniform1fv(p.u('uGlobalW'), this.slotW);
    gl.uniform1i(p.u('uViewCount'), this.slots);
    gl.uniform3fv(p.u('uEye'), eye);
    gl.uniform3fv(p.u('uCamBack'), back);
    gl.uniform1i(p.u('uOrtho'), settings.ortho ? 1 : 0);
    gl.uniform1i(p.u('uMode'), MODES[settings.mode]);
    gl.uniform1i(p.u('uK'), settings.blendCount + 1);
    gl.uniform1f(p.u('uSharp'), settings.blendSharpness ?? 1);
    gl.uniform1f(p.u('uBias'), 0.004);
    gl.uniform1f(p.u('uDepthTexel'), 1 / DEPTH_SIZE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.images);
    gl.uniform1i(p.u('uImages'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.depths);
    gl.uniform1i(p.u('uDepths'), 1);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0);

    if (settings.cards) {
      if (this.cardsDirty) this.updateCards();
      const cardW = this.viewWeights(back, 4);
      let maxW = 0;
      for (let s = 0; s < this.slots; s++) if (this.slotView[s] >= 0) maxW = Math.max(maxW, cardW[this.slotView[s]]);
      for (let s = 0; s < this.slots; s++) {
        const v = this.slotView[s];
        if (v < 0) continue;
        // fade the card that sits between the eye and the object
        const inFront = vec3.dot(back, this.views[v].dir);
        this.cardFade[s] = 1 - Math.min(1, Math.max(0, (inFront - 0.8) / 0.15));
        this.highlight[s] = maxW > 0 ? (cardW[v] / maxW) ** 2 : 0;
      }
      const c = this.programs.card;
      gl.useProgram(c.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniformMatrix4fv(c.u('uViewProj'), false, viewProj);
      gl.uniform1fv(c.u('uHighlight'), this.highlight);
      gl.uniform1fv(c.u('uFade'), this.cardFade);
      gl.uniform1fv(c.u('uViewOn'), this.slotOn);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.images);
      gl.uniform1i(c.u('uImages'), 0);
      gl.bindVertexArray(this.cardVao);
      gl.drawElements(gl.TRIANGLES, this.cardIndexCount, gl.UNSIGNED_SHORT, 0);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
    this.dirty = false;
  }
}
