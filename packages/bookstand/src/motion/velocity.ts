interface Sample {
  x: number;
  y: number;
  t: number;
}

/**
 * Pointer velocity over a short trailing window.
 *
 * A sliding window rather than the EMA the plan sketched: for flick detection
 * what matters is the speed over the last few frames, and an EMA seeded from a
 * slow drag lags badly when the finger accelerates just before release —
 * exactly the gesture we most need to catch.
 */
export class VelocityTracker {
  private samples: Sample[] = [];

  constructor(private readonly windowMs = 100) {}

  reset(): void {
    this.samples.length = 0;
  }

  add(x: number, y: number, t: number): void {
    this.samples.push({ x, y, t });
    const cutoff = t - this.windowMs;
    let drop = 0;
    while (drop < this.samples.length - 2 && this.samples[drop]!.t < cutoff) drop++;
    if (drop > 0) this.samples.splice(0, drop);
  }

  /** Units per second. Zero if there isn't enough signal to be confident. */
  get(): { x: number; y: number } {
    if (this.samples.length < 2) return { x: 0, y: 0 };
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }
}
