# Design principles

Three principles have emerged during the TypeAgent investigation. Each applies
across the project's three pillars — **actions**, **memory**, and **plans**.

## 1. Distill models into logical structures

Replace model calls with patterns wherever a pattern can be discovered.

- **Actions** — find translation patterns and replace some model calls by
  applying those patterns (this is what the action grammar and cache do).
- **Memory** — build ontologies from text.
- **Plans** — people, programs, and models collaborate using "tree of
  thought".

## 2. Use structure to control information density

Tight structure keeps the relevant information inside the model's attention
budget.

- **Actions** — applications define discrete categories with dense
  descriptions of their action sets (the typed schemas).
- **Memory** — tight semantic structures fit into the attention budget
  (Structured RAG).
- **Plans** — each search-tree node defines a focused sub-problem.

## 3. Use structure to enable collaboration

Structure lets humans, programs, and models cooperate on the same problem.

- **Actions** — humans decide how to disambiguate action requests.
- **Memory** — simple models extract logical structure from text.
- **Plans** — quality models, advantage models, language models, humans, and
  programs collaborate to expand each best-first-search node.

## AMP: actions, memory, and plans together

Actions and memories flow together. An action like _"add to my calendar a
pickleball game 2–3pm Friday"_ yields a memory that can become a parameter of a
future action like _"put an hour of recovery time after my pickleball game."_
TypeAgent is working toward an architecture, **AMP**, that integrates actions,
memories, and plans so this information flows naturally.

These principles are the _why_ behind much of the architecture documented in
this wiki — most directly the [dispatcher](../architecture/core/dispatcher.md),
[action grammar](../architecture/core/actionGrammar.md), and the memory subsystem.
