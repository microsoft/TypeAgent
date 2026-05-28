# Effect Inference for Workflows

**Status:** Future sketch

## Context

A workflow's effect set is the set of tasks (and transitively, downstream
workflows) it may invoke when executed. Because workflow bodies are
visible to the compiler (see `dsl/workflow-composition.md` §1), this set
is **statically derivable** from the IR &mdash; no author annotation
needed in principle.

The composition design (`dsl/workflow-composition.md`) deferred
materializing effect information: v1 carries no effect annotation on
`WorkflowBody`. This note records the design space and the conditions
under which the question should be revisited.

## Why consider this

Several downstream features want a cheap, uniform handle on "what does
this workflow touch":

1. **Caching / memoization.** Effect set is part of any honest cache
   key. Pure workflows are trivially cacheable; network-touching ones
   need cache-control policy.
2. **Sandboxing / security policy.** "This workflow must never make a
   network call" or "this workflow may only invoke approved LLM tasks"
   are policy decisions that need an effect handle to enforce.
3. **Scheduling.** Resource-intensive task classes (LLM, heavy I/O)
   benefit from scheduler awareness across workflow boundaries.
4. **Visualization and review.** Coloring nodes by effect class
   (pure / network / LLM / mutating) makes reviews and audits faster.
5. **Determinism / replay.** Identifying which sub-workflows are
   deterministic enables partial replay from cached intermediate
   results.

Today none of these consumers exist in a form that pressures the design.
Defer until at least one does.

## Candidate options

### Option A &mdash; On-demand recomputation, no storage

The IR carries no effect field. Any consumer that wants the effect set
of a workflow walks its IR (and its callees') on demand. The compiler
ships a helper.

- **Pros:** Single source of truth (the graph); no staleness; no
  schema change. Lowest commitment.
- **Cons:** Repeated work for hot paths; cross-workflow boundaries
  require resolving every reference each walk; cache keys and policy
  checks pay the walk cost per call.

### Option B &mdash; Compiler-computed, stored on each `WorkflowBody`

The compiler computes the transitive effect set at compile time and
stamps it onto every `WorkflowBody`. Internal only; no DSL surface.

- **Pros:** O(1) lookup at every call site; survives composition
  boundaries; supports cheap cache keys; good for tooling.
- **Cons:** Stored field that can drift (must be recomputed on any
  change to the workflow or its transitive callees); cross-file edits
  require recompiling all callers; bundle artifacts must include
  effect info for every body.

### Option C &mdash; Author-declared, compiler-verified

The DSL gains an optional annotation
(`workflow summarize(x): string @effects(llm.*, !network)`). The
compiler verifies it matches the inferred set and errors if the
declared set fails to cover the inferred set.

- **Pros:** Authors express intent and refactoring guards
  ("this workflow must never call the network"); excellent for review
  and policy; sandbox/security stories become declarative; foreign
  workflows can carry trusted declarations.
- **Cons:** Largest design footprint &mdash; new DSL surface, new
  annotation syntax, verification rules, error reporting. Premature
  without a concrete consumer.

## Granularity sub-decision (applies to B and C)

What is _in_ the effect set?

- **(i)** Set of task names actually reachable
  (`["llm.generate", "http.get", ...]`). No task schema change needed.
- **(ii)** Set of task **categories** declared by task schemas
  (`["llm", "network", "filesystem"]`). Requires tasks to declare a
  category; they do not today.
- **(iii)** A small fixed enum:
  `{pure, deterministic, idempotent, network, llm, sideEffect}`.
  Requires task-side annotation.

(i) is the cheapest and richest entry point; downstream consumers can
categorize themselves. (ii)/(iii) require coordinating with the task
schema, which is a separate evolution.

## Why we are deferring

- No concrete consumer today: there is no cache layer, sandboxing
  policy engine, or scheduler asking for this handle.
- The information is derivable on demand (Option A) whenever a need
  arises; deferring loses nothing structural.
- Adding stored effect data later is additive: the IR can grow an
  optional `effects` field on `WorkflowBody` without breaking
  existing artifacts.

## Risks and costs of deferral

- Multiple consumers eventually re-implement the graph walk.
  Mitigation: when one such consumer lands, promote to Option B and
  centralize the walk in the compiler.
- Cross-file effect computation requires resolving imports; on-demand
  walks across many files may become slow before they become cheap.
  Mitigation: cache results at the consumer level until promotion.

## Revisit triggers

Promote out of `future/` when any of the following lands or becomes
imminent:

1. A workflow-level cache or memoization layer is being designed.
2. A sandboxing/security policy engine wants to assert constraints
   on workflows.
3. A scheduler needs cross-workflow resource awareness.
4. A visualization or review tool needs effect-class coloring.
5. Multiple consumers are walking the graph for effect info, creating
   duplicated logic that wants centralization.

At promotion, pick between B and C and a granularity. Recommended
default: **Option B with granularity (i)** &mdash; cheap, additive, no
task-side coupling. Option C is a good follow-on once policy use cases
are concrete.

## Open questions

- Does effect info need to be visible across the registry boundary
  reserved by `WorkflowRef.source`? (Probably yes, once registries
  exist.)
- Should "calls a sub-workflow" itself count as an effect, or only the
  transitive leaves (task calls)? (Probably only the leaves; the call
  itself is structure, not effect.)
- How do `fork`, `loop`, and `attempts` interact with effect labeling?
  (Likely transparent &mdash; the effect set is the union of their
  bodies'.)

## Non-goals

- Designing the cache, sandbox, or scheduler that would consume the
  effect set. Those are separate concerns.
- A general "purity" type system in the DSL.
- Coordinating with task-schema evolution to add task categories;
  granularity (i) avoids this for now.
