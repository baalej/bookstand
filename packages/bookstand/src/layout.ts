export interface LayoutOptions {
  /** Page width ÷ page height. */
  aspect: number;
  /** Fraction of the container left as breathing room. */
  padding: number;
  /**
   * Room left for the turning sheet to sweep into, per axis.
   *
   * **The two axes need very different amounts, and treating them alike was a
   * bug.** A single scalar of 1.08 was applied to both, sized for the
   * perspective divide — a sheet tilting toward the viewer is magnified, and
   * Phase 2 reserved for exactly that. But the sheet also *swings*: reflected
   * about a slanted crease it presents more vertical extent than the flat page
   * did, needing **1.42x** the page height on a 0.688 book while using only
   * **1.01x** its width. So the vertical reservation was a third short and the
   * horizontal one was almost entirely wasted, which is visible as a sheet
   * sliced flat along the canvas edge with generous empty margins either side.
   *
   * `y` comes from `foldSweep`, derived from the fold itself. `x` only has to
   * cover the perspective divide, because the sweep is a rotation about the
   * spine and the spine edge never lifts.
   */
  headroom: { x: number; y: number };
}

export const defaultLayout: LayoutOptions = {
  aspect: 0.7,
  padding: 0.04,
  // Overridden per book by `Bookstand`, which knows the page aspect and the
  // renderer's magnification. These are only the shape of the thing.
  headroom: { x: 1.08, y: 1.42 },
};

export interface Layout {
  /** One page, CSS px. */
  pageWidth: number;
  pageHeight: number;
  /** The book's footprint — always two pages wide, in every state. */
  bookWidth: number;
  bookHeight: number;
}

/**
 * Resolve container size to a book footprint.
 *
 * A book is a spread, always. There is no single-page mode: the gesture this
 * library exists for is turning one leaf of an open book, and a lone page has
 * no spine to turn about. On a narrow container the spread simply gets
 * smaller.
 */
export function computeLayout(
  containerWidth: number,
  containerHeight: number,
  options: LayoutOptions = defaultLayout,
): Layout {
  const headroomX = Math.max(1, options.headroom.x);
  const headroomY = Math.max(1, options.headroom.y);
  const boxW = Math.max(1, (containerWidth * (1 - options.padding * 2)) / headroomX);
  const boxH = Math.max(1, (containerHeight * (1 - options.padding * 2)) / headroomY);

  const spreadAspect = options.aspect * 2;
  const bookWidth = Math.min(boxW, boxH * spreadAspect);
  const bookHeight = bookWidth / spreadAspect;

  return {
    pageWidth: bookWidth / 2,
    pageHeight: bookHeight,
    bookWidth,
    bookHeight,
  };
}
