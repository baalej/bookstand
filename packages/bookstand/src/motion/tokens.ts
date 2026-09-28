/**
 * The motion character of a Bookstand book.
 *
 * Three springs and four scalars. Everything that moves references a name from
 * here — no call site carries a raw stiffness or threshold, so the feel can be
 * retuned in one place and cannot drift apart across modules.
 *
 * Springs rather than curves and durations, because every motion here is
 * gesture-driven: it has to carry the velocity the hand gave it and reverse
 * cleanly when the reader changes their mind mid-drag. A duration cannot.
 */

export interface SpringToken {
  stiffness: number;
  /** Omitted means critical damping (2·√k) — settles fast, never overshoots. */
  damping?: number;
}

export const springs = {
  /**
   * Completing a flip. The heaviest of the three: this is the reader's intent
   * being fulfilled, and paper has mass.
   *
   * Measured at this value: 50% in 100 ms, 90% in 217 ms, landed at 433 ms.
   * Longer than the sub-300 ms budget that governs dropdowns and popovers,
   * and deliberately so — this is not UI chrome reacting, it is the content
   * itself moving under simulated physics, and it is the one motion the
   * reader is actually watching.
   */
  settle: { stiffness: 340 },

  /**
   * Falling back from a drag that didn't earn the turn. Stiffer than `settle`
   * on purpose — a refusal should get out of the way faster than a
   * confirmation arrives. Lands at ~383 ms against settle's 433 ms.
   */
  recoil: { stiffness: 480 },

  /**
   * The corner lifting under a hovering cursor. Softest of the three — it is a
   * hint that the page can be grabbed, not an event in its own right — but not
   * so soft that the rise lags the cursor that summoned it. At 160 the lift
   * took ~650 ms, long enough to read as the page ignoring you.
   */
  peek: { stiffness: 300 },
} as const satisfies Record<string, SpringToken>;

export type SpringName = keyof typeof springs;

export const gesture = {
  /**
   * Travel, in CSS px, before a press commits to dragging rather than tapping.
   *
   * Distance, not time. StPageFlip gates its touch path behind a 250 ms timer
   * and measures 278 ms before the page moves at all; a distance lock reaches
   * the same decision on the first move that proves intent.
   */
  intentLockPx: 6,

  /**
   * Progress per second above which a release completes the turn however
   * little distance it covered.
   *
   * Without this a confident flick fails: the reference turns a 140 px drag
   * into the same outcome at 90 ms and at 700 ms.
   */
  flickVelocity: 1.6,

  /**
   * How far the corner lifts on hover at its deepest, as a fraction of page
   * width. Reached when the cursor is on the corner, not when it is far away.
   */
  peekDepth: 0.15,

  /** Corner region that arms the peek, as a fraction of the page diagonal. */
  peekZone: 0.3,

  /** Hard ceiling on a settle, ms. A safety net, not the usual path. */
  maxDuration: 900,
} as const;

export type GestureTokens = typeof gesture;
