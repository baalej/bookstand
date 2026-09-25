import type { FlipCorner, Point } from '../types.js';
import { clamp, dist, len, limitToCircle, mid, normalize, quadAt, sub } from './vec.js';

export interface PageMetrics {
  /** Width of a single page (half the spread). */
  width: number;
  height: number;
}

export interface CurlOptions {
  /**
   * Stiffness floor: the tightest the paper will roll, as a fraction of page
   * width. Keeps a barely-lifted corner from rolling to a needle point.
   */
  minRadius: number;
  /**
   * Stiffness ceiling, as a fraction of page width. Past this the flap stops
   * getting rounder and simply lies flat beyond a fixed roll, which is what
   * real paper does once a lot of it is turned.
   */
  maxRadius: number;
  /**
   * Progress at which the roll begins relaxing toward flat. It must reach
   * zero by 1, or a fully turned page cannot reach its mirrored position.
   */
  relaxFrom: number;
}

export const defaultCurl: CurlOptions = {
  // Low on purpose. Raising it to blunt mesh faceting also stops a peek-sized
  // flap from completing its half turn, which is the thing that makes the
  // dog-ear visible. Faceting is the renderer's problem, not the model's.
  minRadius: 0.02,
  maxRadius: 0.18,
  relaxFrom: 0.62,
};

/**
 * The complete description of a page mid-turn.
 *
 * Note what is *absent*: clip polygons. StPageFlip needs two of them
 * (`getFlippingClipArea` / `getBottomClipArea`) because a DOM renderer has to
 * cut a flat rotated rectangle to the book's bounds. A deformed mesh carries
 * its own silhouette, so the fold line and a radius are the whole story. This
 * is the single largest simplification WebGL buys us.
 */
export interface Fold {
  /** Dragged corner, constrained, in page-local coordinates. */
  corner: Point;
  /** A point on the fold line (the midpoint of rest → corner). */
  origin: Point;
  /** Unit normal of the fold line, pointing into the part that turns. */
  normal: Point;
  /** Curl cylinder radius, in page units. */
  radius: number;
  /** 0 = flat and untouched, 1 = fully turned. */
  progress: number;
}

/**
 * Page-local space, used for both directions.
 *
 * Origin at the spine-side top corner; `x` runs 0 (spine) → width (free edge);
 * `y` runs 0 (top) → height (bottom). A backward flip is mirrored into this
 * same space at the boundary, so every function below only handles one case.
 */
export function restCorner(m: PageMetrics, corner: FlipCorner): Point {
  return { x: m.width, y: corner === 'top' ? 0 : m.height };
}

export function spineCorner(m: PageMetrics, corner: FlipCorner): Point {
  return { x: 0, y: corner === 'top' ? 0 : m.height };
}

/**
 * The two anchors that tether a dragged corner, with the radius each allows.
 *
 * A page is glued along its **whole** spine edge, not at a single corner. For
 * the crease never to lift that edge we need `dot(S − origin, normal) ≤ 0` at
 * both of its endpoints; since `origin` is the midpoint of rest→corner and
 * `normal` points along rest−corner, that inequality reduces exactly to
 *
 *     |corner − S| ≤ |rest − S|
 *
 * for each endpoint S. So there are two discs, not one: the corner's own spine
 * corner at radius `width`, and the far one at radius the page diagonal.
 *
 * Enforcing only the near disc lets the crease cross the spine when the corner
 * is pulled up and outward — the bottom of the sheet swings past the centre
 * and the page reads as a loose leaf rather than something bound into a book.
 */
function tethers(m: PageMetrics, corner: FlipCorner): Array<{ centre: Point; radius: number }> {
  const rest = restCorner(m, corner);
  const top = { x: 0, y: 0 };
  const bottom = { x: 0, y: m.height };
  return [
    { centre: top, radius: dist(rest, top) },
    { centre: bottom, radius: dist(rest, bottom) },
  ];
}

/**
 * Hold the dragged corner where a bound page can actually put it.
 *
 * Two kinds of limit, and both are needed:
 *
 * **The tethers**, above — the paper does not stretch.
 *
 * **The book's vertical span.** A page is bound along the spine, so its corner
 * can be lifted and curled but cannot slide up out of the binding. Without
 * this the corner reaches `y < 0`, which lands it on the arc centred on the
 * *far* spine corner — and on that arc the crease passes through the far spine
 * corner itself. Measured: grabbing near the right edge and moving 77px left
 * and 52px up put the crease on the page diagonal at 9% progress, sweeping a
 * page-wide white flap across the centre. Clamping y keeps the crease near the
 * corner, where a small drag belongs.
 *
 * The clamp is not a wall: horizontal movement still tracks perfectly, so the
 * corner slides along the book's edge the way paper held against a board does.
 *
 * The intersection of the discs is convex, so projecting onto each in turn
 * converges; a few passes land well inside a pixel.
 */
export function constrainCorner(m: PageMetrics, corner: FlipCorner, p: Point): Point {
  const anchors = tethers(m, corner);
  let out = { x: p.x, y: clamp(p.y, 0, m.height) };
  for (let pass = 0; pass < 6; pass++) {
    for (const { centre, radius } of anchors) out = limitToCircle(centre, radius, out);
    out = { x: out.x, y: clamp(out.y, 0, m.height) };
  }
  return out;
}

/** 0 at the free edge, 1 once the corner has swung a full page-width past the spine. */
export function progressFor(m: PageMetrics, cornerPos: Point): number {
  return clamp((m.width - cornerPos.x) / (2 * m.width), 0, 1);
}

/** Smooth 0→1 ramp. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Curl radius.
 *
 * Two forces set it, and getting either one alone wrong is visible:
 *
 * **Size of the fold.** Half the corner's travel is the paper now past the
 * crease, so `travel / 2π` is the radius of a half-turn over that distance.
 * That is what makes the fold read at every scale — a barely-lifted corner
 * rolls tightly into a small dog-ear instead of bowing imperceptibly.
 *
 * **Room to land.** A roll consumes `πR` of page length, so a curled page
 * projects `πR` shorter than a flat one. That is correct mid-turn, and fatal
 * at the end: with R at its ceiling a fully turned page reached x = −140
 * instead of −319, sitting bunched up under a 114 px hump until the flip
 * cleared and the flat spread snapped in. The taper drives R to zero as the
 * crease reaches the spine, so the page arrives exactly where the resting
 * spread will draw it and the hand-off is invisible.
 *
 * Both of this library's earlier laws were monotonic — one falling, one
 * rising — and each was wrong at the end it ignored. The real curve is a hump.
 */
export function curlRadius(
  m: PageMetrics,
  travel: number,
  progress: number,
  curl: CurlOptions,
): number {
  const natural = Math.max(0, travel) / (2 * Math.PI);
  const bounded = clamp(natural, m.width * curl.minRadius, m.width * curl.maxRadius);
  // 1 until the page is well past halfway, then down to 0 as it lies flat.
  const relax = smoothstep(1, curl.relaxFrom, clamp(progress, 0, 1));
  return bounded * relax;
}

/**
 * Build the fold for a dragged corner position.
 *
 * The fold line is the perpendicular bisector of (rest corner → current
 * corner): the crease that maps one onto the other. The normal points back
 * toward the rest corner, so `dot(p - origin, normal) > 0` means "this part of
 * the sheet has lifted", and that dot product is the arc length fed to the
 * curl in the vertex shader.
 */
export function foldFor(
  m: PageMetrics,
  corner: FlipCorner,
  pointer: Point,
  curl: CurlOptions = defaultCurl,
): Fold {
  const cornerPos = constrainCorner(m, corner, pointer);
  const rest = restCorner(m, corner);
  const travel = sub(rest, cornerPos);
  const progress = progressFor(m, cornerPos);

  return {
    corner: cornerPos,
    origin: mid(rest, cornerPos),
    // Degenerate at zero travel; the renderer skips the curl when progress is 0.
    normal: normalize(travel),
    radius: curlRadius(m, len(travel), progress, curl),
    progress,
  };
}

/**
 * The corner's destination when a flip completes: a page-width past the spine,
 * settled flat against the opposite half.
 */
export function turnedCorner(m: PageMetrics, corner: FlipCorner): Point {
  return { x: -m.width, y: corner === 'top' ? 0 : m.height };
}

export type CornerPath = (t: number) => Point;

/**
 * A corner path from `from` to `to`, bowed toward the page interior.
 *
 * StPageFlip animates the corner along a straight line, which is why its
 * tap-to-flip reads as a sliding rectangle. Real corners sweep. The bow is
 * scaled by how far the corner still has to travel, so a release at 90% barely
 * arcs while a tap from rest arcs fully — releases pick up from wherever the
 * finger left off with no discontinuity.
 */
export function cornerPath(
  m: PageMetrics,
  corner: FlipCorner,
  from: Point,
  to: Point,
  bowFactor = 0.16,
): CornerPath {
  const span = Math.abs(to.x - from.x) / (2 * m.width);
  const bow = m.height * bowFactor * clamp(span, 0, 1);
  // Bow toward the middle of the page: down from a top corner, up from a bottom one.
  const control = {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2 + (corner === 'top' ? bow : -bow),
  };
  return (t: number) => quadAt(from, control, to, clamp(t, 0, 1));
}
