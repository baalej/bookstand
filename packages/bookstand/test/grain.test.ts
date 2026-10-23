import { describe, expect, it } from 'vitest';
import { GRAIN_SIZE, grainPixels } from '../src/render/grain.js';

describe('paper grain', () => {
  it('is a power of two, or WebGL 1 refuses both REPEAT and mipmaps', () => {
    expect(GRAIN_SIZE & (GRAIN_SIZE - 1)).toBe(0);
  });

  it('is the same paper on every load', () => {
    // Generated, not shipped: two books on one page, or one book on two
    // visits, must not disagree about what their paper looks like.
    expect(grainPixels(64)).toEqual(grainPixels(64));
  });

  it('tiles without a seam', () => {
    // The tile repeats several times across a page. A seam there is a grid of
    // lines over every page, so the wrap must be no rougher than the interior.
    const size = 128;
    const px = grainPixels(size);
    const step = (a: number, b: number): number => Math.abs(px[a]! - px[b]!);
    let interior = 0;
    let wrap = 0;
    for (let y = 0; y < size; y++) {
      interior += step(y * size + size / 2 - 1, y * size + size / 2);
      wrap += step(y * size + size - 1, y * size);
    }
    expect(wrap).toBeLessThan(interior * 1.5);
  });

  it('darkens lightly on average, so a white page stays white', () => {
    const px = grainPixels(128);
    const mean = px.reduce((sum, v) => sum + v, 0) / px.length / 255;
    expect(mean).toBeGreaterThan(0.05);
    expect(mean).toBeLessThan(0.5);
  });
});
