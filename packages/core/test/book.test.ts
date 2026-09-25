import { describe, expect, it } from 'vitest';
import { buildBook, clampState, resolveStartState, stateAt } from '../src/model/book.js';
import type { BookInput, FaceSlot } from '../src/types.js';

/** Render a state as `"left|right"` using src names, `-` for a reserved half. */
const show = (s: { left: FaceSlot; right: FaceSlot }): string =>
  `${s.left?.image.src ?? '-'}|${s.right?.image.src ?? '-'}`;

const spreads = [
  ['1L', '1R'],
  ['2L', '2R'],
] as const;

describe('sheet model — all four cover combinations', () => {
  // This table is the specification. Everything else in the model follows
  // from padding + pairing, so if these four hold, the model is right.
  const cases: Array<{
    name: string;
    input: BookInput;
    states: string[];
    range: [number, number];
  }> = [
    {
      name: 'front + back cover',
      input: { cover: 'C', spreads, backCover: 'B' },
      states: ['-|C', '1L|1R', '2L|2R', 'B|-'],
      range: [0, 3],
    },
    {
      name: 'front cover only',
      input: { cover: 'C', spreads },
      states: ['-|C', '1L|1R', '2L|2R', '-|-'],
      range: [0, 2],
    },
    {
      name: 'back cover only',
      input: { spreads, backCover: 'B' },
      states: ['-|-', '1L|1R', '2L|2R', 'B|-'],
      range: [1, 3],
    },
    {
      name: 'no covers',
      input: { spreads },
      states: ['-|-', '1L|1R', '2L|2R', '-|-'],
      range: [1, 2],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const book = buildBook(c.input);
      expect(book.states.map(show)).toEqual(c.states);
      expect([book.firstState, book.lastState]).toEqual(c.range);
      // Every reachable state must show something.
      for (let i = book.firstState; i <= book.lastState; i++) {
        const s = book.states[i]!;
        expect(s.left !== null || s.right !== null).toBe(true);
      }
    });
  }
});

describe('sheets', () => {
  it('pairs faces front-to-back', () => {
    const book = buildBook({ cover: 'C', spreads, backCover: 'B' });
    expect(
      book.sheets.map((s) => `${s.front?.image.src ?? '-'}/${s.back?.image.src ?? '-'}`),
    ).toEqual(['C/1L', '1R/2L', '2R/B']);
  });

  it('marks a sheet rigid if either face is a cover', () => {
    const book = buildBook({ cover: 'C', spreads, backCover: 'B' });
    // The front cover's reverse is an interior page, but the leaf is still a board.
    expect(book.sheets.map((s) => s.density)).toEqual(['rigid', 'soft', 'rigid']);
  });

  it('does not infer a cover from position — the StPageFlip bug', () => {
    // Front cover, even interior, no back cover. The last interior page must
    // stay soft; StPageFlip's createSpread() marks it HARD unconditionally.
    const book = buildBook({ cover: 'C', spreads });
    const last = book.sheets[book.sheets.length - 1]!;
    expect(last.density).toBe('soft');
    expect(last.front?.role).toBe('interior');
  });

  it('always produces an even face count', () => {
    for (const input of [
      { cover: 'C', spreads },
      { spreads },
      { spreads, backCover: 'B' },
      { cover: 'C', spreads, backCover: 'B' },
      { cover: 'C' },
    ] satisfies BookInput[]) {
      expect(buildBook(input).faces.length % 2).toBe(0);
    }
  });
});

describe('inputs', () => {
  it('accepts object spreads and object pages', () => {
    const book = buildBook({
      cover: { src: 'C', alt: 'A cover' },
      spreads: [{ left: '1L', right: { src: '1R', width: 800, height: 1200 } }],
    });
    expect(book.faces[0]?.image.alt).toBe('A cover');
    expect(book.faces[2]?.image.width).toBe(800);
  });

  it('generates page-number alt text when none is given', () => {
    const book = buildBook({ cover: 'C', spreads });
    expect(book.faces.map((f) => f?.image.alt)).toEqual([
      'Front cover',
      'Page 1',
      'Page 2',
      'Page 3',
      'Page 4',
      undefined, // trailing pad
    ]);
    expect(book.pageCount).toBe(4);
  });

  it('numbers interior pages and leaves covers unnumbered', () => {
    const book = buildBook({ cover: 'C', spreads, backCover: 'B' });
    expect(book.faces.map((f) => f?.pageNumber ?? null)).toEqual([null, 1, 2, 3, 4, null]);
  });

  it('handles a cover with no interior', () => {
    const book = buildBook({ cover: 'C' });
    expect(book.states.map(show)).toEqual(['-|C', '-|-']);
    expect([book.firstState, book.lastState]).toEqual([0, 0]);
  });

  it('rejects an empty book', () => {
    expect(() => buildBook({})).toThrow(/at least one page/);
    expect(() => buildBook({ spreads: [] })).toThrow(/at least one page/);
  });
});

describe('state helpers', () => {
  it('clamps into the reachable range, not the raw array', () => {
    const book = buildBook({ spreads }); // reachable 1..2
    expect(clampState(book, -5)).toBe(1);
    expect(clampState(book, 0)).toBe(1);
    expect(clampState(book, 99)).toBe(2);
    expect(clampState(book, Number.NaN)).toBe(1);
  });

  it('stateAt clamps rather than throwing', () => {
    const book = buildBook({ spreads });
    expect(show(stateAt(book, 0))).toBe('1L|1R');
  });

  it('resolves startAt', () => {
    const withCover = buildBook({ cover: 'C', spreads });
    expect(resolveStartState(withCover, 'cover')).toBe(0);
    expect(resolveStartState(withCover, 'first-spread')).toBe(1);
    expect(resolveStartState(withCover, 2)).toBe(2);
    expect(resolveStartState(withCover, undefined)).toBe(0);

    // 'cover' on a coverless book falls back rather than failing.
    const noCover = buildBook({ spreads });
    expect(resolveStartState(noCover, 'cover')).toBe(1);
  });
});
