import { describe, expect, it } from 'vitest';
import { computeLayout, defaultLayout, type LayoutOptions } from '../src/layout.js';
import { defaultRender } from '../src/render/webgl-renderer.js';
import { foldSweep } from '../src/geom/fold.js';

const aspect = 624 / 907; // the example scans
const opts = (over: Partial<LayoutOptions> = {}): LayoutOptions => ({
  ...defaultLayout,
  aspect,
  ...over,
});

const sizes: Array<[number, number]> = [
  [1400, 800],
  [600, 1200],
  [320, 480],
  [2400, 700],
  [900, 900],
];

describe('footprint', () => {
  it('is always two pages wide', () => {
    for (const [w, h] of sizes) {
      const l = computeLayout(w, h, opts());
      expect(l.bookWidth).toBeCloseTo(l.pageWidth * 2, 6);
    }
  });

  it('keeps the page aspect exactly', () => {
    for (const [w, h] of sizes) {
      const l = computeLayout(w, h, opts());
      expect(l.pageWidth / l.pageHeight).toBeCloseTo(aspect, 6);
    }
  });

  it('fits inside the container in every orientation', () => {
    for (const [w, h] of sizes) {
      const l = computeLayout(w, h, opts());
      expect(l.bookWidth).toBeLessThanOrEqual(w);
      expect(l.bookHeight).toBeLessThanOrEqual(h);
    }
  });

  it('shrinks the spread on a narrow container rather than splitting it', () => {
    // There is no single-page fallback: a narrow container gets a small
    // spread. A lone page has no spine to turn about.
    const wide = computeLayout(1400, 800, opts());
    const narrow = computeLayout(360, 800, opts());
    expect(narrow.bookWidth).toBeCloseTo(narrow.pageWidth * 2, 6);
    expect(narrow.pageWidth).toBeLessThan(wide.pageWidth);
  });

  it('scales linearly with the container', () => {
    const a = computeLayout(700, 400, opts());
    const b = computeLayout(1400, 800, opts());
    expect(b.pageWidth).toBeCloseTo(a.pageWidth * 2, 6);
  });

  it('never returns a degenerate size for a collapsed container', () => {
    const l = computeLayout(0, 0, opts());
    expect(l.pageWidth).toBeGreaterThan(0);
    expect(l.pageHeight).toBeGreaterThan(0);
  });

  it('is deterministic — no hysteresis, no hidden state', () => {
    const a = computeLayout(820, 640, opts());
    const b = computeLayout(820, 640, opts());
    expect(a).toEqual(b);
  });
});

describe('headroom, per axis', () => {
  // The bug this guards, measured before the fix: the turning sheet was
  // sliced flat along the canvas edge from **75% progress**, peaking at
  // **1.42x** the page height around 90% — on tap-to-flip as well as on a
  // drag, so on every navigation the reader could make.
  //
  // One scalar of 1.08 was applied to both axes, sized for the perspective
  // divide. That is real but small, and at the poses that overflow the curl
  // radius has relaxed to nearly nothing, so the divide contributes about
  // 0.007 of the 1.42. The sweep is the fold's own geometry, and it needs
  // very different room vertically than horizontally.

  it('reserves the sheet\'s whole vertical sweep', () => {
    const y = foldSweep(aspect, defaultRender);
    const l = computeLayout(1400, 800, opts({ headroom: { x: 1, y }, padding: 0 }));
    expect(l.bookHeight * y).toBeLessThanOrEqual(800 + 1e-6);
  });

  it('reserves only the perspective divide horizontally', () => {
    // The sweep is a rotation about the spine, and the spine edge never
    // lifts, so the sheet stays within about a page width either side —
    // 1.009 measured. Reserving the vertical figure here too would shrink
    // the book for nothing, which is the waste that made the side margins
    // conspicuous while the sheet was being cut off top and bottom.
    const x = defaultRender.maxMagnification;
    const l = computeLayout(1400, 800, opts({ headroom: { x, y: 1 }, padding: 0 }));
    expect(l.bookWidth * x).toBeLessThanOrEqual(1400 + 1e-6);
  });

  it('needs far more room vertically than horizontally', () => {
    // The asymmetry is the whole point. If these ever converge, either the
    // fold changed or someone collapsed the pair back into a scalar.
    const y = foldSweep(aspect, defaultRender);
    expect(y).toBeGreaterThan(defaultRender.maxMagnification * 1.2);
  });

  it('derives the sweep from the fold, for any page shape', () => {
    // No closed form is trusted here: the sweep tracks neither the page
    // diagonal nor 1 + aspect, and at wide aspects it comes in under the
    // diagonal because the vertical clamp in constrainCorner binds first.
    // It only has to rise with aspect and stay finite.
    let previous = 0;
    for (const a of [0.25, 0.5, 0.688, 1, 2]) {
      const y = foldSweep(a, defaultRender);
      expect(y).toBeGreaterThanOrEqual(1);
      expect(y).toBeLessThan(4);
      expect(y, `sweep should grow with aspect ${a}`).toBeGreaterThan(previous);
      previous = y;
    }
  });

  it('reclaims the space when headroom is 1', () => {
    const withRoom = computeLayout(1400, 800, opts({ headroom: { x: 1.08, y: 1.42 } }));
    const without = computeLayout(1400, 800, opts({ headroom: { x: 1, y: 1 } }));
    expect(without.bookHeight).toBeGreaterThan(withRoom.bookHeight);
  });

  it('treats headroom below 1 as none', () => {
    const l = computeLayout(1400, 800, opts({ headroom: { x: 0.5, y: 0.5 } }));
    expect(l.bookWidth).toBeLessThanOrEqual(1400);
  });
});
