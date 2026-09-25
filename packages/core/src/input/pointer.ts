import type { FlipController } from '../flip-controller.js';
import type { Layout } from '../layout.js';
import { VelocityTracker } from '../motion/velocity.js';
import { gesture } from '../motion/tokens.js';
import type { FlipCorner, FlipDirection, Point } from '../types.js';

export interface PointerInputOptions {
  drag: boolean;
  tap: boolean;
  /** Corner lift under a hovering cursor. Fine pointers only. */
  peek: boolean;
  /** Travel in CSS px before a press commits to a drag. */
  intentLockPx: number;
  /** Notify the host that something changed and a frame is needed. */
  onChange: () => void;
}

interface Grab {
  id: number;
  /** Client coords at press, for the intent lock. */
  startClient: Point;
  direction: FlipDirection;
  corner: FlipCorner;
  /** Page-local coords at press, for the delta-based grab. */
  startLocal: Point;
  /**
   * Pressed on a corner — where a dog-ear is showing, or would be.
   *
   * Such a grab skips the direction test below: taking hold of a lifted
   * corner says what you mean, and there is nothing else it could mean.
   */
  fromCorner: boolean;
  locked: boolean;
  moved: boolean;
}

/**
 * Turns pointer events into flip gestures.
 *
 * Pointer Events throughout — one path for mouse, touch and pen, with capture
 * so a drag survives the pointer leaving the canvas. The reference keeps
 * separate mouse and touch handlers and gates touch behind a 250 ms timer;
 * this commits on distance instead, so the page moves on the first frame that
 * proves intent.
 */
export class PointerInput {
  private grab: Grab | null = null;
  private readonly velocity = new VelocityTracker(100);
  private peeking = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly controller: FlipController,
    private readonly getLayout: () => Layout,
    private readonly options: PointerInputOptions,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('pointerleave', this.onLeave);
    // Safety net: if capture is torn away without an up or a cancel — the
    // canvas is reparented, the element is disabled — the grab would otherwise
    // stick forever and every later press would be swallowed by the `if
    // (this.grab) return` guard.
    canvas.addEventListener('lostpointercapture', this.onLostCapture);
    // The gesture owns horizontal movement; let the browser keep vertical
    // scrolling so a book inside a scrolling page is not a trap.
    canvas.style.touchAction = 'pan-y';
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('lostpointercapture', this.onLostCapture);
  }

  // ---- coordinate conversion -------------------------------------------

  /** Client coords → book space: spine at x=0, y from 0 (top) to pageHeight. */
  private toBook(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    const layout = this.getLayout();
    return {
      x: clientX - rect.left - rect.width / 2,
      y: clientY - rect.top - rect.height / 2 + layout.pageHeight / 2,
    };
  }

  /**
   * Book space → page-local, mirrored so both directions share one geometry.
   * Page-local x runs 0 at the spine to pageWidth at the free edge.
   */
  private toLocal(book: Point, direction: FlipDirection): Point {
    return { x: direction === 'forward' ? book.x : -book.x, y: book.y };
  }

  private directionAt(book: Point): FlipDirection {
    return book.x >= 0 ? 'forward' : 'back';
  }

  private cornerAt(book: Point): FlipCorner {
    return book.y < this.getLayout().pageHeight / 2 ? 'top' : 'bottom';
  }

  private insideBook(book: Point): boolean {
    const layout = this.getLayout();
    return (
      Math.abs(book.x) <= layout.pageWidth &&
      book.y >= 0 &&
      book.y <= layout.pageHeight
    );
  }

  /** Distance from the nearest outer corner, as a fraction of the page diagonal. */
  private cornerNearness(book: Point): number {
    const layout = this.getLayout();
    const corner = {
      x: book.x >= 0 ? layout.pageWidth : -layout.pageWidth,
      y: book.y < layout.pageHeight / 2 ? 0 : layout.pageHeight,
    };
    const diagonal = Math.hypot(layout.pageWidth, layout.pageHeight);
    return Math.hypot(book.x - corner.x, book.y - corner.y) / diagonal;
  }

  // ---- handlers ---------------------------------------------------------

  private onDown = (event: PointerEvent): void => {
    if (!this.options.drag && !this.options.tap) return;
    // Ignore extra contacts once a drag owns the gesture, or the page jumps
    // to whichever finger moved last.
    if (this.grab) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;

    const book = this.toBook(event.clientX, event.clientY);
    if (!this.insideBook(book)) return;

    const direction = this.directionAt(book);
    const corner = this.cornerAt(book);

    this.grab = {
      id: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      direction,
      corner,
      startLocal: this.toLocal(book, direction),
      fromCorner: this.controller.peeking || this.cornerNearness(book) < gesture.peekZone,
      locked: false,
      moved: false,
    };

    this.velocity.reset();
    this.velocity.add(event.clientX, event.clientY, event.timeStamp);
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onMove = (event: PointerEvent): void => {
    const grab = this.grab;

    if (!grab) {
      this.maybePeek(event);
      return;
    }
    if (event.pointerId !== grab.id) return;

    this.velocity.add(event.clientX, event.clientY, event.timeStamp);

    if (!grab.locked) {
      const dx = event.clientX - grab.startClient.x;
      const dy = event.clientY - grab.startClient.y;
      if (Math.hypot(dx, dy) < this.options.intentLockPx) return;

      // Directional intent lock: a mostly-vertical drag through the middle of
      // a page is the reader scrolling the document the book sits in.
      //
      // It must not apply to a corner grab. Pulling a top-right dog-ear
      // downward is the natural motion, and measured against the real thing,
      // anything steeper than 45° was rejected and the gesture stayed dead
      // for its whole duration however far the reader kept pulling.
      if (!grab.fromCorner && Math.abs(dy) > Math.abs(dx)) {
        this.release(event, true);
        return;
      }

      grab.locked = true;
      grab.moved = true;
      if (!this.options.drag) return;
      if (!this.controller.beginDrag(grab.direction, grab.corner, grab.startLocal)) {
        this.grab = null;
        return;
      }
    }

    const book = this.toBook(event.clientX, event.clientY);
    this.controller.dragTo(this.toLocal(book, grab.direction));
    this.options.onChange();
  };

  private onUp = (event: PointerEvent): void => {
    const grab = this.grab;
    if (!grab || event.pointerId !== grab.id) return;

    if (!grab.moved) {
      // Never travelled far enough to be a drag: treat as a tap.
      this.release(event, true);
      if (this.options.tap) {
        if (grab.direction === 'forward') this.controller.goNext(grab.corner);
        else this.controller.goPrev(grab.corner);
        this.options.onChange();
      }
      return;
    }

    const layout = this.getLayout();
    const v = this.velocity.get();
    // Mirror the velocity into page-local space, matching the corner.
    const localVx = grab.direction === 'forward' ? v.x : -v.x;
    this.release(event, false);
    this.controller.endDrag(localVx);
    this.options.onChange();
    void layout;
  };

  private onCancel = (event: PointerEvent): void => {
    const grab = this.grab;
    if (!grab || event.pointerId !== grab.id) return;
    // A system gesture took over. Let the page fall back rather than
    // stranding it mid-turn.
    this.release(event, false);
    if (grab.moved) {
      this.controller.endDrag(0);
      this.options.onChange();
    }
  };

  private onLostCapture = (event: PointerEvent): void => {
    const grab = this.grab;
    if (!grab || event.pointerId !== grab.id) return;
    this.grab = null;
    this.velocity.reset();
    if (grab.moved) {
      this.controller.endDrag(0);
      this.options.onChange();
    }
  };

  private onLeave = (): void => {
    if (this.grab) return;
    if (this.peeking) {
      this.peeking = false;
      this.controller.endPeek();
      this.options.onChange();
    }
  };

  private release(event: PointerEvent, silent: boolean): void {
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.grab = null;
    this.velocity.reset();
    void silent;
  }

  /**
   * Corner peek. Fine pointers only: on touch, `pointermove` without a button
   * arrives as a tap's hover and would lift a corner the reader never aimed at.
   */
  private maybePeek(event: PointerEvent): void {
    if (!this.options.peek) return;
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    // Peek is a hover affordance, so it requires an empty hand. Without this,
    // a drag the intent lock rejected — a vertical scroll, say — drops its
    // grab and the very next move lifts a corner the reader never aimed at.
    if (event.buttons !== 0) return;
    if (this.controller.dragging || this.controller.animating) return;

    const book = this.toBook(event.clientX, event.clientY);
    const near = this.insideBook(book) && this.cornerNearness(book) < gesture.peekZone;

    if (!near) {
      if (this.peeking) {
        this.peeking = false;
        this.controller.endPeek();
        this.options.onChange();
      }
      return;
    }

    const direction = this.directionAt(book);
    const corner = this.cornerAt(book);
    if (this.controller.peekAt(direction, corner, this.toLocal(book, direction))) {
      this.peeking = true;
      this.options.onChange();
    }
  }
}
