/** Minimal 2D vector on the XZ plane (x, z). Physics stays independent of Three.js. */
export interface Vec2 {
  x: number;
  z: number;
}

export const vec = (x = 0, z = 0): Vec2 => ({ x, z });
export const len = (v: Vec2): number => Math.hypot(v.x, v.z);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;

export function normalize(v: Vec2): Vec2 {
  const l = len(v);
  return l > 1e-9 ? { x: v.x / l, z: v.z / l } : { x: 0, z: 0 };
}

export function clampLen(v: Vec2, max: number): Vec2 {
  const l = len(v);
  return l > max ? { x: (v.x / l) * max, z: (v.z / l) * max } : { x: v.x, z: v.z };
}

export function rotate(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
}
