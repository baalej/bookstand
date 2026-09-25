---
name: tech-agnostic-approach
description: Principles guide work; adapt recipes to your stack. Works everywhere.
disable-model-invocation: true
---

# Tech-Agnostic Approach

**Rule:** The system works everywhere—any language, framework, platform, or LLM. Principles guide the work, not recipes. Adapt the approach to your tech stack, not the other way around.

**When to apply:** When planning any project, when choosing tools or patterns, when switching between projects with different stacks.

## Core requirements

### 1. Principles are portable; recipes are not.

- A principle like "Root Causes, Not Symptoms" applies to Python, Go, JavaScript, Rust equally.
- A recipe like "use TypeScript for type safety" doesn't work in JavaScript without TypeScript; use a different mechanism (jsdoc, runtime validation, testing discipline).
- Translate the principle into the idioms and tools available in your tech stack.

### 2. Proof methods vary by tech; proof is non-negotiable.

- In a compiled language: the compiler catches type errors. That's part of your correctness proof.
- In an interpreted language: tests and linting catch errors. Those are part of your proof.
- In a UI: visual testing and user flows. In a CLI: integration tests. In a library: unit tests.
- The *method* changes; the *requirement* doesn't.

### 3. Performance and security mean different things across stacks.

- Performant Node.js is different from performant Rust. Both must be measured and justified, but the baselines differ.
- Secure web frontend is different from secure backend API. Both are non-negotiable, but the threats are different.
- Understand your stack's constraints and optimize within them.

### 4. Code-as-documentation applies everywhere.

- Clear names, obvious structure, minimal comments work in all languages.
- If your language has types, use them. If not, compensate with rigorous testing and naming.
- The goal (a reader understands the code in five minutes) is universal; the tools vary.

### 5. Use the best tool for your LLM and model.

- Some models reason better with specific prompting styles. Some excel at code, others at design.
- Don't force one approach across all models; adapt the prompts and reasoning to the model's strengths.
- The principles remain the same; the execution varies.

## Signals to watch for

- Forcing a pattern from one language into another where it doesn't fit. (Adapt it.)
- Saying "we can't do this in language X." (You can; you just need a different approach.)
- Copying recipes from one project to another without adaptation. (Translate the principle, adapt the recipe.)
- Assuming all LLMs work with the same prompts. (They don't. Tailor prompts to the model's strengths.)
- Treating one tech stack as "the right way" and everything else as inferior. (Different stacks have different tradeoffs.)

## Anti-patterns to avoid

- **Stack chauvinism**: Assuming your current stack's patterns are universal.
- **Dogmatic recipes**: Insisting on one tool or pattern across all projects.
- **Lost-in-translation principles**: Translating a principle so far from its intent that it no longer applies.
- **Model-agnostic prompts**: Using identical prompts for Claude, GPT, and other models without adjustment.
- **Proof shortcuts**: Saying "we can't test this language/platform" as an excuse to skip verification.
