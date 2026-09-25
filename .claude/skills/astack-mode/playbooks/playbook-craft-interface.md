---
name: craft-interface
description: Make an interface feel right—inventory what should and shouldn't move, decide, build against tokens, verify by eye, encode the taste. Build, debug, or audit.
type: playbook
---

# Playbook: Craft the Interface

**Use it when:**
- "Animate this" / "make this feel alive"
- "This works but it feels cheap"
- "Should anything here animate?"
- "Audit the motion in this app"
- "Polish this before we ship"

**Not for:** building the feature itself (use Build), choosing the architecture
behind it (use Design), or reviewing a diff before you ship (use Review — its
step 4 routes into `web-motion`).

**Principles:**
- Details Compound (feel is a quality gate; the product gate runs before the element gate)
- Laziness Protocol (the best motion decision is usually "none")
- Tech-Agnostic Approach (decide agnostically, bind to the stack last)
- Encode Lessons in Structure (taste that isn't encoded regresses)
- Quality Over Speed (observation is the proof, and it isn't optional)

---

## Modes

Three entry points, one playbook. **Announce which mode you read the request as
before running step 1** — one line, so a wrong read costs a word to correct
instead of three steps to discover.

| Mode | You said | Steps | Ends with |
|---|---|---|---|
| **Build** | "animate this", "make this feel alive" | 1 → 2 → 3 → 4 → 5 → 6 | Implementation, or a reasoned refusal |
| **Debug** | "this feels off", "why does this look wrong" | 1 → 5 → 3 → 4 → 5 → 6 | Findings table, then the fix |
| **Audit** | "audit the motion", "what should animate here" | 1 → 2 → 3, stop | A prioritized plan and a do-not-animate list. No code |

Audit is read-only. If it produces code, it was a Build.

---

## Step 1: Ground in the Artifact

**What to do:**
- Use the thing yourself, as a user, doing the real task end to end. On physical
  hardware if it is ever touched
- Write down what felt wrong before analyzing why — first impressions are
  perishable and you get one
- **Run the product gate** (`/details-compound`, requirement 0): does this
  product want motion at all? A dense internal tool, a data grid, a docs site
  may correctly have almost none. If the answer is "near-zero," say so now and
  scope the rest of the playbook to responsiveness rather than motion
- Bind to the stack: what primitives does the platform offer, what does this
  project already use, what tokens exist, what is the cheap path?
  (`/web-motion`, hard rules)

**How to verify:**
- A list of specific moments that felt wrong, in the order you hit them
- The product gate answered explicitly, not assumed
- You have used it, not just read it

---

## Step 2: Inventory the Interactions

**What to do:**
- List every state and every transition in scope — including the ones that
  currently have no motion at all
- Tag each with **how often one user sees it**: many times an hour, many times
  a day, occasionally, rarely
- Build the **do-not-animate list** explicitly: keyboard-driven actions,
  anything committed to muscle memory, anything whose purpose you can't name.
  This is a first-class output, not a leftover
- Mark anything pressable that doesn't acknowledge a press — that's a
  correctness bug, not a polish item, and it gets fixed regardless of mode
- Principle: Laziness Protocol — this step should shorten the list, not grow it

**How to verify:**
- A table of transitions with a frequency tag on each
- A do-not-animate list with a reason per entry
- **Valid outcome: nothing here should animate.** Say it and stop; that is a
  result, not a failure

---

## Step 3: Decide Before You Build

**What to do:**
- For each survivor, walk the decisions in order: what does it buy, which curve
  character, what duration budget, where does it originate, how does it
  interrupt, how does it exit, how does it degrade (`/web-motion`, §1–6)
- Record each decision in words before any syntax — "decelerate, ~180ms, grows
  from the trigger, interruptible, exits downward"
- If you can't name what a motion buys, cut it here
- **Audit mode ends at this step.** Order the findings by leverage — the curve
  that makes every dropdown feel sluggish outranks a one-off — and write each as
  a self-contained change someone else could execute without your context

**How to verify:**
- Every candidate has a written decision or an explicit cut
- The cut list is not empty
- Audit: a prioritized plan, each item executable standalone, plus the
  do-not-animate list from step 2

---

## Step 4: Build Against Tokens

**What to do:**
- Name the project's curves and durations if they don't exist; extend them if
  they do. Keep the set small — three or four curves cover a product
- Implement referencing token names, never raw values (`/web-motion`, §3)
- Put shared behavior where it can't be forgotten: press feedback belongs to the
  button component, not to every caller
- Stay on the cheap path — compositor properties, not layout
  (`web-motion` → `references/performance.md`)
- Principle: Code is Documentation. A named curve says what it's for; a raw
  `cubic-bezier` says nothing

**How to verify:**
- No raw curve or duration literals at call sites
- The token set is small enough to hold in your head
- Shared behavior owned by one place
- Confirmed on the cheap path in the profiler — not assumed from the property name

---

## Step 5: Verify By Eye

**What to do:**
- Run the passes: use it as a user, slow it down, step the frames, real hardware
  under real conditions, the degradation passes (`/verify-by-eye`)
- Do it wrong on purpose: retrigger fast, interrupt halfway, reverse mid-gesture
- Check reduced motion, touch vs. pointer, keyboard-only, longest content,
  empty and error states
- Sleep on it and look again with fresh eyes before calling it done
- **Debug mode starts here** — the passes are how you turn "it feels off" into a
  named property and a named moment, then return to step 3 to decide the fix

**How to verify:**
- Each pass run, findings recorded as before/after/why rows with `file:line`
- Every finding names a property and a moment, not a feeling
- The fresh-eyes pass happened, on a different day
- Findings fixed, not filed

---

## Step 6: Encode and Handoff

**What to do:**
- Encode the failure modes you actually hit: a lint rule for the curve you keep
  fixing, a shared component that makes the wrong thing unavailable
- Document the motion character — the tokens, one line each on what they're for
- Decision log: what moves, what deliberately does not, and why. **The
  "does not" half is the more valuable one** — it's what stops the next
  contributor, or the next agent, from adding motion you deliberately refused
- Principle: Encode Lessons in Structure

**How to verify:**
- At least one lesson enforced by tooling, not by memory
- Token set documented where someone will find it
- Someone else could extend this interface, stay in character, and know what not
  to touch — without asking
