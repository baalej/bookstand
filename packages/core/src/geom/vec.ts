import type { Point } from '../types.js';

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const len = (a: Point): number => Math.hypot(a.x, a.y);
export const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
export const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function normalize(a: Point): Point {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/**
 * Constrain a point to a disc.
 *
 * StPageFlip's equivalent (`Helper.LimitPointToCircle`) solves this with an
 * expanded quadratic plus a sign correction and a divide-by-zero guard. Scaling
 * the offset vector is the same answer with none of the edge cases.
 */
export function limitToCircle(center: Point, radius: number, p: Point): Point {
  const d = sub(p, center);
  const l = len(d);
  if (l <= radius || l === 0) return p;
  return add(center, scale(d, radius / l));
}

/** Quadratic Bézier. */
export function quadAt(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const d = t * t;
  return {
    x: a * p0.x + b * c.x + d * p1.x,
    y: a * p0.y + b * c.y + d * p1.y,
  };
}
