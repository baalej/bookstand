import { describe, expect, it } from 'vitest';
import {
  constrainCorner,
  cornerPath,
  curlRadius,
  defaultCurl,
  foldFor,
  progressFor,
  restCorner,
  spineCorner,
  turnedCorner,
} from '../src/geom/fold.js';
import { dist, dot, len, sub } from '../src/geom/vec.js';
import type { FlipCorner } from '../src/types.js';

const m = { width: 400, height: 600 };
const corners: FlipCorner[] = ['top', 'bottom'];

describe('corner constraint', () => {
  it('leaves reachable points alone', () => {
    const p = { x: 300, y: 100 };
    expect(constrainCorner(m, 'top', p)).toEqual(p);
  });

  it('never lets the corner leave its tether', () => {
    // The paper between spine corner and page corner does not stretch, so the
    // corner is confined to a disc of radius = page width.
    for (const corner of corners) {
      const spine = spineCorner(m, corner);
      for (const p of [
        { x: 2000, y: 0 },
        { x: -2000, y: -2000 },
        { x: 0, y: 5000 },
        { x: -900, y: 300 },
      ]) {
        const c = constrainCorner(m, corner, p);
        expect(dist(spine, c)).toBeLessThanOrEqual(m.width + 1e-9);
      }
    }
  });

  it('never lets the crease lift the spine edge', () => {
    // The page is glued along the whole spine, so the fold line must leave
    // both ends of that edge unlifted. Enforcing only the near tether let the
    // bottom of the sheet swing across the centre when the corner was pulled
    // up and outward — it read as a loose leaf, not a bound page.
    for (const corner of corners) {
      for (const pointer of [
        { x: -260, y: -220 }, // up and across: the reported case
        { x: -300, y: -600 },
        { x: -150, y: 900 },
        { x: 120, y: -500 },
        { x: -319, y: 0 },
      ]) {
        const fold = foldFor(m, corner, pointer);
        for (const spineEnd of [
          { x: 0, y: 0 },
          { x: 0, y: m.height },
        ]) {
          const lift = dot(sub(spineEnd, fold.origin), fold.normal);
          expect(
            lift,
            `${corner} corner at ${pointer.x},${pointer.y} lifts the spine at y=${spineEnd.y}`,
          ).toBeLessThanOrEqual(1e-6);
        }
      }
    }
  });

  it('still allows a complete turn', () => {
    // The second tether must not cost us the end of the flip.
    for (const corner of corners) {
      const fold = foldFor(m, corner, turnedCorner(m, corner));
      expect(fold.progress).toBeCloseTo(1, 6);
    }
  });

  it('keeps the rest corner exactly on the tether', () => {
    for (const corner of corners) {
      expect(dist(spineCorner(m, corner), restCorner(m, corner))).toBeCloseTo(m.width, 10);
    }
  });

  it('is stable at the singular point (pointer on the spine corner)', () => {
    for (const corner of corners) {
      const spine = spineCorner(m, corner);
      const c = constrainCorner(m, corner, spine);
      expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
    }
  });
});

describe('progress', () => {
  it('runs 0 at rest to 1 fully turned', () => {
    for (const corner of corners) {
      expect(progressFor(m, restCorner(m, corner))).toBeCloseTo(0, 10);
      expect(progressFor(m, turnedCorner(m, corner))).toBeCloseTo(1, 10);
      expect(progressFor(m, { x: 0, y: 0 })).toBeCloseTo(0.5, 10);
    }
  });

  it('clamps outside the sweep', () => {
    expect(progressFor(m, { x: 9999, y: 0 })).toBe(0);
    expect(progressFor(m, { x: -9999, y: 0 })).toBe(1);
  });
});

describe('fold line', () => {
  it('bisects rest → corner', () => {
    for (const corner of corners) {
      const rest = restCorner(m, corner);
      for (const p of [
        { x: 200, y: 200 },
        { x: 0, y: 500 },
        { x: -150, y: 50 },
      ]) {
        const fold = foldFor(m, corner, p);
        // Equidistant from both endpoints — that is what a crease is.
        expect(dist(fold.origin, rest)).toBeCloseTo(dist(fold.origin, fold.corner), 8);
        // And perpendicular to the travel.
        const along = sub(fold.corner, rest);
        const perp = { x: -fold.normal.y, y: fold.normal.x };
        expect(Math.abs(dot(along, perp))).toBeLessThan(1e-6);
      }
    }
  });

  it('points its normal into the part that lifts', () => {
    // dot(p - origin, normal) > 0 must mean "this point has left the surface",
    // because that dot product is the arc length handed to the curl.
    for (const corner of corners) {
      const rest = restCorner(m, corner);
      const fold = foldFor(m, corner, { x: 100, y: 300 });
      expect(dot(sub(rest, fold.origin), fold.normal)).toBeGreaterThan(0);
      expect(dot(sub(spineCorner(m, corner), fold.origin), fold.normal)).toBeLessThan(0);
    }
  });

  it('produces a unit normal wherever there is travel', () => {
    const fold = foldFor(m, 'top', { x: -100, y: 200 });
    expect(len(fold.normal)).toBeCloseTo(1, 10);
  });

  it('degrades gracefully at zero travel', () => {
    const fold = foldFor(m, 'top', restCorner(m, 'top'));
    expect(fold.progress).toBe(0);
    expect(Number.isFinite(fold.normal.x) && Number.isFinite(fold.normal.y)).toBe(true);
  });
});

describe('curl radius', () => {
  // Early progress, so the relax taper is inactive and the size term is bare.
  const early = 0.2;

  it('follows the size of the fold while the page is still lifting', () => {
    // Below the stiffness ceiling, so this exercises the size term rather
    // than the clamp. On this page the ceiling bites above ~150px of travel.
    const travel = 100;
    expect(travel / (2 * Math.PI)).toBeLessThan(m.width * defaultCurl.maxRadius);
    expect(curlRadius(m, travel, early, defaultCurl)).toBeCloseTo(travel / (2 * Math.PI), 8);
  });

  it('lets a small fold roll tightly enough to be seen', () => {
    // A progress-driven radius put 104px under a 40px flap at peek, bowing
    // the page by 7px on a 464px height. The tip must reach a half turn.
    const peekTravel = m.width * 0.15;
    const r = curlRadius(m, peekTravel, 0.05, defaultCurl);
    expect(peekTravel / 2 / r).toBeGreaterThanOrEqual(Math.PI - 1e-6);
  });

  it('keeps the tip at a half turn across the lifting range', () => {
    for (const travel of [60, 150, 300, 500]) {
      const r = curlRadius(m, travel, early, defaultCurl);
      expect(travel / 2 / r).toBeGreaterThanOrEqual(Math.PI - 1e-6);
    }
  });

  it('clamps to the paper stiffness bounds', () => {
    expect(curlRadius(m, 0, early, defaultCurl)).toBeCloseTo(m.width * defaultCurl.minRadius, 8);
    expect(curlRadius(m, 1e6, early, defaultCurl)).toBeCloseTo(m.width * defaultCurl.maxRadius, 8);
    expect(curlRadius(m, -5, early, defaultCurl)).toBeCloseTo(m.width * defaultCurl.minRadius, 8);
  });

  it('scales the bounds with the book', () => {
    const big = curlRadius({ width: 800, height: 1200 }, 1e6, early, defaultCurl);
    const small = curlRadius(m, 1e6, early, defaultCurl);
    expect(big).toBeCloseTo(small * 2, 8);
  });

  it('relaxes to zero so a fully turned page can lie flat', () => {
    // A roll eats πR of page length. Left at its ceiling, a page at 100%
    // reached x = −140 instead of −319 and sat bunched under a 114px hump
    // until the flip cleared and the flat spread snapped in.
    expect(curlRadius(m, 600, 1, defaultCurl)).toBeCloseTo(0, 8);
  });

  it('relaxes monotonically once past the relax point', () => {
    let previous = Infinity;
    for (let t = defaultCurl.relaxFrom; t <= 1.0001; t += 0.05) {
      const r = curlRadius(m, 600, t, defaultCurl);
      expect(r).toBeLessThanOrEqual(previous + 1e-9);
      previous = r;
    }
  });

  it('leaves the roll alone before the relax point', () => {
    const at = (t: number): number => curlRadius(m, 600, t, defaultCurl);
    expect(at(0.1)).toBeCloseTo(at(defaultCurl.relaxFrom), 8);
  });

  it('is what foldFor hands the renderer', () => {
    const fold = foldFor(m, 'top', { x: 100, y: 200 });
    const travel = dist(restCorner(m, 'top'), fold.corner);
    expect(fold.radius).toBeCloseTo(curlRadius(m, travel, fold.progress, defaultCurl), 8);
  });
});

describe('a fully turned page lands flat', () => {
  // The projected reach of the sheet's free edge: the roll consumes πR, so
  // the flat return only extends `u − πR` past the crease.
  const freeEdgeX = (pointer: { x: number; y: number }): number => {
    const fold = foldFor(m, 'top', pointer);
    const u = m.width - (fold.origin.x - 0); // straight-left drag: normal is +x
    const roll = Math.PI * fold.radius;
    return fold.origin.x - Math.max(0, u - roll);
  };

  it('reaches the mirrored position at full progress', () => {
    const x = freeEdgeX({ x: -m.width, y: 0 });
    expect(x).toBeCloseTo(-m.width, 0);
  });

  it('is short only by the roll it is still carrying', () => {
    const fold = foldFor(m, 'top', { x: 0, y: 0 }); // halfway
    expect(fold.radius).toBeGreaterThan(0);
  });
});

describe('corner path', () => {
  it('hits both endpoints exactly', () => {
    const from = { x: 380, y: 20 };
    const to = turnedCorner(m, 'top');
    const path = cornerPath(m, 'top', from, to);
    expect(path(0)).toEqual(from);
    expect(path(1).x).toBeCloseTo(to.x, 10);
    expect(path(1).y).toBeCloseTo(to.y, 10);
  });

  it('bows toward the page interior', () => {
    // A straight line would sit at the chord midpoint; a swept corner does not.
    const from = restCorner(m, 'top');
    const path = cornerPath(m, 'top', from, turnedCorner(m, 'top'));
    expect(path(0.5).y).toBeGreaterThan(0); // downward from a top corner
    const bottom = cornerPath(m, 'bottom', restCorner(m, 'bottom'), turnedCorner(m, 'bottom'));
    expect(bottom(0.5).y).toBeLessThan(m.height); // upward from a bottom corner
  });

  it('bows less the shorter the remaining travel', () => {
    // So a release at 90% does not suddenly arc as if it started from rest.
    const near = cornerPath(m, 'top', { x: -350, y: 5 }, turnedCorner(m, 'top'));
    const far = cornerPath(m, 'top', restCorner(m, 'top'), turnedCorner(m, 'top'));
    expect(Math.abs(near(0.5).y)).toBeLessThan(Math.abs(far(0.5).y));
  });

  it('clamps t', () => {
    const path = cornerPath(m, 'top', restCorner(m, 'top'), turnedCorner(m, 'top'));
    expect(path(-1)).toEqual(path(0));
    expect(path(2).x).toBeCloseTo(path(1).x, 10);
  });

  it('moves monotonically toward the spine', () => {
    const path = cornerPath(m, 'top', restCorner(m, 'top'), turnedCorner(m, 'top'));
    let previous = Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const x = path(t).x;
      expect(x).toBeLessThan(previous);
      previous = x;
    }
  });
});
