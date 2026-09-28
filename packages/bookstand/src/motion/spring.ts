export interface SpringOptions {
  stiffness: number;
  /** Defaults to critical damping, 2·√k — settles fast without overshoot. */
  damping?: number;
  /** Settle threshold, in value units. */
  precision?: number;
}

/**
 * Default settle threshold.
 *
 * Deliberately loose. A critically-damped spring approaches its target
 * asymptotically, so a tight threshold buys a long tail of motion too small to
 * see: at 0.0005 a page turn reached 90% in 283 ms and then spent a further
 * 484 ms creeping. At 0.004 the same turn lands in 433 ms with the whole tail
 * being motion you can actually perceive. 0.004 of a page turn is under 3 px.
 */
const DEFAULT_PRECISION = 0.004;
/** Velocity must also be small, scaled off the position threshold. */
const VELOCITY_FACTOR = 40;

/** Substep size. Fixed so behaviour is identical at 60 Hz and 120 Hz. */
const H = 1 / 240;
/** Cap on a single frame's dt, so a backgrounded tab doesn't spiral on resume. */
const MAX_DT = 0.064;

/**
 * Critically damped spring on a scalar, integrated at a fixed timestep.
 *
 * The fixed timestep is the point. Integrating with the raw frame delta makes
 * the spring stiffer or softer depending on the display's refresh rate — a bug
 * that only ever reproduces on someone else's machine.
 */
export class Spring {
  value = 0;
  velocity = 0;
  target = 0;

  private k: number;
  private c: number;
  private readonly eps: number;
  private accumulator = 0;

  constructor(options: SpringOptions) {
    this.k = options.stiffness;
    this.c = options.damping ?? 2 * Math.sqrt(options.stiffness);
    this.eps = options.precision ?? DEFAULT_PRECISION;
  }

  /**
   * Retune mid-life, so one spring can serve several motion tokens. Leaves
   * value and velocity alone — retuning during a settle changes how it
   * finishes, it does not restart it.
   */
  configure(options: { stiffness: number; damping?: number }): void {
    this.k = options.stiffness;
    this.c = options.damping ?? 2 * Math.sqrt(options.stiffness);
  }

  reset(value: number, velocity = 0): void {
    this.value = value;
    this.velocity = velocity;
    this.accumulator = 0;
  }

  /** Advance by `dtMs`. Returns true while still in motion. */
  step(dtMs: number): boolean {
    if (this.settled()) return false;

    this.accumulator += Math.min(dtMs / 1000, MAX_DT);
    while (this.accumulator >= H) {
      const a = -this.k * (this.value - this.target) - this.c * this.velocity;
      this.velocity += a * H;
      this.value += this.velocity * H;
      this.accumulator -= H;
    }

    if (this.settled()) {
      this.value = this.target;
      this.velocity = 0;
      this.accumulator = 0;
      return false;
    }
    return true;
  }

  private settled(): boolean {
    return (
      Math.abs(this.value - this.target) < this.eps &&
      Math.abs(this.velocity) < this.eps * VELOCITY_FACTOR
    );
  }
}

/**
 * Where a spring would come to rest if released now — position plus the
 * distance its current velocity will carry it.
 *
 * This is the number the release decision needs. StPageFlip tests position
 * alone (`stopMove`: `pos.x <= 0`), so a fast flick at 20% travel snaps
 * backwards even though the gesture clearly asked for a turn.
 */
export function projectedRest(value: number, velocity: number, stiffness: number): number {
  return value + velocity / Math.sqrt(stiffness);
}
