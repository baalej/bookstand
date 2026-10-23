---
name: handoff
description: The terminal playbook. Invoked as the last step of every other playbook—write the decision log, label the evidence, and write the reply.
type: playbook
---

# Playbook: Handoff

**Invoked at the end of every other playbook.** Not matched directly from a
user request. Each playbook's final step routes here, then adds only what is
unique to that playbook.

**Principles:**
- Code is Documentation (the artifact carries its own explanation)
- Sequence Verifiable Units (history reads in the order the work was proved)
- Encode Lessons in Structure (a lesson left in prose is a lesson lost)

A handoff is not a summary of what you did. It is what the next person needs in
order to continue, disagree, or undo. Write it for a reader who has none of your
context and no ability to ask you a question.

---

## 1. Label every claim

Each claim in the handoff and in the reply carries its evidence or its label in
the same sentence. Three labels, no others:

| Label | Means | Example |
|---|---|---|
| **Measured** | You ran it and read the result | "Login p50 dropped from 410ms to 180ms, measured over 200 requests" |
| **Inferred** | Follows from evidence you have, but you did not observe it directly | "Inferred: the same N+1 affects the admin list, which shares the loader" |
| **Guess** | A prediction, or a cause you have not confirmed | "Guess: the stall is GC, unconfirmed" |

An unlabeled claim reads as measured. If you did not measure it, label it.

Never hand over a check you could have run. If a claim is a guess and running
something would settle it, run it before writing the handoff.

---

## 2. Write the decision log

Four parts. A part that genuinely does not apply keeps its heading with one line
saying why, rather than being dropped.

- **Decisions.** What was chosen and why. Name the alternatives you rejected and
  what would have to change for one of them to win. A decision with no rejected
  alternative was not a decision.
- **Assumptions.** What might be wrong, and the early signal that would tell you.
  An assumption with no signal is a liability.
- **Tradeoffs.** What this optimizes for and what it gives up. Name who pays.
- **Next steps.** What comes next, and what was deliberately cut. The cut half
  matters more: it stops the next contributor re-adding what you refused.

---

## 3. Make the history readable

- Commits in the order the work was proved, per
  [Sequence Verifiable Units](../../sequence-verifiable-units/SKILL.md). For a
  bug fix, the failing repro lands before the fix.
- Each commit message says what changed and why, never how.
- The commit or PR description carries the verification: what you ran, and its
  output. Paste it verbatim rather than describing it.
- Link only artifacts you produced or read this session. Never fabricate a link,
  a citation, or a reference to a transcript.

---

## 4. Encode anything that will recur

If the work turned up a rule, a constraint, or a mistake you expect to see
again, encode it now as a type, lint rule, test, or schema, per
[Encode Lessons in Structure](../../encode-lessons-in-structure/SKILL.md).

A lesson recorded only in this handoff will not survive. If you cited that
principle, the diff contains the guardrail. If it does not, you did not apply it.

---

## 5. Write the reply

Per the reply conventions in [astack-mode](../SKILL.md). Terse is not an excuse
to drop content: short sentences, but every section the originating playbook's
reply line names stays.

**How to verify the handoff:**
- Someone with none of your context could continue, disagree, or undo
- Every claim is labeled or carries its evidence
- The rejected alternatives are named, not just the choice
- The deliberate cuts are written down
- No claim is a guess that a command you could have run would have settled
