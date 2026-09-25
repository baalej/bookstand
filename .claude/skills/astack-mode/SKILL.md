---
name: astack-mode
description: Main entry point for astack. Matches tasks to playbooks and orchestrates work.
---

# astack-mode

Your personal engineering system for shipping high-quality code. Start here.

## How it works

Type `/astack-mode` with your task. This skill:

1. **Matches your task to a playbook** (Plan, Design, Build, Fix, Refactor, Review, Learn, Perf, Craft)
2. **Reads that playbook file** from `playbooks/` — the table below maps playbook to file
3. **Opens a todo list** with the playbook's steps
4. **Routes to other skills** when a step needs depth
5. **Stays active** (sticky mode) across turns
6. **Guides execution** using your 12 principles

Do not work from the summaries on this page. Once you've matched a playbook,
read its file before starting — the steps and their verification criteria live
there, not here.

**Announce the match before working.** State which playbook you matched and, if
it has modes, which one you read the request as — in one line, before step 1.
A wrong match costs one word to correct now and three steps to discover later.

## The playbooks

Paths are relative to this skill's directory.

| Playbook | Use when | File |
|---|---|---|
| **Plan/Scope** | Planning a feature end-to-end | `playbooks/playbook-plan-scope.md` |
| **Design** | Designing architecture before coding | `playbooks/playbook-design-architecture.md` |
| **Build** | Building a feature from a design | `playbooks/playbook-build-feature.md` |
| **Fix** | Fixing a bug or issue | `playbooks/playbook-fix-bug.md` |
| **Refactor** | Improving code structure | `playbooks/playbook-refactor.md` |
| **Review** | Reviewing your own code | `playbooks/playbook-code-review.md` |
| **Learn** | Understanding existing code | `playbooks/playbook-learn-understand.md` |
| **Perf** | Optimizing performance | `playbooks/playbook-performance.md` |
| **Craft** | Making an interface feel right — build, debug, or audit motion | `playbooks/playbook-craft-interface.md` |

## The 12 principles

Your system is built on 12 core principles that guide all work. Each is also a
skill of its own — when a playbook step calls for depth on one, invoke it by
name (e.g. `/root-causes-not-symptoms`) to get the full treatment.

| Principle | In short | Skill |
|---|---|---|
| **Quality Over Speed** | Verify robustness; never ship unproven code | `quality-over-speed` |
| **Code is Documentation** | Clear names, obvious structure, minimal comments | `code-is-documentation` |
| **Plans Evolve; Principles Don't** | Pivot when needed, quality standards never change | `plans-evolve-principles-dont` |
| **Root Causes, Not Symptoms** | Fix the thing that's broken, not the symptom | `root-causes-not-symptoms` |
| **Tech-Agnostic Approach** | Principles guide work; adapt recipes to your stack | `tech-agnostic-approach` |
| **Build the Lever** | Automate non-trivial work with scripts, codemods, generators | `build-the-lever` |
| **Encode Lessons in Structure** | Make rules automatic via types, lint, tests, schemas | `encode-lessons-in-structure` |
| **Laziness Protocol** | Delete before adding; smallest change that solves the problem | `laziness-protocol` |
| **Foundational Thinking** | Get data structures right first; logic follows | `foundational-thinking` |
| **Exhaust the Design Space** | Build 2-3 competing prototypes before committing | `exhaust-the-design-space` |
| **Sequence Verifiable Units** | Break work into small, independent, reviewable pieces | `sequence-verifiable-units` |
| **Details Compound** | How it feels is part of whether it works | `details-compound` |

## Depth skills

Not principles — recipe layers and methods a playbook step routes into when it needs one.

| Skill | What it holds | Scope |
|---|---|---|
| `web-motion` | Building and reviewing web motion: tool ladder, property tiers, exact curves and durations, gestures, interruption, reduced motion, the review bar. Plus `references/performance.md` — the compositor/paint/layout tier list. Plus `references/recipes.md` — worked technique implementations. | Web only, by design |
| `verify-by-eye` | The proof method for interfaces: use it, slow it down, step the frames, real hardware, degradation passes, fresh eyes | Agnostic |

## Examples

```
/astack-mode plan this feature end-to-end
```
→ Opens the Plan/Scope playbook, steps 1-6

```
/astack-mode this function is slow; optimize it
```
→ Opens the Performance playbook, steps 1-6

```
/astack-mode I don't understand how this codebase works
```
→ Opens the Learn/Understand playbook

```
/astack-mode review my code before I ship
```
→ Opens the Code Review playbook

```
/astack-mode this works but it feels cheap
```
→ Opens the Craft playbook in Debug mode

```
/astack-mode audit the motion in this app
```
→ Opens the Craft playbook in Audit mode — read-only, output is a plan

## The workflow

1. **Invoke** `/astack-mode` with your task
2. **Read** the playbook steps (they're copied into a todo)
3. **Follow** each step, using principles to guide decisions
4. **Verify** at each step (proofs are required)
5. **Handoff** when done (document for others or future you)

Sticky mode: once invoked, `/astack-mode` stays active. Each new message is checked against playbooks. Say "stop" or "exit" to leave.

## Quality gates (non-negotiable)

All code, always:
- **Performant**: Measured, justified, no unnecessary overhead
- **Secure**: No vulnerabilities, validated at boundaries
- **Correct**: Proofs exist (tests, runs, observations)
- **Maintainable**: Clear names, obvious structure, readable by strangers
- **Felt**: For anything a person looks at or touches — it responds, motion has a purpose, nothing jars, it degrades under reduced motion

If you can't meet these, say so upfront. Don't ship compromised code.

## When to use other commands

Most of the time, use `/astack-mode` and let it route. But you can invoke any of
the 12 principle skills directly if you already know what you need — see the
table above for their names.

## Handoff structure

When a playbook completes, handoff includes:
- **Decision log** — What was decided and why
- **Assumptions** — What might change
- **Tradeoffs** — What we're optimizing for
- **Next steps** — What comes next

Make it so someone else (or future you) can pick it up without questions.

---

Let's ship high-quality code. Start with `/astack-mode` and your task.
