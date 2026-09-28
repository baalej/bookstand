import { describe, expect, it, vi } from 'vitest';
import { buildBook } from '../src/model/book.js';
import { FlipController, defaultMotion } from '../src/flip-controller.js';
import { restCorner, turnedCorner } from '../src/geom/fold.js';
import type { FrameState } from '../src/flip-controller.js';

const metrics = { width: 400, height: 600 };
const spreads = [
  ['1L', '1R'],
  ['2L', '2R'],
] as const;

const make = (start?: number): FlipController =>
  new FlipController(
    buildBook({ cover: 'C', spreads, backCover: 'B' }),
    metrics,
    defaultMotion,
    undefined,
    start,
  );

/** Drive to rest, returning the number of frames taken. */
function settle(c: FlipController, frameMs = 1000 / 60): number {
  let frames = 0;
  while (c.tick(frameMs)) {
    if (++frames > 1000) throw new Error('flip never settled');
  }
  return frames;
}

const halves = (f: FrameState): string =>
  `${f.left?.image.src ?? '-'}|${f.right?.image.src ?? '-'}`;

describe('navigation', () => {
  it('starts at the cover and walks to the back', () => {
    const c = make();
    expect(halves(c.frame())).toBe('-|C');
    c.goNext();
    settle(c);
    expect(halves(c.frame())).toBe('1L|1R');
    c.goNext();
    settle(c);
    expect(halves(c.frame())).toBe('2L|2R');
    c.goNext();
    settle(c);
    expect(halves(c.frame())).toBe('B|-');
    expect(c.canGoNext()).toBe(false);
  });

  it('walks back again', () => {
    const c = make(3);
    for (const expected of ['2L|2R', '1L|1R', '-|C']) {
      c.goPrev();
      settle(c);
      expect(halves(c.frame())).toBe(expected);
    }
    expect(c.canGoPrev()).toBe(false);
  });

  it('refuses to run off either end', () => {
    const c = make(0);
    expect(c.goPrev()).toBe(false);
    expect(c.stateIndex).toBe(0);
    const last = make(3);
    expect(last.goNext()).toBe(false);
    expect(last.stateIndex).toBe(3);
  });

  it('chains a tap that arrives mid-settle instead of swallowing it', () => {
    // Found by driving five taps in a second at the real thing: only two
    // landed, because each arrived while the previous flip was still
    // settling and was dropped on the floor.
    const c = make(0);
    expect(c.goNext()).toBe(true);
    c.tick(16);
    expect(c.goNext()).toBe(true); // lands the first, starts the second
    settle(c);
    expect(c.stateIndex).toBe(2);
  });

  it('advances once per tap however fast they arrive', () => {
    const c = make(0);
    for (let i = 0; i < 5; i++) {
      c.goNext();
      c.tick(16); // barely any time between taps
    }
    settle(c);
    expect(c.stateIndex).toBe(c.canGoNext() ? 5 : 3); // clamped at lastState
    expect(c.canGoNext()).toBe(false);
  });

  it('refuses a tap while a hand is on the page', () => {
    const c = make(1);
    c.beginDrag('forward', 'top', restCorner(metrics, 'top'));
    expect(c.goNext()).toBe(false);
    expect(c.dragging).toBe(true);
  });

  it('cuts directly for jumps longer than one spread', () => {
    const c = make();
    c.goTo(3);
    expect(c.stateIndex).toBe(3);
    expect(c.animating).toBe(false);
  });

  it('animates an adjacent goTo', () => {
    const c = make();
    c.goTo(1);
    expect(c.animating).toBe(true);
    settle(c);
    expect(c.stateIndex).toBe(1);
  });

  it('clamps goTo into the reachable range', () => {
    const c = new FlipController(buildBook({ spreads }), metrics); // reachable 1..2
    c.goTo(0, { animate: false });
    expect(c.stateIndex).toBe(1);
    c.goTo(99, { animate: false });
    expect(c.stateIndex).toBe(2);
  });
});

describe('frame composition during a flip', () => {
  it('shows the sheet faces and what lies beneath, going forward', () => {
    const c = make(0);
    c.goNext();
    c.tick(16);
    const f = c.frame();
    expect(f.flip).not.toBeNull();
    // Cover lifts off the right; the first spread's right page is underneath.
    expect(f.flip!.movingFront?.image.src).toBe('C');
    expect(f.flip!.movingBack?.image.src).toBe('1L');
    expect(halves(f)).toBe('-|1R');
    expect(f.flip!.rigid).toBe(true); // it's a cover
  });

  it('mirrors correctly going back', () => {
    const c = make(1);
    c.goPrev();
    c.tick(16);
    const f = c.frame();
    // The sheet starts showing 1L on the left and lands showing the cover.
    expect(f.flip!.movingFront?.image.src).toBe('1L');
    expect(f.flip!.movingBack?.image.src).toBe('C');
    expect(halves(f)).toBe('-|1R');
  });

  it('marks interior sheets soft', () => {
    const c = make(1);
    c.goNext();
    c.tick(16);
    expect(c.frame().flip!.rigid).toBe(false);
  });

  it('reports no flip at rest', () => {
    const c = make();
    expect(c.frame().flip).toBeNull();
    expect(c.tick(16)).toBe(false);
  });

  it('advances the fold as the flip runs', () => {
    const c = make();
    c.goNext();
    c.tick(16);
    const early = c.frame().flip!.fold.progress;
    for (let i = 0; i < 12; i++) c.tick(16);
    expect(c.frame().flip!.fold.progress).toBeGreaterThan(early);
  });
});

describe('drag and release', () => {
  it('completes a drag taken most of the way', () => {
    const c = make();
    c.beginDrag('forward', 'top', restCorner(metrics, 'top'));
    c.dragTo({ x: -300, y: 40 });
    c.endDrag(0);
    settle(c);
    expect(c.stateIndex).toBe(1);
  });

  it('falls back from a drag abandoned early', () => {
    const c = make();
    c.beginDrag('forward', 'top', restCorner(metrics, 'top'));
    c.dragTo({ x: 250, y: 40 });
    c.endDrag(0);
    settle(c);
    expect(c.stateIndex).toBe(0);
  });

  it('completes a fast flick from barely any travel', () => {
    // The StPageFlip failure case: position says "go back", velocity says
    // "turn the page". Velocity wins.
    const c = make();
    c.beginDrag('forward', 'top', restCorner(metrics, 'top'));
    c.dragTo({ x: 330, y: 30 }); // ~9% travelled
    expect(c.frame().flip!.fold.progress).toBeLessThan(0.15);
    c.endDrag(-5000); // moving hard toward the spine
    settle(c);
    expect(c.stateIndex).toBe(1);
  });

  it('cancels a slow drag past halfway that is heading back', () => {
    const c = make();
    c.beginDrag('forward', 'top', restCorner(metrics, 'top'));
    c.dragTo({ x: -60, y: 30 }); // ~57% travelled
    c.endDrag(3000); // but retreating
    settle(c);
    expect(c.stateIndex).toBe(0);
  });

  it('does not jump at release', () => {
    // The corner must continue from where the finger left it.
    const c = make();
    c.beginDrag('forward', 'top', restCorner(metrics, 'top'));
    c.dragTo({ x: 100, y: 200 });
    const before = c.frame().flip!.fold.corner;
    c.endDrag(0);
    c.tick(1);
    const after = c.frame().flip!.fold.corner;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(12);
  });

  it('keeps the corner tethered however wild the pointer', () => {
    const c = make();
    c.beginDrag('forward', 'top', restCorner(metrics, 'top'));
    for (const p of [
      { x: 9999, y: -9999 },
      { x: -9999, y: 9999 },
      { x: 0, y: 0 },
    ]) {
      c.dragTo(p);
      const { corner } = c.frame().flip!.fold;
      expect(Math.hypot(corner.x, corner.y)).toBeLessThanOrEqual(metrics.width + 1e-9);
    }
  });

  it('refuses a drag in an exhausted direction', () => {
    const c = make(0);
    expect(c.beginDrag('back', 'top', restCorner(metrics, 'top'))).toBe(false);
    expect(c.frame().flip).toBeNull();
  });

  it('ignores drag input when no drag is active', () => {
    const c = make();
    c.dragTo({ x: 0, y: 0 });
    c.endDrag(-5000);
    expect(c.frame().flip).toBeNull();
    expect(c.stateIndex).toBe(0);
  });

  it('holds position indefinitely while dragging', () => {
    const c = make();
    c.beginDrag('forward', 'top', restCorner(metrics, 'top'));
    c.dragTo({ x: 0, y: 300 });
    expect(c.tick(16)).toBe(true);
    expect(c.tick(16)).toBe(true);
    expect(c.animating).toBe(false);
    expect(c.interacting).toBe(true);
  });
});

describe('grab is relative, not absolute', () => {
  // The reference sets the corner *to* the pointer, so grabbing a quarter of
  // the way across a page and nudging 20px snaps the flip to 38% progress.
  // Measured on StPageFlip 2.0.7. Ours moves the corner by the pointer delta,
  // so the same nudge reads the same small value wherever you grabbed.
  const nudge = 20;
  const progressAfterGrabbingAt = (grabX: number): number => {
    const c = make(1);
    c.beginDrag('forward', 'top', { x: grabX, y: 200 });
    c.dragTo({ x: grabX - nudge, y: 202 });
    return c.frame().flip!.fold.progress;
  };

  it('gives the same progress wherever the page is grabbed', () => {
    const atEdge = progressAfterGrabbingAt(metrics.width * 0.95);
    const atMiddle = progressAfterGrabbingAt(metrics.width * 0.55);
    const nearSpine = progressAfterGrabbingAt(metrics.width * 0.25);

    expect(atMiddle).toBeCloseTo(atEdge, 6);
    expect(nearSpine).toBeCloseTo(atEdge, 6);
  });

  it('moves the corner by exactly the pointer delta', () => {
    const expected = nudge / (2 * metrics.width);
    expect(progressAfterGrabbingAt(metrics.width * 0.55)).toBeCloseTo(expected, 6);
  });

  it('never jumps on the first move', () => {
    // Grabbing deep inside the page and moving 1px must not fold the page.
    const c = make(1);
    c.beginDrag('forward', 'top', { x: metrics.width * 0.2, y: 300 });
    c.dragTo({ x: metrics.width * 0.2 - 1, y: 300 });
    expect(c.frame().flip!.fold.progress).toBeLessThan(0.01);
  });
});

describe('release decision uses velocity, not just distance', () => {
  const dragTo = (x: number, velocityX: number): number => {
    const c = make(1);
    c.beginDrag('forward', 'top', restCorner(metrics, 'top'));
    c.dragTo({ x, y: 30 });
    c.endDrag(velocityX);
    settle(c);
    return c.stateIndex;
  };

  it('completes a flick that barely moved', () => {
    // The reference fails this: same distance at 90ms and 700ms both snap back.
    expect(dragTo(metrics.width * 0.8, -5000)).toBe(2);
  });

  it('falls back at the same distance when the drag was slow', () => {
    expect(dragTo(metrics.width * 0.8, 0)).toBe(1);
  });

  it('distinguishes the two purely by speed', () => {
    const x = metrics.width * 0.8;
    expect(dragTo(x, -5000)).not.toBe(dragTo(x, 0));
  });
});

describe('recoil is quicker than settle', () => {
  const framesFor = (commit: boolean): number => {
    const c = make(1);
    c.beginDrag('forward', 'top', restCorner(metrics, 'top'));
    // Same distance from the destination in both cases.
    c.dragTo({ x: 0, y: 30 });
    c.endDrag(commit ? -4000 : 4000);
    return settle(c);
  };

  it('abandoning a drag settles in fewer frames than completing one', () => {
    // A refusal should get out of the way faster than a confirmation arrives.
    expect(framesFor(false)).toBeLessThan(framesFor(true));
  });
});

describe('re-grabbing mid-settle', () => {
  it('catches the page where it is instead of restarting', () => {
    const c = make(1);
    c.goNext();
    for (let i = 0; i < 6; i++) c.tick(1000 / 60);
    const caught = c.frame().flip!.fold.corner;

    c.beginDrag('forward', 'top', { x: 100, y: 100 });
    const afterGrab = c.frame().flip!.fold.corner;

    expect(afterGrab.x).toBeCloseTo(caught.x, 6);
    expect(afterGrab.y).toBeCloseTo(caught.y, 6);
    expect(c.dragging).toBe(true);
  });

  it('keeps tracking from the caught position', () => {
    const c = make(1);
    c.goNext();
    for (let i = 0; i < 6; i++) c.tick(1000 / 60);
    const caught = c.frame().flip!.fold.corner;

    c.beginDrag('forward', 'top', { x: 100, y: 100 });
    c.dragTo({ x: 70, y: 100 });
    expect(c.frame().flip!.fold.corner.x).toBeCloseTo(caught.x - 30, 6);
  });

  it('does not stack a second flip on top of the first', () => {
    const c = make(1);
    c.goNext();
    c.tick(16);
    c.beginDrag('forward', 'top', { x: 100, y: 100 });
    c.dragTo({ x: -metrics.width, y: 100 });
    c.endDrag(-4000);
    settle(c);
    expect(c.stateIndex).toBe(2); // one state advanced, not two
  });
});

describe('corner peek', () => {
  it('lifts the corner without committing to a flip', () => {
    const c = make(1);
    expect(c.peekAt('forward', 'top', { x: metrics.width - 20, y: 20 })).toBe(true);
    settle(c);
    const fold = c.frame().flip!.fold;
    expect(fold.progress).toBeGreaterThan(0);
    expect(fold.progress).toBeLessThan(0.2);
    expect(c.stateIndex).toBe(1);
  });

  it('puts the page back down when the pointer leaves', () => {
    const c = make(1);
    c.peekAt('forward', 'top', { x: metrics.width - 20, y: 20 });
    settle(c);
    c.endPeek();
    settle(c);
    expect(c.frame().flip).toBeNull();
    expect(c.stateIndex).toBe(1);
  });

  it('upgrades to a drag from the lifted position', () => {
    const c = make(1);
    c.peekAt('forward', 'top', { x: metrics.width - 20, y: 20 });
    settle(c);
    const lifted = c.frame().flip!.fold.corner;
    c.beginDrag('forward', 'top', { x: metrics.width - 20, y: 20 });
    expect(c.frame().flip!.fold.corner.x).toBeCloseTo(lifted.x, 6);
    expect(c.dragging).toBe(true);
  });

  it('is overridden by a real flip request', () => {
    const c = make(1);
    c.peekAt('forward', 'top', { x: metrics.width - 20, y: 20 });
    expect(c.goNext()).toBe(true);
    settle(c);
    expect(c.stateIndex).toBe(2);
  });

  it('refuses at an exhausted end', () => {
    const last = make(3);
    expect(last.peekAt('forward', 'top', { x: metrics.width - 20, y: 20 })).toBe(false);
    expect(last.frame().flip).toBeNull();
  });

  it('lifts further the closer the cursor gets', () => {
    // The corner was being placed *at* the cursor, so the fold collapsed as
    // the reader homed in on it: measured 42px of lift at 50px away, 15px at
    // 15px, 5px at 5px. Magnetism has to pull inward, not evaporate.
    const rest = restCorner(metrics, 'top');
    const liftAt = (distance: number): number => {
      const c = make(1);
      const pointer = { x: rest.x - distance * 0.7, y: rest.y + distance * 0.7 };
      c.peekAt('forward', 'top', pointer);
      settle(c);
      const corner = c.frame().flip!.fold.corner;
      return Math.hypot(corner.x - rest.x, corner.y - rest.y);
    };

    const distances = [200, 150, 100, 60, 30, 10];
    const lifts = distances.map(liftAt);
    for (let i = 1; i < lifts.length; i++) {
      expect(lifts[i]!, `closer at ${distances[i]}px must lift more`).toBeGreaterThan(
        lifts[i - 1]! - 1e-6,
      );
    }
    expect(lifts[lifts.length - 1]!).toBeGreaterThan(lifts[0]! + 10);
  });

  it('follows the cursor while it is still rising', () => {
    // The lift spring used to drive a path fixed at whatever position the
    // cursor first entered the corner, freezing the fold for its whole
    // duration — which reads as the page ignoring you.
    const c = make(1);
    const rest = restCorner(metrics, 'top');
    c.peekAt('forward', 'top', { x: rest.x - 120, y: rest.y + 120 });
    c.tick(16); // mid-rise
    c.peekAt('forward', 'top', { x: rest.x - 12, y: rest.y + 12 });
    c.tick(16);
    const near = c.frame().flip!.fold.corner;

    const d = make(1);
    d.peekAt('forward', 'top', { x: rest.x - 120, y: rest.y + 120 });
    d.tick(16);
    d.tick(16);
    const far = d.frame().flip!.fold.corner;

    expect(Math.hypot(near.x - rest.x, near.y - rest.y)).toBeGreaterThan(
      Math.hypot(far.x - rest.x, far.y - rest.y),
    );
  });

  it('marks a hover lift as a hint, not as a turn', () => {
    // The distinction a renderer needs: a corner lifted by a passing cursor is
    // an affordance, and anything it draws beyond the lift itself reads as a
    // hover highlight the book has no business having.
    const c = make(1);
    c.peekAt('forward', 'top', { x: metrics.width - 20, y: 20 });
    settle(c);
    expect(c.frame().flip!.hint).toBe(true);
  });

  it('stops being a hint the moment it becomes a real turn', () => {
    const c = make(1);
    c.peekAt('forward', 'top', { x: metrics.width - 20, y: 20 });
    settle(c);
    c.beginDrag('forward', 'top', { x: metrics.width - 20, y: 20 });
    expect(c.frame().flip!.hint).toBe(false);

    const d = make(1);
    d.goNext();
    d.tick(16);
    expect(d.frame().flip!.hint).toBe(false);
  });

  it('stops asking for frames once lifted', () => {
    // A held peek must not spin rAF forever.
    const c = make(1);
    c.peekAt('forward', 'top', { x: metrics.width - 20, y: 20 });
    settle(c);
    expect(c.tick(16)).toBe(false);
    expect(c.peeking).toBe(true);
  });
});

describe('events', () => {
  it('emits flipstart, flipend and change in order', () => {
    const c = make();
    const log: string[] = [];
    c.on('flipstart', (e) => log.push(`start:${e.from}->${e.to}`));
    c.on('flipend', (e) => log.push(`end:${e.completed}`));
    c.on('change', (e) => log.push(`change:${e.previous}->${e.index}`));
    c.goNext();
    settle(c);
    expect(log).toEqual(['start:0->1', 'end:true', 'change:0->1']);
  });

  it('emits flipend without change when a flip is abandoned', () => {
    const c = make();
    const change = vi.fn();
    const end = vi.fn();
    c.on('change', change);
    c.on('flipend', end);
    c.beginDrag('forward', 'top', restCorner(metrics, 'top'));
    c.dragTo({ x: 380, y: 20 });
    c.endDrag(0);
    settle(c);
    expect(end).toHaveBeenCalledWith({ index: 0, completed: false });
    expect(change).not.toHaveBeenCalled();
  });

  it('stops notifying after off() and destroy()', () => {
    const c = make();
    const fn = vi.fn();
    const unsubscribe = c.on('change', fn);
    unsubscribe();
    c.goTo(2, { animate: false });
    expect(fn).not.toHaveBeenCalled();

    const d = make();
    const fn2 = vi.fn();
    d.on('change', fn2);
    d.destroy();
    d.goTo(2, { animate: false });
    expect(fn2).not.toHaveBeenCalled();
  });
});

describe('robustness', () => {
  it('settles at both 60 Hz and 120 Hz in comparable time', () => {
    const a = make();
    a.goNext();
    const frames60 = settle(a, 1000 / 60);
    const b = make();
    b.goNext();
    const frames120 = settle(b, 1000 / 120);
    expect(frames60 * (1000 / 60)).toBeCloseTo(frames120 * (1000 / 120), -2);
  });

  it('never exceeds maxDuration', () => {
    const c = new FlipController(
      buildBook({ cover: 'C', spreads }),
      metrics,
      { ...defaultMotion, settle: { stiffness: 0.01 }, maxDuration: 300 },
    );
    c.goNext();
    let elapsed = 0;
    while (c.tick(16)) elapsed += 16;
    expect(elapsed).toBeLessThanOrEqual(300 + 16);
    expect(c.stateIndex).toBe(1);
  });

  it('cancel() drops a flip without committing it', () => {
    const c = make();
    c.goNext();
    c.tick(16);
    c.cancel();
    expect(c.stateIndex).toBe(0);
    expect(c.frame().flip).toBeNull();
    expect(c.tick(16)).toBe(false);
  });

  it('survives a resize mid-drag', () => {
    const c = make();
    c.beginDrag('forward', 'top', restCorner(metrics, 'top'));
    c.dragTo({ x: 0, y: 100 });
    c.setMetrics({ width: 200, height: 300 });
    c.dragTo({ x: -50, y: 80 });
    const { corner, progress } = c.frame().flip!.fold;
    expect(Math.hypot(corner.x, corner.y)).toBeLessThanOrEqual(200 + 1e-9);
    expect(progress).toBeGreaterThanOrEqual(0);
    expect(progress).toBeLessThanOrEqual(1);
    c.endDrag(0);
    expect(() => settle(c)).not.toThrow();
  });

  it('lands the corner where it should when a flip completes', () => {
    const c = make();
    c.goNext();
    settle(c);
    const target = turnedCorner(metrics, 'top');
    expect(target.x).toBe(-metrics.width);
  });
});
