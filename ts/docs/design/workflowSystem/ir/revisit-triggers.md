# Revisit triggers

A consolidated index of v1 design decisions that were closed with an
explicit condition under which they should be reopened. Each row names
the decision, the chosen v1 position, the trigger (the observation in
practice that would justify reopening), and the source where the
analysis lives.

This is a living index. When a decision is recorded with a deferred
alternative and a "trigger to revisit" clause, add a row here so the
condition is discoverable without reading every §8.x subsection or
decision record.

| #   | Topic                                                            | v1 position                                                                          | Trigger to revisit                                                                                                                                                                                                                | Source                                                                                                                                              |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Type-system encoding (JSON Schema vs. compact custom IR)         | JSON Schema everywhere                                                               | IR size or author friction at scale becomes a real problem. Then a compact custom type IR (Option C) can be introduced as an alternative encoding that lowers to JSON Schema for runtime validation. Additive only.             | [ir-v1.md §8.1 notes](ir-v1.md) (post-v1 note 2)                                                                                                |
| 2   | Branch model (discriminant switch vs. predicate `if/else`)       | Discriminant switch with required `default`                                          | Profiling shows per-decision task dispatch is a hot path (e.g., very tight branches inside large loops). A restricted predicate form (Alt A) may be reintroduced as an additive performance escape hatch, with its own P5 review. | [ir-v1.md §8.3](ir-v1.md) (post-v1 note)                                                                                                        |
| 3   | Default-branch requirement (always required vs. enum-exhaustive) | `default` always required                                                            | Enum-based exhaustiveness becomes trusted enough that the default can be relaxed for enum-typed selectors only.                                                                                                                   | [ir-v1.md §8.3 Alt B](ir-v1.md) and §10 item 4                                                                                                  |
| 4   | Handler reuse (per-trigger vs. shared)                           | Exactly one trigger per handler                                                      | Patterns demand a single handler reachable from multiple triggers (P4 scenario 35). Shared handlers with intersection-of-dominators semantics (Alt A) become the natural extension.                                               | [ir-v1.md §8.7](ir-v1.md), [§8.11](ir-v1.md), and §10 item 7                                                                                  |
| 5   | IR format (JSON vs. YAML vs. typed IR)                         | JSON                                                                                 | Authoring friction makes YAML or a typed surface compelling. YAML can land as authoring sugar without changing the IR; a typed IR would be a separate decision.                                                                   | [ir-v1.md §8.14](ir-v1.md) and §10 item 9                                                                                                       |
| 6   | Task schema source of truth (omission-as-sugar)                  | IR is restatement-or-narrowing of the task envelope; schemas are required on nodes | IR size becomes a pain point: most nodes restate their task's schemas verbatim and no DSL absorbs the cost. Option 3 (loader-expanded omission sugar) is the pressure-relief valve and reuses the chosen drift check unchanged.   | [decisions/0003-task-schema-source.md](decisions/0003-task-schema-source.md) ("Triggers to revisit Option 3"); [ir-v1.md §8.16 Alt C](ir-v1.md) |

## Adjacent: open knobs awaiting reviewer input

[ir-v1.md §10](ir-v1.md) lists items that are open in a different
sense - the v1 design picked one of several principle-aligned options
without an external trigger required to revisit. Some entries appear in
both lists when a decision is both reviewer-adjustable now and has a
post-v1 trigger; the §10 entry tracks the immediate review question and
the row above tracks the longer-term reopening condition.

## Adjacent: post-v1 features (not "revisit", but "add when needed")

[ir-v1.md §2.2](ir-v1.md) lists features deliberately deferred from
v1 (sub-workflow calls, capability declarations, parallelism
annotations, block scope, nested loops, ...). Those are additive
post-v1 work, not reopenings of a closed v1 decision, and live in their
own table. Use this revisit-triggers index for "the v1 decision was X
and may need to flip to Y if Z is observed."
