# Workflow Default Argument Alternatives

**Status:** Future sketch

## Context

The composition design (`dsl/workflow-composition.md` §4.3) adopts
arbitrary-expression default argument values in v1, lowered by
**inlining the default's expression tree at every defaulted call
site**. This adds zero new IR concepts: the IR shape is unchanged,
and the existing node/inputs/`$from` model handles everything.

The deliberate trade is structural: a default expression appears once
in source but is emitted once **per defaulted call site** in the IR.
For most workflows this is fine; for widely-called workflows with
non-trivial defaults, the duplication may become visible (larger IR
artifacts, repeated work in tooling that walks every node, mildly
weakened P3 because IR structure no longer mirrors source structure
1:1 at the default expression).

This note records the alternative lowerings to revisit if the
duplication becomes a real problem, and the conditions that should
trigger that revisit.

## Why consider alternatives later

1. **IR bloat.** A non-trivial default (e.g. a task call) emitted
   into N defaulted call sites produces N copies of the same
   subgraph.
2. **Recomputation.** The engine re-runs the default at each call
   site rather than once at decl time. For pure defaults this is
   wasteful but correct; for effectful defaults (a task call), the
   semantics may actually be desired (each call evaluates the
   default afresh).
3. **Authoring intent.** The author wrote the default once; tooling
   that mirrors source intent has to compress N copies back to one.
4. **Cross-bundle composition (later).** When workflow bodies live
   in a registry, the default belongs with the body, not duplicated
   into every caller's bundle.

None of these are pressuring v1 today; we are explicitly accepting
the duplication.

## Candidate alternatives

### Option A &mdash; Optional inputs as a first-class IR concept

The IR grows a notion of an _optional input slot_ on a workflow body:
the body itself carries the default expression, evaluated inside the
body when the slot is unbound. Callers omit the argument; the callee
materializes the default.

- **Pros:** Default appears exactly once in the IR, inside the
  callee. Cleanest semantically. Survives composition (defaulted
  workflows used in higher-order positions behave uniformly without
  the caller knowing the default exists). Aligns with how typed FP
  languages handle optional record fields.
- **Cons:** New IR concept &mdash; conditional input materialization
  &mdash; with validator, dominance, scoping, and replay
  implications. Largest scope to design and implement. Slightly
  weakens P5 (predictability): a reader has to know "if this input
  isn't bound, the body's default expression runs."

### Option B &mdash; Compiler-synthesized wrapper workflow

For each workflow with defaults, the compiler emits a wrapper
workflow that supplies the defaults and calls the underlying one.
Callers that omit arguments are rewritten to call the wrapper.

- **Pros:** Zero new IR concept. Default appears once in the IR
  (inside the wrapper). Call sites stay clean. Composition story
  is uniform (wrappers are just workflows).
- **Cons:** The IR contains workflows the user did not write. Mild
  identity surprise: "the workflow I called" vs. "the workflow that
  ran." Visualization and tooling need to either hide or label
  synthesized wrappers. One wrapper per default-bearing workflow
  could multiply if many workflows have defaults.

### Option C &mdash; Memoize the default expression per call site

Keep the inlined-at-call-site lowering (current v1 behavior), but
recognize repeated defaults across call sites and emit them once
into a shared sub-scope referenced via `$from`. Effectively
deduplicates within a single calling workflow.

- **Pros:** Smallest IR change (none, structurally); preserves the
  v1 lowering shape; recovers most of the duplication cost when N
  call sites in the same workflow share a default.
- **Cons:** Only deduplicates _within_ a workflow; cross-workflow
  duplication remains. Reordering / hoisting introduces ordering
  questions. Limited win compared to A or B.

## Revisit triggers

Promote out of `future/` (and choose between A / B / C) when any of
the following arrives or becomes imminent:

1. **Measured IR bloat.** A real bundle's `nodes` count or artifact
   size is materially larger because of defaulted-call inlining,
   and the duplication is identifiable as the cause.
2. **Cache or replay layer** treats the IR as the cache key surface
   and the per-call-site duplication causes spurious cache misses
   between callers that share a default.
3. **Cross-bundle / registry composition** lands and storing the
   default with the body becomes the obviously correct shape.
4. **Tooling complaint:** visualization or review tools that walk
   the graph become noticeably noisier because the same default
   subgraph appears N times in the same artifact.
5. **Effectful defaults** become common (e.g. defaults that call
   tasks), and authors expect "evaluate once per call" semantics
   that the inlined lowering accidentally provides per-call instead.
   (This one is subtle &mdash; it may want a spec clarification
   rather than a lowering change.)

At promotion, the recommended default is **Option A
(first-class optional inputs)** if a clean composition story is
worth the IR work, or **Option B (wrapper workflows)** if the team
prefers to keep the IR shape stable and absorb the cost as
synthesized workflows. Option C is a stop-gap and rarely the best
endpoint.

## Partial application (parked)

Partial application (`summarize.partial({ maxLen: 200 })`) is a
related but distinct feature. No concrete design today. Its natural
home, if it lands, is alongside or after one of the alternatives
above &mdash; not before.

## Open questions

- For Option A: what does `inputSchema` look like for a workflow
  with optional inputs? JSON Schema supports `required: [...]`, so
  the contract is expressible; the question is whether tooling that
  walks the schema understands optional-with-default semantics.
- For Option B: should synthesized wrappers be private (compiler
  detail), or visible in the IR's `workflows` table with a marker?
- For all options: how do defaults compose with the `WorkflowRef`
  identity story (currently name-only)? When versioning lands, do
  defaults travel with the body or with the call site?

## Non-goals

- Designing partial application.
- Replacing v1's inlined-default lowering pre-emptively.
- Adding optional inputs as a v1 IR concept.
- Coupling defaults to the task-schema layer.
