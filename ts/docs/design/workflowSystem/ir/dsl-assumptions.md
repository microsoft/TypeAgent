# DSL assumptions baked into IR v1

IR v1 was designed engine-first: the [audience lens](ir-v1.md) (§1.1)
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
documented in row 7 below; the residual non-DSL risk is in
[revisit-triggers.md](revisit-triggers.md). When a DSL effort starts,
the first task is to walk this list and confirm or refute each row
against the actual DSL design.

## Assumptions

| #   | Assumption                                                                                                                                                                      | What in v1 depends on it                                                                                                                                       | How to check / when to revisit                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The DSL toolchain has authoritative access to task schemas at lowering time (`.d.ts`-style import of the action package's typed envelope).                                      | [decision 0003](decisions/0003-task-schema-source.md) (schemas required and drift-checked on every IR node). Without schema access at lowering, this is a tax. | If a DSL is designed to lower without schema access (e.g., dynamic registry only, or schema-by-name reference), revisit decision 0003 and consider Option 3.            |
| 2   | The DSL's type / schema language is a subset of JSON Schema and lowers 1:1 to the IR's schema fields.                                                                           | [ir-v1.md §3.9](ir-v1.md) and the choice not to introduce alternative schema encodings.                                                                        | If the DSL needs a richer or differently-structured type system (algebraic, dependent, refinement-flavored) that does not lower 1:1, this is additive, see triggers #1. |
| 3   | Source maps between DSL position and IR position live in a sidecar owned by the DSL toolchain, not as fields on IR nodes.                                                       | The IR has no `source` / provenance vocabulary. Runtime errors arrive in IR coordinates; the toolchain re-projects them.                                       | If the sidecar approach repeatedly fails in practice (lost during distribution, third-party tooling needs in-IR provenance), consider an additive provenance extension. |
| 4   | The DSL or codegen layer absorbs the verbose-by-design tax (§1.2) so the LLM does not pay it per emission.                                                                      | The whole [§1.2](ir-v1.md) "verbose by design" position and the LLM-via-DSL row in [§1.1.2](ir-v1.md).                                                         | If a DSL ships and the LLM still ends up emitting IR-shaped JSON because the DSL is too narrow or too costly to learn, the LLM-direct fallback is doing too much work.  |
| 5   | LLM-direct-to-IR remains a viable fallback / escape hatch even after a DSL exists. The IR's locally-validatable, no-implicit-context, no-ordering-significance properties stay. | The LLM-direct row in [§1.1.2](ir-v1.md). Drops out if removed: §8.14 (JSON), parts of §5.7 (locally validatable), §8.2 (object-form refs).                    | If the LLM-direct path is formally retired, several v1 trade-offs become candidates for revisiting (terser format, contextual refs). See triggers rows 1, 5, 6.         |
| 6   | The bind-switch (§8.15) hide-by-default ergonomics are remediable at the DSL surface (DSL picks whatever the user-facing default should be; codegen wraps).                     | [decision 0001](decisions/0001-bound-outputs.md) and §8.15. Engine wants hide-by-default for liveness; users may want publish-by-default.                      | If the DSL surface ends up _always_ publishing and the IR's hide-by-default never matches what humans authored, the IR default is engine-only and that is acceptable.   |
| 7   | Codegen can splice DSL-produced IR fragments without violating boundary closure (§1.4). Each scope stays closed; the DSL never needs values to escape upward.                   | §1.4 boundary closure, the loop-body-as-sub-IR shape, and the absence of a `block` scope or export mechanism in v1.                                            | This is the least-validated assumption. If a DSL needs to hoist names or values across scopes, see [post-v1/block-scope.md](post-v1/block-scope.md).                    |

## How to use this list

- Adding a v1 decision that rests on a new DSL-shaped assumption:
  add a row here, name what depends on it, and name the check.
- Starting a DSL design effort: walk this list before touching the
  IR. Each row that holds becomes a constraint on the DSL; each row
  that fails becomes a candidate IR change in v2.
- Reopening a v1 decision: if the trigger you are about to act on
  corresponds to an assumption row, link both ways so the next reader
  sees the chain (`v1 chose X because of assumption N; assumption N
failed because Y; v2 picks Z`).
