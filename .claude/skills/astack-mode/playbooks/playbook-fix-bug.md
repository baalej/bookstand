---
name: fix-bug
description: Fix a bug—reproduce, trace to root, fix at root, verify, encode lesson.
type: playbook
---

# Playbook: Fix a Bug

**Use it when:**
- "This feature is broken; help me fix it"
- "I found a bug; I want to fix it properly, not patch it"
- "Something is crashing; find and fix the root cause"

**Principles:**
- Root Causes, Not Symptoms (trace to root, fix there)
- Quality Over Speed (prove the fix is correct)
- Sequence Verifiable Units (minimal change, clear commit)
- Encode Lessons in Structure (prevent the bug class)

---

## Step 1: Reproduce

**What to do:**
- Trigger the bug on the real artifact
- Document exact steps to reproduce
- Confirm the bug is real, not a one-off fluke
- Principle: Root Causes, Not Symptoms

**How to verify:**
- Reproducible steps documented
- Bug happens consistently under those conditions

---

## Step 2: Trace to Root

**What to do:**
- Ask "why" repeatedly until you reach the root cause
- Not: "The query returned null" → add a nil-check
- But: "The query returned null because..." → trace until you find the design flaw
- Principle: Root Causes, Not Symptoms

**How to verify:**
- Root cause document showing the reasoning chain
- Each "why" is justified by evidence, not assumption

---

## Step 3: Fix at Root

**What to do:**
- Fix the thing that's broken, not the symptom
- If the root is a data model flaw, fix the model
- If the root is missing validation, add validation at the boundary
- Don't add guards that hide problems; prevent the problem
- Principle: Root Causes, Not Symptoms, Quality Over Speed

**How to verify:**
- Code change that addresses the root, not the symptom
- No nil-checks added as a workaround; design fixed instead

---

## Step 4: Verify the Fix

**What to do:**
- Run the reproduction steps again; bug is gone
- Run existing tests; they still pass
- Check for similar bugs elsewhere in the codebase (Principle: Encode Lessons)
- If you find the same pattern elsewhere, fix all instances
- Principle: Quality Over Speed, Prove It Works

**How to verify:**
- Bug no longer reproduces
- Tests pass; no regressions
- Similar bugs checked and addressed

---

## Step 5: Encode the Lesson

**What to do:**
- If this bug is a class that could happen again, encode it:
  - Lint rule to catch it
  - Test that prevents regression
  - Schema/type constraint to make it impossible
- Principle: Encode Lessons in Structure

**How to verify:**
- Preventive measure in place
- Test added that would catch this bug if reintroduced

---

## Step 6: Handoff

**What to do:**
- Commit message explains the bug, root cause, and fix
- Link to any incidents or tickets that triggered this
- Note any related patterns fixed
- Principle: Sequence Verifiable Units

**How to verify:**
- Commit that a reviewer can trace from bug to root to fix
- All related bugs are addressed in the same PR
