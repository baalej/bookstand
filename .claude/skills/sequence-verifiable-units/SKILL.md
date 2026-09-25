---
name: sequence-verifiable-units
description: Break work into small units. Each independently verifiable. Sequence proves correctness.
disable-model-invocation: true
---

# Sequence Verifiable Units

**Rule:** Break work into small, independently verifiable units. Each unit should end in a verifiable state. Order the units so the sequence proves the work is correct—the earlier units don't break the later ones, and each step is reviewable in isolation.

**When to apply:** When planning multi-step work (migrations, sweeps, large refactors), when structuring commits and PRs, when designing playbooks, when work spans multiple related changes.

## Core requirements

### 1. Each unit must be independently verifiable.

- A unit should stand on its own. You should be able to stop after unit 1 and have correct, working code.
- Running the tests for unit 1 should pass. Unit 1 should not depend on units 2-3 to be correct.
- If a unit requires changes elsewhere to work, it's not a verifiable unit—split it differently.

### 2. Order matters: sequence them so early units enable later ones.

- Don't rewrite the caller before the implementation is ready.
- Do: Implement the new API → unit 1 (verifiable). Then migrate callers → unit 2 (verifiable). Then delete old API → unit 3 (verifiable).
- If the sequence breaks (unit 2 would break unit 1), reorder.
- A good sequence is a proof: "this was done correctly" by construction.

### 3. Small enough to review, understand, and revert.

- A unit should be reviewable in 10-30 minutes.
- A reviewer should be able to understand the complete change and why it's correct.
- If a single commit breaks the sequence, it should be small enough to revert without collateral damage.
- If a unit is too large to understand in one pass, split it.

### 4. Verify at each step, not at the end.

- After unit 1 completes: run tests, measure performance, check security. Don't defer.
- If unit 1 breaks, don't push to unit 2 hoping to fix it later.
- Early discovery of problems is cheaper than discovering them at the end.

### 5. Commit messages document the unit's purpose.

- Each commit should explain what it does and why (the principle it follows).
- A reviewer reading the commit messages should understand the overall work without reading code.
- Commit history is the narrative of the work; make it clear.

## Signals to watch for

- A PR that does five things in one commit. (Split into verifiable units.)
- A change that only makes sense if the next change lands. (Reorder so this one stands alone.)
- "This commit breaks tests, but the next one fixes it." (No. Each unit should pass tests.)
- A migration where old and new code coexist "until everything is migrated." (Migrate → verify → delete. One caller at a time, not all at once.)
- A giant commit with a vague message. (Break into small units with specific messages.)
- Reviewers saying "I don't understand why this change is necessary." (Commit message and unit ordering should make it obvious.)

## Anti-patterns to avoid

- **Monolithic changes**: One giant commit that does the whole thing at once. Hard to review, hard to revert.
- **Backwards compatibility shims**: Preserving old code "until everything is migrated." (Delete it as you migrate; one caller per unit.)
- **Broken intermediate states**: A unit that only works if the next unit lands.
- **Vague sequencing**: Multiple approaches that could work, but the ordering isn't justified.
- **Deferred verification**: "We'll test this sequence once everything is done." (Test after each unit.)
- **Large, complex units**: A unit that's hard to understand or review because it does too much.
