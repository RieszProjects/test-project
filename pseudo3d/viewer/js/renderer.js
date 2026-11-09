// WebGL2 renderer: per-view depth maps (computed once), then view-dependent projective texturing.
import { createProgram } from './glutil.js';
import * as M from './mat4.js';
import { vec3 } from './mat4.js';
import { ulrWeights } from './ulr.js';
import {
  MAX_VIEWS, depthVS, depthFS, meshVS, meshFS, cardVS, cardFS, shadowVS, shadowFS,
} from './shaders.js';

const DEPTH_SIZE = 1024;
export const MODES = { blend: 0, nearest: 1, geometry: 2, weights: 3 };

export function viewPalette(n) {
  return Array.from({ length: n }, (_, i) => {
    const h = (i / n) * 360;
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
    this.views = scene.views.slice(0, MAX_VIEWS);
    this.n = this.views.length;
    this.palette = viewPalette(this.n);
    this.viewOn = new Float32Array(MAX_VIEWS).fill(1);
    this.highlight = new Float32Array(MAX_VIEWS);
    this.cardFade = new Float32Array(MAX_VIEWS);

    this.programs = {
      depth: createProgram(gl, depthVS, depthFS),
      mesh: createProgram(gl, meshVS, meshFS),
      card: createProgram(gl, cardVS, cardFS),
      shadow: createProgram(gl, shadowVS, shadowFS),
    };
    this.viewTex = this.views.map((v) => M.fromRows3x4(v.matrix));
    this.viewTexFlat = new Float32Array(16 * MAX_VIEWS);
    this.viewTex.forEach((m, i) => this.viewTexFlat.set(m, i * 16));
    this.viewDirFlat = new Float32Array(3 * MAX_VIEWS);
    this.views.forEach((v, i) => this.viewDirFlat.set(v.dir, i * 3));
    this.paletteFlat = new Float32Array(3 * MAX_VIEWS);
    this.palette.forEach((c, i) => this.paletteFlat.set(c, i * 3));

    this.createMesh(scene.meshData);
    this.createImageArray();
    this.createDepthArray();
    this.createCards();
    this.createShadow();
    this.renderDepthMaps();
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
    const levels = Math.floor(Math.log2(size)) + 1;
    this.images = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.images);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, size, size, this.n);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this.views.forEach((v, i) => {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, v.image);
    });
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
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
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT32F, DEPTH_SIZE, DEPTH_SIZE, this.n);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.depthFbo = gl.createFramebuffer();
  }

  // Depth of the mesh as seen by every source camera, stored in the same (u, v) as its photo.
  renderDepthMaps() {
    const gl = this.gl;
    const p = this.programs.depth;
    gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.depthFbo);
    gl.viewport(0, 0, DEPTH_SIZE, DEPTH_SIZE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.uniformMatrix4fv(p.u('uTexToClip'), false, M.TEX_TO_CLIP);
    gl.bindVertexArray(this.vao);
    for (let i = 0; i < this.n; i++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, this.depths, 0, i);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      gl.clearDepth(1);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(p.u('uViewTex'), false, this.viewTex[i]);
      gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0);
    }
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // One textured quad per source photo, hovering in the direction it was taken from.
  createCards() {
    const gl = this.gl;
    const R = this.scene.radius;
    const data = [];
    const idx = [];
    this.views.forEach((v, i) => {
      const m = v.matrix;
      const rowU = [m[0], m[1], m[2]];
      const rowV = [m[4], m[5], m[6]];
      const a = vec3.length(rowU);
      const b = vec3.length(rowV);
      const right = vec3.scale(rowU, 1 / a);
      const down = vec3.scale(rowV, 1 / b);
      const u0 = m[3];
      const v0 = m[7];
      const centre = vec3.scale(v.dir, R * 2.15);
      const k = 0.36;
      const corner = (u, vv) => vec3.add(centre, vec3.add(
        vec3.scale(right, ((u - u0) / a) * k), vec3.scale(down, ((vv - v0) / b) * k)));
      const base = i * 4;
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, vv]) => data.push(...corner(u, vv), u, vv, i));
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    });
    this.cardVao = gl.createVertexArray();
    gl.bindVertexArray(this.cardVao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.cardIndexCount = idx.length;
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

  // Relative weight of every photo for the current viewing direction, using the same
  // unstructured-lumigraph rule as the shader but ignoring occlusion and surface orientation.
  viewWeights(camBack, k) {
    const ang = this.views.map((v, i) => (this.viewOn[i] > 0.5
      ? Math.acos(Math.min(1, Math.max(-1, vec3.dot(camBack, v.dir)))) : Infinity));
    return ulrWeights(ang, k);
  }

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
    gl.uniformMatrix4fv(p.u('uViewTex'), false, this.viewTexFlat);
    gl.uniform3fv(p.u('uViewDir'), this.viewDirFlat);
    gl.uniform3fv(p.u('uViewColor'), this.paletteFlat);
    gl.uniform1fv(p.u('uViewOn'), this.viewOn);
    gl.uniform1i(p.u('uViewCount'), this.n);
    gl.uniform3fv(p.u('uEye'), eye);
    gl.uniform3fv(p.u('uCamBack'), back);
    gl.uniform1i(p.u('uOrtho'), settings.ortho ? 1 : 0);
    gl.uniform1i(p.u('uMode'), MODES[settings.mode]);
    gl.uniform1i(p.u('uK'), settings.blendCount + 1);
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
      const weights = this.viewWeights(back, 4);
      const maxW = Math.max(...weights);
      this.views.forEach((v, i) => {
        // fade the card that sits between the eye and the object
        const inFront = vec3.dot(back, v.dir);
        this.cardFade[i] = 1 - Math.min(1, Math.max(0, (inFront - 0.8) / 0.15));
        this.highlight[i] = (weights[i] / maxW) ** 2;
      });
      const c = this.programs.card;
      gl.useProgram(c.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniformMatrix4fv(c.u('uViewProj'), false, viewProj);
      gl.uniform1fv(c.u('uHighlight'), this.highlight);
      gl.uniform1fv(c.u('uFade'), this.cardFade);
      gl.uniform1fv(c.u('uViewOn'), this.viewOn);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.images);
      gl.uniform1i(c.u('uImages'), 0);
      gl.bindVertexArray(this.cardVao);
      gl.drawElements(gl.TRIANGLES, this.cardIndexCount, gl.UNSIGNED_SHORT, 0);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
  }
}
