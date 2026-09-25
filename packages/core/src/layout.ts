export interface LayoutOptions {
  /** Page width ÷ page height. */
  aspect: number;
  /** Fraction of the container left as breathing room. */
  padding: number;
  /**
   * Room left for a tilted sheet to grow into.
   *
   * A page rotating toward the viewer is magnified by the perspective divide.
   * Without reserved space it renders outside the book's footprint and gets
   * clipped by the canvas edge — visibly, at the top and bottom of the sheet.
   * This must match the renderer's `maxMagnification`.
   */
  headroom: number;
}

export const defaultLayout: LayoutOptions = {
  aspect: 0.7,
  padding: 0.04,
  headroom: 1.08,
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
  const headroom = Math.max(1, options.headroom);
  const boxW = Math.max(1, (containerWidth * (1 - options.padding * 2)) / headroom);
  const boxH = Math.max(1, (containerHeight * (1 - options.padding * 2)) / headroom);

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
