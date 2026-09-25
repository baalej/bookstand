import type { Book } from './model/book.js';
import { clampState } from './model/book.js';
import type { CornerPath, CurlOptions, Fold, PageMetrics } from './geom/fold.js';
import {
  constrainCorner,
  cornerPath,
  defaultCurl,
  foldFor,
  progressFor,
  restCorner,
  turnedCorner,
} from './geom/fold.js';
import { Spring, projectedRest } from './motion/spring.js';
import { gesture, springs, type SpringToken } from './motion/tokens.js';
import { Emitter } from './events/emitter.js';
import { add, clamp, dist, len, normalize, scale, sub } from './geom/vec.js';
import type { FaceSlot, FlipCorner, FlipDirection, Point, Sheet } from './types.js';

export interface MotionOptions {
  settle: SpringToken;
  recoil: SpringToken;
  peek: SpringToken;
  /** Progress per second above which a flick completes regardless of distance. */
  flickVelocity: number;
  /** Hard ceiling on a settle, in ms. */
  maxDuration: number;
  /** Corner lift on hover, as a fraction of page width. */
  peekDepth: number;
  /** Radius of the region that arms the peek, as a fraction of the page diagonal. */
  peekZone: number;
}

export const defaultMotion: MotionOptions = {
  settle: springs.settle,
  recoil: springs.recoil,
  peek: springs.peek,
  flickVelocity: gesture.flickVelocity,
  maxDuration: gesture.maxDuration,
  peekDepth: gesture.peekDepth,
  peekZone: gesture.peekZone,
};

export interface FlipFrame {
  sheet: Sheet;
  direction: FlipDirection;
  corner: FlipCorner;
  /** Face of the moving sheet visible at progress 0. */
  movingFront: FaceSlot;
  /** Its reverse — visible at progress 1, where the sheet lands. */
  movingBack: FaceSlot;
  rigid: boolean;
  /**
   * True while this is only a hover affordance, not a page being turned.
   *
   * A hint must not darken anything: the lifted corner is the whole message,
   * and a shadow spreading across the page under the cursor reads as a hover
   * highlight the book has no business having.
   */
  hint: boolean;
  fold: Fold;
}

export interface FrameState {
  stateIndex: number;
  /** Resting halves. `null` is a reserved half, not an error. */
  left: FaceSlot;
  right: FaceSlot;
  flip: FlipFrame | null;
}

export type ControllerEvents = {
  change: { index: number; previous: number };
  flipstart: { direction: FlipDirection; from: number; to: number };
  flipend: { index: number; completed: boolean };
};

/** `peek` is a hover hint; `drag` is under the finger; `settle` is physics finishing the job. */
type FlipMode = 'peek' | 'drag' | 'settle';

interface ActiveFlip {
  direction: FlipDirection;
  corner: FlipCorner;
  sheet: Sheet;
  from: number;
  to: number;
  mode: FlipMode;
  /** Page-local corner position — the single source of truth for geometry. */
  cornerPos: Point;
  /**
   * Pointer position, page-local, at the moment of grab.
   *
   * The corner moves by the pointer's *delta* from here, never to the pointer
   * itself. Absolute tracking teleports: in StPageFlip, grabbing a quarter of
   * the way across a page and nudging 20 px snaps the flip to 38% progress.
   */
  grabOrigin: Point | null;
  /** Corner position at the moment of grab, so the delta has something to add to. */
  grabCorner: Point;
  /**
   * Where a hovering cursor wants the corner. Updated every mouse move, while
   * the spring separately controls *how far* toward it the corner has risen —
   * so the lift can be springy without the target being stale.
   */
  peekTarget: Point | null;
  path: CornerPath | null;
  committing: boolean;
  elapsed: number;
}

/**
 * Owns the book's position and everything in motion. Knows nothing about the
 * DOM, WebGL, or input devices: it takes page-local coordinates in and hands a
 * FrameState out, which is what makes it testable without a GPU.
 */
export class FlipController {
  private readonly events = new Emitter<ControllerEvents>();
  private readonly spring: Spring;
  private active: ActiveFlip | null = null;
  private index: number;

  constructor(
    private readonly book: Book,
    private metrics: PageMetrics,
    private readonly motion: MotionOptions = defaultMotion,
    private readonly curl: CurlOptions = defaultCurl,
    startIndex?: number,
  ) {
    this.index = startIndex === undefined ? book.firstState : clampState(book, startIndex);
    this.spring = new Spring(motion.settle);
  }

  on = this.events.on.bind(this.events);
  off = this.events.off.bind(this.events);

  get stateIndex(): number {
    return this.index;
  }

  get animating(): boolean {
    return this.active !== null && this.active.mode === 'settle';
  }

  get dragging(): boolean {
    return this.active !== null && this.active.mode === 'drag';
  }

  get peeking(): boolean {
    return this.active !== null && this.active.mode === 'peek';
  }

  get interacting(): boolean {
    return this.active !== null;
  }

  setMetrics(metrics: PageMetrics): void {
    this.metrics = metrics;
  }

  canGoNext(): boolean {
    return this.index < this.book.lastState;
  }

  canGoPrev(): boolean {
    return this.index > this.book.firstState;
  }

  canGo(direction: FlipDirection): boolean {
    return direction === 'forward' ? this.canGoNext() : this.canGoPrev();
  }

  /**
   * Which sheet moves. Forward from state i turns sheets[i]; backward turns
   * sheets[i-1]. Both are guaranteed present by the can-go checks.
   */
  private sheetFor(direction: FlipDirection): Sheet | null {
    const i = direction === 'forward' ? this.index : this.index - 1;
    return this.book.sheets[i] ?? null;
  }

  private begin(
    direction: FlipDirection,
    corner: FlipCorner,
    mode: FlipMode,
    cornerPos: Point,
  ): ActiveFlip | null {
    if (!this.canGo(direction)) return null;
    const sheet = this.sheetFor(direction);
    if (!sheet) return null;

    const from = this.index;
    const to = direction === 'forward' ? from + 1 : from - 1;
    const flip: ActiveFlip = {
      direction,
      corner,
      sheet,
      from,
      to,
      mode,
      cornerPos,
      grabOrigin: null,
      grabCorner: cornerPos,
      peekTarget: null,
      path: null,
      committing: false,
      elapsed: 0,
    };
    this.active = flip;
    this.events.emit('flipstart', { direction, from, to });
    return flip;
  }

  /**
   * Start an interactive drag. `pointer` is page-local.
   *
   * If a flip is already settling or peeking in the same direction, the drag
   * seizes it from wherever it currently is rather than snapping to a fresh
   * start — a reader who grabs a page mid-turn expects to catch it, not to
   * restart it.
   */
  beginDrag(direction: FlipDirection, corner: FlipCorner, pointer: Point): boolean {
    const current = this.active;
    if (current && current.direction === direction) {
      current.mode = 'drag';
      current.corner = corner;
      current.grabOrigin = pointer;
      current.grabCorner = current.cornerPos;
      current.path = null;
      return true;
    }
    if (current) this.cancel();

    const flip = this.begin(direction, corner, 'drag', restCorner(this.metrics, corner));
    if (!flip) return false;
    flip.grabOrigin = pointer;
    flip.grabCorner = flip.cornerPos;
    return true;
  }

  /** Move the grabbed corner by the pointer's delta since the grab. */
  dragTo(pointer: Point): void {
    const flip = this.active;
    if (!flip || flip.mode !== 'drag' || !flip.grabOrigin) return;
    const delta = sub(pointer, flip.grabOrigin);
    flip.cornerPos = constrainCorner(this.metrics, flip.corner, add(flip.grabCorner, delta));
  }

  /**
   * Release a drag. `velocityX` is page-local horizontal speed in units/sec —
   * negative means moving toward the spine, i.e. completing the turn.
   */
  endDrag(velocityX = 0): void {
    const flip = this.active;
    if (!flip || flip.mode !== 'drag') return;

    const m = this.metrics;
    const progress = progressFor(m, flip.cornerPos);
    // x shrinks as progress grows, hence the sign flip.
    const progressVelocity = -velocityX / (2 * m.width);
    const projected = projectedRest(progress, progressVelocity, this.motion.settle.stiffness);
    const commit = projected > 0.5 || progressVelocity > this.motion.flickVelocity;

    this.settle(flip, commit, progressVelocity);
  }

  /**
   * Lift the corner under a hovering pointer.
   *
   * Two phases: a sprung lift to the peek depth, then direct tracking within a
   * small radius while the pointer stays in the corner. Desktop only — the
   * caller gates it on a fine pointer.
   */
  /**
   * Where the corner should sit for a cursor hovering at `pointer`.
   *
   * The lift **deepens** as the cursor closes on the corner. Placing the
   * corner at the cursor instead — the obvious reading of "it follows your
   * mouse" — makes the fold collapse exactly when the reader is homing in on
   * it: measured 42 px of lift at 50 px away, 15 px at 15 px, 5 px at 5 px.
   * Backwards, and it reads as the page losing interest.
   *
   * Direction blends from the cursor toward a fixed inward diagonal as the
   * cursor nears the corner, because a direction derived from a vanishing
   * offset swings wildly over the last few pixels.
   */
  private peekPose(corner: FlipCorner, pointer: Point): Point {
    const m = this.metrics;
    const rest = restCorner(m, corner);
    const zone = Math.hypot(m.width, m.height) * this.motion.peekZone;
    const offset = sub(pointer, rest);
    const distance = len(offset);

    const nearness = clamp(1 - distance / Math.max(1, zone), 0, 1);
    const depth = m.width * this.motion.peekDepth * (nearness * nearness * (3 - 2 * nearness));

    // Toward the middle of the page: the way the corner would actually fold.
    const inward = normalize(sub({ x: m.width / 2, y: m.height / 2 }, rest));
    const fromCursor = distance > 1 ? scale(offset, 1 / distance) : inward;
    const blend = clamp(distance / (zone * 0.5), 0, 1);
    const dir = normalize(add(scale(inward, 1 - blend), scale(fromCursor, blend)));

    return constrainCorner(m, corner, add(rest, scale(dir, depth)));
  }

  peekAt(direction: FlipDirection, corner: FlipCorner, pointer: Point): boolean {
    const current = this.active;
    if (current) {
      if (current.mode !== 'peek') return false;
      if (current.direction !== direction || current.corner !== corner) return false;
      current.peekTarget = this.peekPose(corner, pointer);
      // Once risen, follow the cursor with no spring in the way. Still
      // rising, `tick` blends toward the new target.
      if (this.spring.value >= 1) current.cornerPos = current.peekTarget;
      return true;
    }

    const flip = this.begin(direction, corner, 'peek', restCorner(this.metrics, corner));
    if (!flip) return false;

    flip.peekTarget = this.peekPose(corner, pointer);
    this.spring.configure(this.motion.peek);
    this.spring.reset(0, 0);
    this.spring.target = 1;
    return true;
  }

  /** Pointer left the corner — put the page back down. */
  endPeek(): void {
    const flip = this.active;
    if (!flip || flip.mode !== 'peek') return;
    this.settle(flip, false, 0);
  }

  private settle(flip: ActiveFlip, commit: boolean, progressVelocity: number): void {
    const m = this.metrics;
    const destination = commit ? turnedCorner(m, flip.corner) : restCorner(m, flip.corner);

    flip.mode = 'settle';
    flip.committing = commit;
    flip.elapsed = 0;
    flip.grabOrigin = null;
    flip.path = cornerPath(m, flip.corner, flip.cornerPos, destination);

    this.spring.configure(commit ? this.motion.settle : this.motion.recoil);

    // Carry the release velocity into the spring's parameter space so the page
    // keeps the speed the finger gave it instead of restarting from rest.
    const span = dist(flip.cornerPos, destination);
    const seed = span > 0 ? clamp((Math.abs(progressVelocity) * 2 * m.width) / span, 0, 8) : 0;
    this.spring.reset(0, commit ? seed : Math.max(seed, 0.5));
    this.spring.target = 1;
  }

  /** Animated flip with no drag — tap, key, or programmatic. */
  goNext(corner: FlipCorner = 'top'): boolean {
    return this.animate('forward', corner);
  }

  goPrev(corner: FlipCorner = 'top'): boolean {
    return this.animate('back', corner);
  }

  private animate(direction: FlipDirection, corner: FlipCorner): boolean {
    // A peek is only a hint; a real flip request overrides it.
    if (this.active?.mode === 'peek') this.cancel();

    if (this.active) {
      // A hand on the page outranks a tap: the same pointer cannot do both.
      if (this.active.mode === 'drag') return false;
      // A second tap arriving mid-settle must chain, not vanish. Land the
      // flip in flight immediately and start the next one — otherwise
      // tapping through a book drops most of the taps and reads as ignored
      // input.
      this.complete(this.active);
    }

    const flip = this.begin(direction, corner, 'settle', restCorner(this.metrics, corner));
    if (!flip) return false;
    this.settle(flip, true, 0);
    // A small seed so the page leaves the edge with intent rather than easing
    // out of nothing.
    this.spring.reset(0, 1.5);
    this.spring.target = 1;
    return true;
  }

  /**
   * Jump to a state. Adjacent moves animate; longer jumps cut directly —
   * riffling through forty spreads to reach one is not navigation.
   */
  goTo(index: number, options: { animate?: boolean } = {}): void {
    const target = clampState(this.book, index);
    if (target === this.index) return;
    const animate = options.animate ?? true;

    if (animate && !this.active && Math.abs(target - this.index) === 1) {
      if (target > this.index) this.goNext();
      else this.goPrev();
      return;
    }

    this.cancel();
    const previous = this.index;
    this.index = target;
    this.events.emit('change', { index: this.index, previous });
  }

  /** Drop any flip in progress without committing it. */
  cancel(): void {
    if (!this.active) return;
    this.active = null;
    this.spring.reset(0);
    this.events.emit('flipend', { index: this.index, completed: false });
  }

  /** Advance motion. Returns true while there is more to draw. */
  tick(dtMs: number): boolean {
    const flip = this.active;
    if (!flip) return false;
    // A grabbed page is held by the finger; a lifted corner that has finished
    // rising just sits there. Neither needs the clock.
    if (flip.mode === 'drag') return true;

    flip.elapsed += dtMs;
    const moving = this.spring.step(dtMs);
    const overrun = flip.elapsed >= this.motion.maxDuration;
    const t = overrun ? 1 : this.spring.value;

    if (flip.mode === 'peek') {
      // The spring says how far the corner has risen; the cursor says where
      // to. Driving a fixed path instead froze the fold at wherever the
      // cursor first entered the corner for the spring's whole ~550ms, which
      // reads as the page ignoring you right when you are aiming at it.
      const rest = restCorner(this.metrics, flip.corner);
      const target = flip.peekTarget ?? rest;
      flip.cornerPos = add(rest, scale(sub(target, rest), t));
      if (!moving || overrun) return false;
      return true;
    }

    if (flip.path) flip.cornerPos = flip.path(t);

    if (moving && !overrun) return true;

    this.complete(flip);
    return false;
  }

  /** Land a flip: adopt its destination if it was committing, and announce it. */
  private complete(flip: ActiveFlip): void {
    const previous = this.index;
    if (flip.committing) this.index = flip.to;
    this.active = null;
    this.spring.reset(0);
    this.events.emit('flipend', { index: this.index, completed: flip.committing });
    if (this.index !== previous) {
      this.events.emit('change', { index: this.index, previous });
    }
  }

  frame(): FrameState {
    const { book } = this;
    const resting = book.states[this.index]!;
    const flip = this.active;

    if (!flip) {
      return { stateIndex: this.index, left: resting.left, right: resting.right, flip: null };
    }

    const forward = flip.direction === 'forward';
    const other = book.states[flip.to];

    // The half the moving sheet vacates shows what was beneath it all along.
    const left = forward ? resting.left : (other?.left ?? null);
    const right = forward ? (other?.right ?? null) : resting.right;

    return {
      stateIndex: this.index,
      left,
      right,
      flip: {
        sheet: flip.sheet,
        direction: flip.direction,
        corner: flip.corner,
        movingFront: forward ? flip.sheet.front : flip.sheet.back,
        movingBack: forward ? flip.sheet.back : flip.sheet.front,
        rigid: flip.sheet.density === 'rigid',
        hint: flip.mode === 'peek',
        fold: foldFor(this.metrics, flip.corner, flip.cornerPos, this.curl),
      },
    };
  }

  destroy(): void {
    this.active = null;
    this.events.clear();
  }
}
