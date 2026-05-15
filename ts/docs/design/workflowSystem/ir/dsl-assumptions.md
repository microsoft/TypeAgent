# DSL assumptions baked into IR v1

IR v1 was designed engine-first: the [audience lens](ir-v0.1.md) (§1.1)
treats engine sufficiency and acceptable analysis cost as hard
constraints, and writer convenience as a soft one absorbed by tooling
above the IR. Several v1 decisions are durable **only if** the future
DSL behaves a certain way. This document lists those assumptions so a
DSL designer (or a future reviewer) can check them and so the right v1
decision can be reopened if an assumption fails.

This file is paired with [revisit-triggers.md](revisit-triggers.md).
Triggers say "v1 decision X may flip to Y if Z is observed."
Assumptions say "v1 decision X was made _because_ we expected the DSL to
do A." If an assumption is invalidated, the corresponding trigger is
the natural next entry point.

## Status

IR v1 is on track to ship without a DSL sketch. The risk that buys is
documented in S1 below; the residual non-DSL risk is in
[revisit-triggers.md](revisit-triggers.md). When a DSL effort starts,
the first task is to walk this list and confirm or refute each row
against the actual DSL design.

Assumptions are grouped by topic and given stable lettered IDs (S, T,
A, W, D) so that adding a new row in a group does not shift the
numbering used by inbound cross-references.

## Structural and scope assumptions (S)

These are the assumptions about what shape of program a DSL needs to
emit. S1 is the least-validated assumption in the whole document; it
is the one most worth a small DSL probe before v2.

| ID  | Assumption                                                                                                                                                                        | What in v1 depends on it                                                                                                             | How to check / when to revisit                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Codegen can splice DSL-produced IR fragments without violating boundary closure ([§1.4](ir-v0.1.md)). Each scope stays closed; the DSL never needs values to escape upward.         | §1.4 boundary closure, the loop-body-as-sub-IR shape, and the absence of a `block` scope or export mechanism in v1.                  | Least-validated. If a DSL needs to hoist names or values across scopes, see [future/block-scope.md](future/block-scope.md).                                                                                    |
| S2  | The DSL stays within the four v1 node kinds (`task`, `branch`, `loop`, `handler`). Richer source surfaces (`try/catch`, parallel blocks, sub-procedures) are lowered or rejected. | [§1.3](ir-v0.1.md) minimalism (exactly four kinds) and the deferral of sub-workflows / block scope / nested loops to [§2.2](ir-v0.1.md). | If the DSL repeatedly needs a fifth kind, the deferred features in §2.2 become v1 pressure rather than v2 work. See [revisit-triggers.md](revisit-triggers.md) row 7 (codegen coverage).                         |
| S3  | The DSL preserves the constants-as-global model ([§8.9](ir-v0.1.md)) rather than introducing per-scope constants whose names then collide at the IR level.                          | §8.9 (constants are workflow-global) and the scope-closure pass that excludes constants from the closure restriction.                | If the DSL surface has block-scoped `const` declarations, the DSL must alpha-rename to a single workflow-global namespace before lowering. If that gets painful, scope-local constants is an additive IR change. |

## Schema and type assumptions (T)

These cover the type / schema vocabulary that flows from action
packages, through the DSL, into the IR.

| ID  | Assumption                                                                                                                                 | What in v1 depends on it                                                                                                                                                                  | How to check / when to revisit                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | The DSL toolchain has authoritative access to task schemas at lowering time (`.d.ts`-style import of the action package's typed envelope). | [decision 0003](decisions/0003-task-schema-source.md) (schemas required and drift-checked on every IR node). Without schema access at lowering, this is a tax with no compensating layer. | If a DSL is designed to lower without schema access (e.g., dynamic registry only, or schema-by-name reference), revisit decision 0003 and consider Option 3.                                                 |
| T2  | The DSL's type / schema language is a subset of JSON Schema and lowers 1:1 to the IR's schema fields.                                      | [§3.9](ir-v0.1.md) and the choice not to introduce alternative schema encodings.                                                                                                            | If the DSL needs a richer or differently-structured type system (algebraic, dependent, refinement-flavored) that does not lower 1:1, this is additive. See [revisit-triggers.md](revisit-triggers.md) row 1. |

## Authoring surface assumptions (A)

These are the assumptions that prevent the IR's strictness from
becoming user-visible friction. Without an authoring layer that
absorbs them, the IR is hostile to humans and to the LLM-direct
fallback alike.

| ID  | Assumption                                                                                                                                                                                                                                                                                                                                                                                                           | What in v1 depends on it                                                                                                                        | How to check / when to revisit                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | The DSL fills required IR fields the author may omit, with sensible defaults or inferences. This includes loop `maxIterations` ([§3.7](ir-v0.1.md)), branch `default` ([§3.6](ir-v0.1.md), [§8.3](ir-v0.1.md)), `output` on every value-producing scope ([§3.1](ir-v0.1.md), [§3.7](ir-v0.1.md), [§8.10](ir-v0.1.md)), loop boundary `inputs` ([§3.7](ir-v0.1.md)), and node `stateWrites` ([§3.7.1](ir-v0.1.md), [§8.5](ir-v0.1.md)). | Every IR field that is required-no-default. The IR's "no surprise defaults" stance (P5) means the engine never invents these; the DSL must.     | If a future DSL surface forces authors to write all of these explicitly and that becomes the dominant author complaint, several "required, no default" choices become candidates for IR-level relaxation. |
| A2  | The DSL surfaces ergonomic equivalents for IR shapes that are structurally explicit but verbose: discriminant switch as `match` ([§8.3](ir-v0.1.md)), loop sentinels as `continue` / `break` ([§8.4](ir-v0.1.md)), `stateWrites` as assignment syntax ([§8.5](ir-v0.1.md)), object references as dotted names ([§8.2](ir-v0.1.md)), and named node IDs from source position ([§3.2](ir-v0.1.md)).                              | The "no sugar in the IR" stance ([§1.2](ir-v0.1.md)). If the DSL also has no sugar for these, the LLM and humans see the IR's verbosity directly. | If the DSL ships without these surfaces and authors complain, the answer is normally to extend the DSL, not the IR. The IR-side decisions only revisit if no DSL surface can be made to work.             |
| A3  | The bind-switch hide-by-default ([§8.15](ir-v0.1.md)) ergonomics are remediable at the DSL surface (DSL picks whatever the user-facing default should be; codegen wraps).                                                                                                                                                                                                                                              | [decision 0001](decisions/0001-bound-outputs.md) and §8.15. Engine wants hide-by-default for liveness; users may want publish-by-default.       | If the DSL surface ends up _always_ publishing and the IR's hide-by-default never matches what humans authored, the IR default is engine-only and that is acceptable.                                     |

## Writer economics assumptions (W)

These cover who pays the cost of the IR's design choices in tokens,
prompt complexity, and conformance burden.

| ID  | Assumption                                                                                                                                                                      | What in v1 depends on it                                                                                                                                                        | How to check / when to revisit                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W1  | The DSL or codegen layer absorbs the verbose-by-design tax ([§1.2](ir-v0.1.md)) so the LLM does not pay it per emission.                                                          | The whole [§1.2](ir-v0.1.md) "verbose by design" position and the LLM-via-DSL row in [§1.1.2](ir-v0.1.md).                                                                          | If a DSL ships and the LLM still ends up emitting IR-shaped JSON because the DSL is too narrow or too costly to learn, the LLM-direct fallback is doing too much work and the verbosity tax has not been absorbed. |
| W2  | LLM-direct-to-IR remains a viable fallback / escape hatch even after a DSL exists. The IR's locally-validatable, no-implicit-context, no-ordering-significance properties stay. | The LLM-direct row in [§1.1.2](ir-v0.1.md). Drops out if removed: [§8.14](ir-v0.1.md) (JSON), parts of [§5.7](ir-v0.1.md) (locally validatable), [§8.2](ir-v0.1.md) (object-form refs). | If the LLM-direct path is formally retired, several v1 trade-offs become candidates for revisiting (terser format, contextual refs). See [revisit-triggers.md](revisit-triggers.md) rows 1, 5, 6.                  |

## Tooling and debugging assumptions (D)

| ID  | Assumption                                                                                                                | What in v1 depends on it                                                                                                 | How to check / when to revisit                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Source maps between DSL position and IR position live in a sidecar owned by the DSL toolchain, not as fields on IR nodes. | The IR has no `source` / provenance vocabulary. Runtime errors arrive in IR coordinates; the toolchain re-projects them. | If the sidecar approach repeatedly fails in practice (lost during distribution, third-party tooling needs in-IR provenance), consider an additive provenance extension. |

## How to use this list

- Adding a v1 decision that rests on a new DSL-shaped assumption:
  add a row to the right group, name what depends on it, and name the
  check. Pick the next free ID in that group's letter (S, T, A, W, D);
  do not renumber existing rows.
- Starting a DSL design effort: walk this list before touching the
  IR. Each row that holds becomes a constraint on the DSL; each row
  that fails becomes a candidate IR change in v2.
- Reopening a v1 decision: if the trigger you are about to act on
  corresponds to an assumption row, link both ways so the next reader
  sees the chain (`v1 chose X because of assumption ID; assumption ID
failed because Y; v2 picks Z`).
