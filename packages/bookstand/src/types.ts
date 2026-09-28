export interface Point {
  x: number;
  y: number;
}

/** A page is an image. The library never looks inside one. */
export interface ImageSource {
  src: string;
  alt: string;
  srcset?: string;
  sizes?: string;
  /** Intrinsic pixel size, used to hold layout before the image loads. */
  width?: number;
  height?: number;
  /** Low-quality placeholder: a data URI or a solid colour. */
  placeholder?: string;
}

export type PageInput = string | ({ src: string } & Partial<Omit<ImageSource, 'src'>>);

export type SpreadInput = readonly [PageInput, PageInput] | { left: PageInput; right: PageInput };

export interface BookInput {
  /** Optional. Sits on the right; the left half is reserved for where it lands. */
  cover?: PageInput;
  /** The interior. Each entry fills both halves. */
  spreads?: readonly SpreadInput[];
  /** Optional. Ends on the left, as it would in a real book. */
  backCover?: PageInput;
}

export type FaceRole = 'cover' | 'interior' | 'back-cover';

export interface Face {
  /** Position in the padded face list. */
  index: number;
  image: ImageSource;
  role: FaceRole;
  /** 1-based page number among interior pages; null for covers. */
  pageNumber: number | null;
}

/**
 * `null` is a real, meaningful value here: it is a half with nothing on it.
 * That covers both the reserved space beside a cover and the padding that
 * lets an open-ended book pair evenly into sheets.
 */
export type FaceSlot = Face | null;

/** Covers don't bend. Interior paper does. */
export type Density = 'rigid' | 'soft';

/**
 * A physical leaf: two faces, back to back. This — not a list of pages — is
 * what a page-flip book actually is, and why the cover/back-cover cases need
 * no special handling.
 */
export interface Sheet {
  index: number;
  front: FaceSlot;
  back: FaceSlot;
  density: Density;
}

/** What you see when the stack of sheets is split at one point. */
export interface SpreadState {
  index: number;
  left: FaceSlot;
  right: FaceSlot;
}

export type FlipDirection = 'forward' | 'back';
export type FlipCorner = 'top' | 'bottom';
