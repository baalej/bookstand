import type {
  BookInput,
  Face,
  FaceRole,
  FaceSlot,
  ImageSource,
  PageInput,
  Sheet,
  SpreadInput,
  SpreadState,
} from '../types.js';

export interface Book {
  /** The padded face list. Even length by construction. */
  faces: readonly FaceSlot[];
  /** Consecutive face pairs. */
  sheets: readonly Sheet[];
  /** Every split point: `sheets.length + 1` of them, including unreachable ends. */
  states: readonly SpreadState[];
  /** First reachable state. 0 when there's a cover, 1 when there isn't. */
  firstState: number;
  /** Last reachable state. */
  lastState: number;
  /** Count of interior pages (excludes covers and padding). */
  pageCount: number;
}

function normalizeImage(input: PageInput, alt: string): ImageSource {
  if (typeof input === 'string') return { src: input, alt };
  return { alt, ...input };
}

function normalizeSpread(spread: SpreadInput): readonly [PageInput, PageInput] {
  return Array.isArray(spread)
    ? (spread as readonly [PageInput, PageInput])
    : [(spread as { left: PageInput }).left, (spread as { right: PageInput }).right];
}

function isCover(slot: FaceSlot): boolean {
  return slot !== null && slot.role !== 'interior';
}

/**
 * Build the sheet model from the declared structure.
 *
 * The whole thing is one rule with no branching on which covers exist:
 *
 *   1. Flatten to a face list.
 *   2. Pad with `null` at the front if there's no cover, and at the back if
 *      that leaves an odd count.
 *   3. Pair consecutive faces into sheets.
 *   4. Read off states; drop the ones that would show nothing.
 *
 * Step 2 is what makes optional covers work. Without a cover the first
 * interior page is the *back* of a sheet that doesn't exist, so the book opens
 * already-open — which is exactly the desired behaviour, arrived at by padding
 * rather than by a special case.
 */
export function buildBook(input: BookInput): Book {
  const spreads = (input.spreads ?? []).map(normalizeSpread);
  const faces: FaceSlot[] = [];
  let pageNumber = 0;

  const push = (image: ImageSource, role: FaceRole, n: number | null): void => {
    faces.push({ index: faces.length, image, role, pageNumber: n });
  };

  if (input.cover !== undefined) {
    push(normalizeImage(input.cover, 'Front cover'), 'cover', null);
  } else {
    faces.push(null); // leading pad — see doc comment
  }

  for (const [left, right] of spreads) {
    push(normalizeImage(left, `Page ${++pageNumber}`), 'interior', pageNumber);
    push(normalizeImage(right, `Page ${++pageNumber}`), 'interior', pageNumber);
  }

  if (input.backCover !== undefined) {
    push(normalizeImage(input.backCover, 'Back cover'), 'back-cover', null);
  }

  if (faces.length % 2 !== 0) faces.push(null); // trailing pad

  const sheets: Sheet[] = [];
  for (let i = 0; i < faces.length; i += 2) {
    const front = faces[i] ?? null;
    const back = faces[i + 1] ?? null;
    sheets.push({
      index: sheets.length,
      front,
      back,
      // A cover board is rigid through its whole thickness, so a sheet is
      // rigid if *either* face is a cover — the front cover's reverse is an
      // interior page but the leaf still doesn't bend.
      density: isCover(front) || isCover(back) ? 'rigid' : 'soft',
    });
  }

  const states: SpreadState[] = [];
  for (let i = 0; i <= sheets.length; i++) {
    const before = i > 0 ? sheets[i - 1] : undefined;
    const at = i < sheets.length ? sheets[i] : undefined;
    states.push({
      index: i,
      left: before ? before.back : null,
      right: at ? at.front : null,
    });
  }

  let firstState = -1;
  let lastState = -1;
  for (let i = 0; i < states.length; i++) {
    const s = states[i]!;
    if (s.left === null && s.right === null) continue;
    if (firstState === -1) firstState = i;
    lastState = i;
  }

  if (firstState === -1) {
    throw new Error('Bookstand: a book needs at least one page.');
  }

  return { faces, sheets, states, firstState, lastState, pageCount: pageNumber };
}

/** Clamp a state index into the reachable range. */
export function clampState(book: Book, index: number): number {
  if (!Number.isFinite(index)) return book.firstState;
  return Math.min(book.lastState, Math.max(book.firstState, Math.round(index)));
}

export function stateAt(book: Book, index: number): SpreadState {
  const state = book.states[clampState(book, index)];
  /* c8 ignore next */
  if (!state) throw new Error('Bookstand: no reachable state.');
  return state;
}

/**
 * Resolve the `startAt` option to a state index.
 * `'cover'` falls back to the first reachable state when there is no cover.
 */
export function resolveStartState(
  book: Book,
  startAt: 'cover' | 'first-spread' | number | undefined,
): number {
  if (typeof startAt === 'number') return clampState(book, startAt);
  if (startAt === 'first-spread') {
    // The first state showing two interior halves, if there is one.
    for (let i = book.firstState; i <= book.lastState; i++) {
      const s = book.states[i]!;
      if (s.left !== null && s.right !== null) return i;
    }
    return book.firstState;
  }
  return book.firstState;
}
