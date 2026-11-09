// Orbit camera using the same angle convention as the reconstruction: the eye sits in direction
// (sin yaw cos pitch, sin pitch, cos yaw cos pitch) from the target, and roll turns the image axes.
import { vec3 } from './mat4.js';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function cameraBasis(yaw, pitch, roll) {
  const back = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const right0 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up0 = vec3.cross(back, right0);
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const right = vec3.add(vec3.scale(right0, c), vec3.scale(up0, s));
  const up = vec3.add(vec3.scale(right0, -s), vec3.scale(up0, c));
  return { right, up, back };
}

export class OrbitCamera {
  constructor(element, { distance = 4, minDistance = 0.5, maxDistance = 30 } = {}) {
    this.el = element;
    this.home = { yaw: 20 * DEG, pitch: 15 * DEG, roll: 0, distance, target: [0, 0, 0] };
    Object.assign(this, structuredClone(this.home));
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    this.velocity = { yaw: 0, pitch: 0 };
    this.anim = null;
    this.autoRotate = false;
    this.idleTime = 0;
    this.onInteract = null;
    this.pointers = new Map();
    this.bind();
  }

  bind() {
    const el = this.el;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
      this.velocity = { yaw: 0, pitch: 0 };
      this.interact();
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (this.pointers.size === 1) {
        if (p.button === 2 || p.button === 1 || p.shift) this.pan(dx, dy);
        else this.rotate(dx, dy);
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX;
        p.y = e.clientY;
        const after = Math.hypot(a.x - b.x, a.y - b.y);
        if (before > 0 && after > 0) this.zoom(before / after);
        this.pan(dx / 2, dy / 2);
        this.interact();
        return;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      this.interact();
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
      this.interact();
    }, { passive: false });
    el.addEventListener('dblclick', () => this.flyTo(this.home));
  }

  interact() {
    this.anim = null;
    this.idleTime = 0;
    if (this.onInteract) this.onInteract();
  }

  rotate(dx, dy) {
    const k = 0.0062;
    this.velocity = { yaw: -dx * k, pitch: dy * k };
    this.yaw = wrap(this.yaw - dx * k);
    this.pitch = clamp(this.pitch + dy * k, -89.9 * DEG, 89.9 * DEG);
  }

  pan(dx, dy) {
    const { right, up } = cameraBasis(this.yaw, this.pitch, this.roll);
    const k = this.distance * 0.0014;
    this.target = vec3.add(this.target, vec3.add(vec3.scale(right, -dx * k), vec3.scale(up, dy * k)));
  }

  zoom(factor) {
    this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
  }

  // Smoothly move to a pose; angles take the short way round.
  flyTo(pose, duration = 0.9) {
    const from = { yaw: this.yaw, pitch: this.pitch, roll: this.roll, distance: this.distance, target: [...this.target] };
    const to = { ...from, ...structuredClone(pose) };
    to.yaw = from.yaw + wrap(to.yaw - from.yaw);
    this.anim = { from, to, t: 0, duration };
    this.velocity = { yaw: 0, pitch: 0 };
    this.idleTime = 0;
  }

  update(dt) {
    this.idleTime += dt;
    if (this.anim) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt / a.duration);
      const e = a.t < 0.5 ? 4 * a.t ** 3 : 1 - (-2 * a.t + 2) ** 3 / 2;
      const lerp = (x, y) => x + (y - x) * e;
      this.yaw = lerp(a.from.yaw, a.to.yaw);
      this.pitch = lerp(a.from.pitch, a.to.pitch);
      this.roll = lerp(a.from.roll, a.to.roll);
      this.distance = lerp(a.from.distance, a.to.distance);
      this.target = a.from.target.map((x, i) => lerp(x, a.to.target[i]));
      if (a.t >= 1) this.anim = null;
      return;
    }
    if (this.pointers.size === 0) {
      // inertia after a drag, and roll drifting back to level once the user takes over
      const decay = Math.exp(-dt * 6);
      this.yaw = wrap(this.yaw + this.velocity.yaw * decay * dt * 60 * 0.15);
      this.pitch = clamp(this.pitch + this.velocity.pitch * decay * dt * 60 * 0.15, -89.9 * DEG, 89.9 * DEG);
      this.velocity.yaw *= decay;
      this.velocity.pitch *= decay;
      if (this.autoRotate && this.idleTime > 1.5) this.yaw = wrap(this.yaw + dt * 0.35);
    }
    if (this.idleTime < 0.05 && this.roll !== 0) this.roll *= 0.85;
  }

  basis() {
    return cameraBasis(this.yaw, this.pitch, this.roll);
  }

  eye() {
    const { back } = this.basis();
    return vec3.add(this.target, vec3.scale(back, this.distance));
  }
}

export { DEG };
