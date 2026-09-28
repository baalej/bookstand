import { describe, expect, it } from 'vitest';
import { computeLayout, defaultLayout, type LayoutOptions } from '../src/layout.js';
import { defaultRender } from '../src/render/webgl-renderer.js';

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

describe('perspective headroom', () => {
  it('leaves room for a tilted sheet to grow without clipping', () => {
    // The bug this guards: a rigid cover mid-flip is magnified by the
    // perspective divide and renders outside the footprint, clipping at the
    // canvas edge.
    const h = defaultRender.maxMagnification;
    const l = computeLayout(1400, 800, opts({ headroom: h, padding: 0 }));
    expect(l.bookHeight * h).toBeLessThanOrEqual(800 + 1e-6);
    expect(l.bookWidth * h).toBeLessThanOrEqual(1400 + 1e-6);
  });

  it('stays in step with the renderer default', () => {
    // If someone changes one of these without the other, the sheet clips.
    expect(defaultLayout.headroom).toBe(defaultRender.maxMagnification);
  });

  it('reclaims the space when headroom is 1', () => {
    const withRoom = computeLayout(1400, 800, opts({ headroom: 1.08 }));
    const without = computeLayout(1400, 800, opts({ headroom: 1 }));
    expect(without.bookHeight).toBeGreaterThan(withRoom.bookHeight);
  });

  it('treats headroom below 1 as none', () => {
    const l = computeLayout(1400, 800, opts({ headroom: 0.5 }));
    expect(l.bookWidth).toBeLessThanOrEqual(1400);
  });
});
