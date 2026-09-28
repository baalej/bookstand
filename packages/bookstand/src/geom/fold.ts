import type { FlipCorner, Point } from '../types.js';
import { clamp, dist, dot, len, limitToCircle, mid, normalize, quadAt, sub } from './vec.js';

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
  // Low. At 0.18 the flap stood 106px off a 446px page — proportionally a
  // corner hovering 4cm above an A4 sheet, which reads as a tube rather than
  // a fold. At 0.06 it stands 54px and reads as paper, and it halves the gap
  // between where the flap is and where it renders.
  maxRadius: 0.06,
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

/**
 * How much room the turning sheet needs beyond the resting page, per axis,
 * as a multiple of page height and page width.
 *
 * The canvas has to reserve this much room or the sheet is sliced flat along
 * the canvas edge for the last quarter of every turn. Measured before it was
 * reserved: clipping began at **75% progress** and peaked at **1.42x** the
 * page height around 90%, on a 0.688 page — visible on tap-to-flip as well as
 * on a drag, so it affected every navigation the reader could make.
 *
 * **This is not the perspective divide.** Phase 2 reserved `maxMagnification`
 * for a sheet tilting toward the viewer and applied it to both axes. That is a
 * real effect but a small one, and at the poses that overflow the radius has
 * relaxed to nearly nothing, so the divide contributes about 0.007 of the
 * 1.42. The overflow is the fold's own geometry: a sheet reflected about a
 * slanted crease presents more vertical extent than the flat page did, the
 * same way a rotated rectangle needs a taller bounding box.
 *
 * Derived rather than tabulated, because it is a property of the fold and
 * would drift the moment the tethers or the radius law changed. It has no
 * closed form worth trusting — it tracks neither the page diagonal nor
 * `1 + aspect`, and at wide aspects it comes in *under* the diagonal because
 * the vertical clamp in `constrainCorner` binds first.
 *
 * Only the page's four corners are sampled. The fold is a piecewise isometry,
 * so the extremes of y land on them; checked against a full interior sweep
 * across seven aspect ratios, the two agree to within 0.004.
 *
 * **Horizontally the binding case is a rigid cover, not the curl.** A soft
 * sheet reaches only 1.007 half-widths, because the sweep is a rotation about
 * the spine and the spine edge never lifts. A cover hinges instead, so it is
 * still nearly full width while already tilted far enough to be magnified —
 * worst at about 14 degrees, reaching 1.033. Reserving `maxMagnification`
 * (1.08) for this was over by 4.6%, and it was the same mistake as the
 * vertical one: treating the renderer's magnification cap as a stand-in for
 * how far the sheet actually goes.
 */
export function foldSweep(
  aspect: number,
  projection: { focal: number; maxMagnification: number },
  curl: CurlOptions = defaultCurl,
): { x: number; y: number } {
  const height = 1;
  const width = Math.max(1e-6, aspect);
  const metrics: PageMetrics = { width, height };
  const focal = width * projection.focal;
  const minW = 1 / Math.max(1, projection.maxMagnification);
  const pageCorners: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ];

  // The resting page is the floor; the fold can only add to it.
  let lowest = 0;
  let highest = height;
  // Half-widths, measured from the spine. The page itself is 1.
  let widest = 1;

  for (const corner of ['top', 'bottom'] as const) {
    for (let i = 0; i <= 40; i++) {
      for (let j = 0; j <= 24; j++) {
        // Reaches past the spine, which is where the sweep peaks.
        const pointer = { x: width * (1 - 2.2 * (i / 40)), y: height * (j / 24) };
        const fold = foldFor(metrics, corner, pointer, curl);

        for (const point of pageCorners) {
          const past = dot(sub(point, fold.origin), fold.normal);
          if (past <= 0) continue; // still lying flat, inside the page
          const radius = Math.max(1e-6, fold.radius);
          const arc = past / radius;
          const onCrease = point.y - fold.normal.y * past;
          const along = arc < Math.PI ? radius * Math.sin(arc) : -(past - Math.PI * radius);
          const z = arc < Math.PI ? radius * (1 - Math.cos(arc)) : 2 * radius;
          const y = onCrease + fold.normal.y * along;

          // The same clamped divide the vertex shader applies, about the
          // page's vertical middle — so this measures where the sheet lands
          // on screen rather than where its material sits.
          const w = Math.max(1 - z / focal, minW);
          const projected = height / 2 + (y - height / 2) / w;
          if (projected < lowest) lowest = projected;
          if (projected > highest) highest = projected;

          const onCreaseX = point.x - fold.normal.x * past;
          const across = Math.abs((onCreaseX + fold.normal.x * along) / w) / width;
          if (across > widest) widest = across;
        }
      }
    }
  }

  // A rigid cover hinges about the spine rather than curling, which keeps it
  // near full width while it tilts into the magnifying part of the divide.
  // Swept directly: it is one angle, not a fold, so there is nothing to
  // sample over but the hinge itself.
  for (let i = 0; i <= 180; i++) {
    const angle = (Math.PI * i) / 180;
    const z = width * Math.sin(angle);
    const w = Math.max(1 - z / focal, minW);
    const across = Math.abs((width * Math.cos(angle)) / w) / width;
    if (across > widest) widest = across;
  }

  // Symmetric about the page's middle: the book is centred, so the binding
  // constraint is whichever side reaches further.
  const half = Math.max(highest - height / 2, height / 2 - lowest);
  return { x: widest, y: (2 * half) / height };
}
