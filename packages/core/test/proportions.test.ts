import { describe, expect, it } from 'vitest';
import {
  constrainCorner,
  curlRadius,
  defaultCurl,
  foldFor,
  progressFor,
  restCorner,
  turnedCorner,
  type PageMetrics,
} from '../src/geom/fold.js';
import { computeLayout, defaultLayout } from '../src/layout.js';
import { dot, sub } from '../src/geom/vec.js';
import { gesture } from '../src/motion/tokens.js';
import { defaultRender } from '../src/render/webgl-renderer.js';
import type { FlipCorner } from '../src/types.js';

/**
 * Nothing in the fold may assume a page shape.
 *
 * Every constant is a fraction of page width, of the diagonal, or unitless —
 * so these run the same invariants across shapes far outside anything a real
 * book would use. A ratio-dependent constant sneaking in shows up here as a
 * failure at one end of the range rather than as a bug report from whoever
 * ships the first square book.
 */
const SHAPES: Array<{ name: string; aspect: number }> = [
  { name: 'ribbon      (0.25)', aspect: 0.25 },
  { name: 'tall        (0.45)', aspect: 0.45 },
  { name: 'A-series    (0.71)', aspect: 1 / Math.SQRT2 },
  { name: 'our scans   (0.69)', aspect: 624 / 907 },
  { name: 'square      (1.00)', aspect: 1 },
  { name: 'landscape   (1.60)', aspect: 1.6 },
  { name: 'panorama    (3.00)', aspect: 3 },
];

/** A few page sizes per shape, so absolute scale is exercised too. */
const HEIGHTS = [180, 648, 2400];

const pages = (aspect: number): PageMetrics[] =>
  HEIGHTS.map((height) => ({ width: height * aspect, height }));

const corners: FlipCorner[] = ['top', 'bottom'];

/** Pointer positions well outside the page, in fractions of page size. */
const PROBES: Array<[number, number]> = [
  [0.9, 0.05],
  [0.5, 0.5],
  [0.1, 0.9],
  [-0.5, -0.4],
  [-1.2, 0.3],
  [-2, -2],
  [2, 2],
  [0, -1.5],
  [-0.8, 1.6],
  [1.5, -0.2],
];

describe.each(SHAPES)('$name', ({ aspect }) => {
  it('never lets the crease lift either end of the spine', () => {
    for (const m of pages(aspect)) {
      for (const corner of corners) {
        for (const [fx, fy] of PROBES) {
          const fold = foldFor(m, corner, { x: fx * m.width, y: fy * m.height }, defaultCurl);
          for (const end of [
            { x: 0, y: 0 },
            { x: 0, y: m.height },
          ]) {
            const lift = dot(sub(end, fold.origin), fold.normal);
            // Scale-relative tolerance: a 2400px page carries more float error
            // than a 180px one, and an absolute epsilon would fail spuriously.
            expect(lift).toBeLessThanOrEqual(m.width * 1e-9);
          }
        }
      }
    }
  });

  it('keeps the corner inside the page vertically', () => {
    for (const m of pages(aspect)) {
      for (const corner of corners) {
        for (const [fx, fy] of PROBES) {
          const c = constrainCorner(m, corner, { x: fx * m.width, y: fy * m.height });
          expect(c.y).toBeGreaterThanOrEqual(-1e-6);
          expect(c.y).toBeLessThanOrEqual(m.height + 1e-6);
        }
      }
    }
  });

  it('can still be turned all the way', () => {
    for (const m of pages(aspect)) {
      for (const corner of corners) {
        const fold = foldFor(m, corner, turnedCorner(m, corner), defaultCurl);
        expect(fold.progress).toBeCloseTo(1, 6);
        // And it must lie flat at the end, or the sheet cannot meet the spread.
        expect(fold.radius).toBeLessThan(m.width * 1e-6);
      }
    }
  });

  it('gives a peek-sized fold a full half turn', () => {
    for (const m of pages(aspect)) {
      const travel = m.width * gesture.peekDepth;
      const r = curlRadius(m, travel, 0.05, defaultCurl);
      expect(travel / 2 / r).toBeGreaterThanOrEqual(Math.PI - 1e-6);
    }
  });

  it('resolves the tightest roll across enough quads to read as a curve', () => {
    for (const m of pages(aspect)) {
      const roll = Math.PI * m.width * defaultCurl.minRadius;
      // The mesh divides the page, so quad size scales with the page.
      const quad = Math.min(m.width / defaultRender.segments[0], m.height / defaultRender.segments[1]);
      expect(roll / quad).toBeGreaterThanOrEqual(6);
    }
  });

  it('progress runs 0 to 1 monotonically', () => {
    for (const m of pages(aspect)) {
      for (const corner of corners) {
        expect(progressFor(m, restCorner(m, corner))).toBeCloseTo(0, 9);
        expect(progressFor(m, turnedCorner(m, corner))).toBeCloseTo(1, 9);
      }
    }
  });

  it('lays out a spread that fits its container', () => {
    for (const [w, h] of [
      [1400, 800],
      [500, 1200],
      [900, 900],
    ]) {
      const l = computeLayout(w!, h!, { ...defaultLayout, aspect });
      expect(l.bookWidth).toBeLessThanOrEqual(w! + 1e-6);
      expect(l.bookHeight).toBeLessThanOrEqual(h! + 1e-6);
      expect(l.pageWidth / l.pageHeight).toBeCloseTo(aspect, 6);
    }
  });
});

describe('a small drag makes a small fold, whatever the shape', () => {
  // The reported flash: grabbing near the right edge and moving 77px produced
  // a crease along the page diagonal and a page-wide white flap. The fold a
  // drag produces has to stay in proportion to the drag.
  it.each(SHAPES)('$name', ({ aspect }) => {
    for (const m of pages(aspect)) {
      const rest = restCorner(m, 'top');
      const nudge = Math.min(m.width, m.height) * 0.18;

      const nudges: Array<[number, number]> = [
        [-nudge, -nudge], // up and across — the reported gesture
        [-nudge, 0],
        [-nudge, nudge],
        [0, -nudge],
      ];
      for (const [dx, dy] of nudges) {
        const fold = foldFor(m, 'top', { x: rest.x + dx, y: rest.y + dy }, defaultCurl);

        // How much of the sheet has left the surface, sampled over the page.
        let lifted = 0;
        let total = 0;
        for (let i = 0; i <= 20; i++) {
          for (let j = 0; j <= 20; j++) {
            const p = { x: (i / 20) * m.width, y: (j / 20) * m.height };
            total++;
            if (dot(sub(p, fold.origin), fold.normal) > 0) lifted++;
          }
        }
        const share = lifted / total;
        expect(share, `${aspect} aspect, nudge ${dx},${dy} lifted ${(share * 100) | 0}%`).toBeLessThan(
          0.35,
        );
      }
    }
  });
});
