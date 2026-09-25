---
name: details-compound
description: How it feels is part of whether it works. Craft is a quality gate, not a finishing pass.
disable-model-invocation: true
---

# Details Compound

**Rule:** Work that is correct, fast, secure, and maintainable can still be wrong. If it feels cheap, jarring, or unresponsive, it is not done. Feel is the fifth quality gate, held to the same standard as the other four.

**Feel means responsive, not animated.** A button that changes state instantly with no transition passes this gate. A button with a beautiful 200ms curve that doesn't acknowledge the press fails it. Motion is one way to satisfy the gate, and often not the right one.

**When to apply:** Anything a person looks at or touches—interfaces above all, but also CLI output, error messages, docs. During design and build, not only at the end.

## Why this is a principle and not a preference

Most craft details are never consciously noticed. That is the point: a user who notices nothing proceeds without hesitating. The value is in the aggregate, so no single detail can justify itself under interrogation—"does anyone really care about the transform origin?" is unanswerable one detail at a time, and irrelevant. Craft is justified as a standard you hold, the way you hold correctness. You do not defend individual assertions in a test suite either.

## Core requirements

### 0. Some products want almost no motion.

Before asking whether this element should move, ask whether this product should. Motion is a house style, not a universal good.

- **Dense, high-frequency tools**—admin panels, data grids, trading and monitoring surfaces, internal dashboards—are used by people repeating the same action hundreds of times a day. Near-zero motion is the correct answer there, not an unfinished one.
- **Content and documentation sites** earn motion only at the rare tier: a first-scroll reveal, never a transition on every navigation.
- **Consumer surfaces, onboarding, and first-run flows** are where a motion budget actually pays.

A product with no animation and instant, correct feedback satisfies this principle completely. **"It doesn't animate" is never itself a finding.**

This gate runs once per product, not once per element, and its answer constrains every decision below it.

### 1. Every moving thing answers "why does this move?"

Motion costs the user attention and delays their next action. Spend it only when it buys something: **feedback** (the interface confirms it heard them), **spatial consistency** (a thing leaves the way it arrived, so their model of where it went stays true), **state indication**, **continuity** (preventing a jarring appearance), or **explanation**.

"It looks cool" is valid only for things seen rarely. Repetition converts motion into latency—the first time a thing animates it informs, the hundredth time it is a toll. Never animate an action the user triggers from the keyboard; they are already moving faster than the animation.

### 2. Responsiveness is not optional; motion is.

Anything pressable must acknowledge the press immediately. That is closer to correctness than to polish—an element that does not react reads as broken. Motion is the part you can cut. Acknowledgement is not.

### 3. Decide agnostically, bind to the stack last.

Whether it moves, what it buys, how long it takes, where it originates, how it interrupts and exits—these are facts about human perception and transfer between platforms. The syntax does not. Do not copy values from another stack without re-deriving whether the decision behind them applies to yours. Principle: Tech-Agnostic Approach.

### 4. Taste that lives only in your head will regress.

Once the project's motion character is settled, encode it: named tokens for curves and durations, a lint rule for the failure mode you keep fixing, a component that owns the press feedback so no caller can forget it. Otherwise the next contributor—or the next agent—resets it to defaults. Principle: Encode Lessons in Structure.

### 5. Reduced motion is correctness, not charity.

Honor the platform's reduced-motion setting. Reduced does not mean none: keep the transitions that carry meaning, drop the ones that move things through space.

## Signals to watch for

- Declaring interface work done without having used it yourself, on real hardware.
- Motion added because the component "felt empty" rather than to buy something.
- The same duration on enter and exit. (The system should leave faster than it arrives.)
- A value copied from a blog post without re-deriving it.
- "We'll polish it later." Polish deferred is polish deleted.
- Craft decisions that exist only in a reviewer's memory, with nothing enforcing them.

## Anti-patterns to avoid

- **Polish as a phase**: Treating feel as a pass at the end rather than a gate at each step. By then the structure fights you.
- **Decoration over communication**: Motion that draws attention without informing. If removing it loses nothing, remove it.
- **Defaults as decisions**: Shipping whatever the framework does because nobody chose otherwise. A default is a decision you did not make.
- **Craft without a budget**: Polishing the rare path while the hot path still jars. Spend attention where frequency is highest, then where stakes are.
- **Taste by assertion**: "This feels off" with no follow-up. Name the property and the moment, or keep observing.
