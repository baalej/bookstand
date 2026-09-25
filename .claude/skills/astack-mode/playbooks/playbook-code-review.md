---
name: code-review
description: Code review—automated checks, clarity, end-to-end test, principle checks, patterns.
type: playbook
---

# Playbook: Code Review (Your Own)

**Use it when:**
- "Review my code before I commit/PR"
- "Is this code quality up to standard?"
- "Help me find issues I missed"

**Principles:**
- Quality Over Speed (catch issues before shipping)
- Code is Documentation (clarity, naming, comments)
- Root Causes, Not Symptoms (don't accept surface-level fixes)
- All 12 principles (this is your quality gate)

---

## Step 1: Run Automated Checks

**What to do:**
- Linting passes (style, conventions)
- Type checking passes (if applicable)
- Tests pass
- Performance: measure against baseline; confirm it meets requirements
- Security: no obvious vulnerabilities (logging secrets, SQL injection, etc.)

**How to verify:**
- All checks pass
- Baseline comparison recorded
- No security red flags

---

## Step 2: Read Your Code Like a Stranger

**What to do:**
- Open the PR/diff as if you've never seen this code
- Can you understand it in 5 minutes?
- Are names clear? Is structure obvious?
- Do you need comments to understand what it does?
- Principle: Code is Documentation

**How to verify:**
- Clarity checklist passed
- Comments only explain WHY, not WHAT
- No confusing variable names or unclear structures

---

## Step 3: Test End-to-End

**What to do:**
- Run the feature on the real artifact
- Test happy path, edge cases, error cases
- Measure performance; confirm it meets spec
- Observe real behavior; don't just trust tests
- For interface changes, observation is the proof and it has a method: `verify-by-eye`
- Principle: Quality Over Speed, Prove It Works

**How to verify:**
- End-to-end test log
- Performance data matches spec
- No crashes or unexpected behavior

---

## Step 4: Check Against Principles

**What to do:**
- Does the code follow your 12 principles?
- Is this the root fix or a symptom patch? (Root Causes)
- Could this be smaller? (Laziness)
- Are data structures sound? (Foundational Thinking)
- Is the implementation verifiable? (Sequence Verifiable Units)
- If the diff touches motion or anything a user sees: walk the Never Ship table and propose the earliest fix in the remedial order — deleting outranks fixing (`web-motion` → Reviewing motion)
- Principle: All 12 principles are your quality gate

**How to verify:**
- Principle checklist passed
- Each principle is satisfied

---

## Step 5: Look for Patterns

**What to do:**
- Is this code duplicating logic elsewhere?
- Could this lesson be encoded? (lint rule, type, test)
- Are there similar patterns that should be unified?
- Principle: Encode Lessons in Structure

**How to verify:**
- Any duplication identified
- Similar patterns noted for future consolidation

---

## Step 6: Decision: Ship or Fix

**What to do:**
- If all checks pass: ship it
- If checks fail: fix it before shipping
- Don't accept "we'll fix this in a follow-up PR" for quality issues
- Quality is non-negotiable

**How to verify:**
- Checklist signed off
- Code ships only if passing all quality gates
