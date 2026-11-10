import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { cameraBasis } from '../site/pseudo3d/js/orbit.js';
import { fromRows3x4, multiply, vec3 } from '../site/pseudo3d/js/mat4.js';
import { ulrWeights } from '../site/pseudo3d/js/ulr.js';

const D = Math.PI / 180;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const closeVec = (a, b, eps = 1e-6) => a.forEach((x, i) => close(x, b[i], eps));

test('camera basis: reference view looks along -Z with +X to the right', () => {
  const { right, up, back } = cameraBasis(0, 0, 0);
  closeVec(right, [1, 0, 0]);
  closeVec(up, [0, 1, 0]);
  closeVec(back, [0, 0, 1]);
});

test('camera basis matches the reconstruction pipeline convention', () => {
  // rows of the reconstruction's camera basis for az 214.56, el 23.56, roll -3.94 (degrees)
  const expected = [
    [-0.8371661119, -0.0629841119, 0.543310135],
    [0.1696203215, 0.9144755669, 0.36737363],
    [-0.5199825455, 0.3997091932, -0.7548845695],
  ];
  const { right, up, back } = cameraBasis(214.56 * D, 23.56 * D, -3.94 * D);
  closeVec(right, expected[0], 1e-8);
  closeVec(up, expected[1], 1e-8);
  closeVec(back, expected[2], 1e-8);
});

test('camera basis is right-handed and orthonormal', () => {
  for (const [y, p, r] of [[10, 20, 30], [-120, 75, -10], [200, -89, 5], [0, 90, 0]]) {
    const { right, up, back } = cameraBasis(y * D, p * D, r * D);
    close(vec3.length(right), 1);
    close(vec3.length(up), 1);
    close(vec3.dot(right, up), 0);
    closeVec(vec3.cross(right, up), back);
  }
});

test('row-major 3x4 export matrices become column-major 4x4', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const m = fromRows3x4(rows);
  const p = multiply(m, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1]));
  // the translation column of (M * translate(1,1,1)) is M applied to (1,1,1,1)
  closeVec(Array.from(p.slice(12, 15)), [1 + 2 + 3 + 4, 5 + 6 + 7 + 8, 9 + 10 + 11 + 12]);
});

test('ULR weights: normalised, at most k-1 photos, exact view wins', () => {
  const w = ulrWeights([0.3, 0.1, 0.9, 0.5, Infinity], 3);
  close(w.reduce((a, b) => a + b, 0), 1);
  assert.equal(w.filter((x) => x > 0).length, 2);
  assert.equal(w[4], 0);
  assert.ok(w[1] > w[0]);
  const exact = ulrWeights([0, 0.4, 0.6], 3);
  close(exact[0], 1, 1e-3);
  assert.deepEqual(ulrWeights([Infinity, Infinity], 3), [0, 0]);
  // exact tie with k = 2 still picks a single photo
  const tie = ulrWeights([0.3, 0.3, 0.9], 2);
  close(tie.reduce((a, b) => a + b, 0), 1);
  assert.equal(tie.filter((x) => x > 0).length, 1);
});

test('exported scene: every photo sees the object centre inside its texture', () => {
  const scene = JSON.parse(readFileSync(new URL('../site/pseudo3d/assets/pistol/scene.json', import.meta.url)));
  assert.ok(scene.views.length >= 4);
  for (const v of scene.views) {
    const m = v.matrix;
    const [u, vv, d] = [m[3], m[7], m[11]];
    assert.ok(u > 0 && u < 1 && vv > 0 && vv < 1, `${v.name}: centre maps to (${u}, ${vv})`);
    close(d, 0.5);
    close(vec3.length(v.dir), 1, 1e-4);
  }
  const ref = scene.views.find((v) => v.name === 'ref');
  closeVec(ref.dir, [0, 0, 1], 1e-6);
  assert.equal(scene.mesh.indexCount % 3, 0);
});
