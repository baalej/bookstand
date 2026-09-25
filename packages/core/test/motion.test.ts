import { describe, expect, it } from 'vitest';
import { Spring, projectedRest } from '../src/motion/spring.js';
import { VelocityTracker } from '../src/motion/velocity.js';

/** Run a spring to rest at a given frame interval; return value history. */
function run(spring: Spring, frameMs: number, maxFrames = 2000): number[] {
  const out: number[] = [];
  for (let i = 0; i < maxFrames; i++) {
    const moving = spring.step(frameMs);
    out.push(spring.value);
    if (!moving) break;
  }
  return out;
}

describe('spring', () => {
  it('converges on the target', () => {
    const s = new Spring({ stiffness: 220 });
    s.target = 1;
    const history = run(s, 1000 / 60);
    expect(history.length).toBeGreaterThan(1);
    expect(s.value).toBe(1);
    expect(s.velocity).toBe(0);
  });

  it('does not overshoot when critically damped', () => {
    const s = new Spring({ stiffness: 220 });
    s.target = 1;
    for (const v of run(s, 1000 / 60)) expect(v).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('behaves the same at 60 Hz and 120 Hz', () => {
    // A spring integrated with the raw frame delta is stiffer on a 120 Hz
    // display. The fixed substep is what prevents that, and this is the test
    // that would catch its removal.
    //
    // Compared in lockstep — one 60 Hz frame against two 120 Hz frames — so
    // both springs have received exactly the same elapsed time at every
    // assertion. Sampling on wall-clock thresholds instead would compare
    // different moments and prove nothing.
    const a = new Spring({ stiffness: 220 });
    const b = new Spring({ stiffness: 220 });
    a.target = 1;
    b.target = 1;

    let frames = 0;
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      const movingA = a.step(1000 / 60);
      b.step(1000 / 120);
      const movingB = b.step(1000 / 120);
      worst = Math.max(worst, Math.abs(a.value - b.value));
      frames++;
      if (!movingA && !movingB) break;
    }

    expect(frames).toBeGreaterThan(10);
    // The fixed substep makes this exact, not merely close. Dropping it takes
    // the divergence to ~4e-2, four orders of magnitude past this bound.
    expect(worst).toBeLessThan(1e-6);
    expect(a.value).toBe(b.value);
  });

  it('carries initial velocity', () => {
    const fast = new Spring({ stiffness: 220 });
    fast.target = 1;
    fast.reset(0, 6);
    const slow = new Spring({ stiffness: 220 });
    slow.target = 1;
    slow.reset(0, 0);

    fast.step(1000 / 60);
    slow.step(1000 / 60);
    expect(fast.value).toBeGreaterThan(slow.value);
  });

  it('reports settled immediately when already at target', () => {
    const s = new Spring({ stiffness: 220 });
    expect(s.step(16)).toBe(false);
  });

  it('survives a long frame gap without exploding', () => {
    const s = new Spring({ stiffness: 220 });
    s.target = 1;
    s.step(5000); // backgrounded tab
    expect(Number.isFinite(s.value)).toBe(true);
    expect(s.value).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('projectedRest', () => {
  it('projects a flick past the halfway line from short travel', () => {
    // The case StPageFlip gets wrong: 20% travelled, moving fast.
    expect(projectedRest(0.2, 0, 220)).toBeLessThan(0.5);
    expect(projectedRest(0.2, 8, 220)).toBeGreaterThan(0.5);
  });

  it('projects a slow drag past halfway back below it', () => {
    expect(projectedRest(0.6, -4, 220)).toBeLessThan(0.5);
  });
});

describe('velocity tracker', () => {
  it('needs two samples', () => {
    const v = new VelocityTracker();
    expect(v.get()).toEqual({ x: 0, y: 0 });
    v.add(0, 0, 0);
    expect(v.get()).toEqual({ x: 0, y: 0 });
  });

  it('measures units per second', () => {
    const v = new VelocityTracker();
    v.add(0, 0, 0);
    v.add(100, 50, 100);
    expect(v.get().x).toBeCloseTo(1000, 6);
    expect(v.get().y).toBeCloseTo(500, 6);
  });

  it('follows a late acceleration instead of averaging it away', () => {
    // Slow drag, then a flick right at the end. The window must report the
    // flick — this is precisely the gesture that decides a release.
    const v = new VelocityTracker(100);
    for (let t = 0; t <= 500; t += 50) v.add(t * 0.02, 0, t); // 20 units/s
    v.add(60, 0, 550);
    expect(v.get().x).toBeGreaterThan(200);
  });

  it('ignores zero-duration bursts', () => {
    const v = new VelocityTracker();
    v.add(0, 0, 10);
    v.add(50, 0, 10);
    expect(v.get()).toEqual({ x: 0, y: 0 });
  });

  it('resets', () => {
    const v = new VelocityTracker();
    v.add(0, 0, 0);
    v.add(100, 0, 100);
    v.reset();
    expect(v.get()).toEqual({ x: 0, y: 0 });
  });
});
