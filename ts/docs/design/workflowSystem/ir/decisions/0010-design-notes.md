# Decision 0010 design notes (in-flight log)

Companion to [0010-finish-workflow-scope-unification.md](0010-finish-workflow-scope-unification.md)
and [0010-implementation-plan.md](0010-implementation-plan.md).

This file accumulates **design choices made during execution** that
warrant a later review pass. Entries fall into three categories:

- **Non-obvious choice.** The decision is not implied by 0010 itself;
  a reader of 0010 alone could not guess the implementation chose
  this path. Examples: validator pass ordering, error message
  taxonomy, internal helper boundaries.
- **Revised assumption.** An initial assumption proved wrong during
  execution and was corrected. The correction may have implications
  beyond the immediate fix that are worth a second look.
- **Live alternative.** A plausible alternative exists with credible
  upside; the implementation picked one path but the other should
  be revisited if pressure changes.

Entries are appended during execution. The whole file is reviewed
once all phases of 0010 land.

## Entry template

```
### YYYY-MM-DD - <short title>

Category: non-obvious choice | revised assumption | live alternative
Phase: 1 | 2 | 3
Touches: <file:line or section refs>

Context: <one or two sentences>
Choice: <what was decided>
Alternatives considered: <what else was on the table>
Why this one: <reasoning>
Revisit when: <trigger that would justify reopening>
```

## Entries









### Phase 2 promote summary

**Phase 2 = "DSL emitter rewrite + engine runner alignment".** Closed
2025-XX with all three test suites green:

- model: 148 pass (+ 1 skip — see deferred items).
- dsl: 634 pass.
- engine: 199 pass.

**Reviews:**
- Code review r1 → fixed branch arm `state` to be shallow-copy.
- Code review r2 → deferred literal-`continueWhen:true` flagging.
- Test gap r1 → added `buildOutputOnlyArm` and `filter_check.next`
  structural emitter tests.
- Test gap r2 → added skipped test for `continueWhen` reference
  validation (real validator gap surfaced); deferred loop body
  state isolation runtime test.

**Open soundness gaps:**
1. Task inputs are not deeply immutable — `resolveTemplate` returns live
   references for object/array values; a mutating task silently bleeds
   changes back into scope. Design options tracked in
   `ir/future/task-input-immutability.md`.
2. Literal `continueWhen: true` not flagged — design options tracked in
   `ir/future/loop-termination-detection.md`.
3. Loop body state shallow-copy isolation has no runtime test.
   (Note: branch arms no longer have ambient state — they are now
   fully isolated like fork branches; state access model tracked in
   `ir/future/branch-arm-state-access.md`.)

Phase 3 (non-DSL stdlib documentation, straggler search, decision
log audit) can now proceed.

---

### Phase 3 promote summary

**Phase 3 = "documentation/audit cleanup".** Closed with:

- engineering/plan.md: decision 0009 row and Loop output appendix
  now reference body completion under `continueWhen` (corrected
  twice via reviews to be precise about the per-iteration
  ordering: body completes → continueWhen evaluates → if false,
  output resolves).
- principles/design-principles.md: P5 has a historical note that
  scenarios 37 and 41 were written under the @iterate/@exit shape
  and that decision 0010 made two coupled changes (arms as
  WorkflowScope, continueWhen as iteration control).
- Straggler search audit: no active code references remain. The
  remaining @iterate/@exit mentions in IR v0.1, the DSL-gap doc,
  the workflow-scope-proposal, and future/ designs are all either
  (a) inside explicit "Pre-0010" / proposal / design-rationale
  sections, (b) test fixtures verifying rejection, or (c)
  future-feature comparisons that intentionally contrast new vs.
  old.

**Reviews:** 2 code-review rounds (both surfaced real phrasing
issues that were corrected). Test-gap rounds for Phase 3 are
n/a — no production-code changes. Phase 2's gap-round results
already cover the runtime/emitter assertions for the new model.

**Decision 0010 status: complete.** All 26 plan tasks done. All
test suites green: model 148/148 (1 skip tracked), dsl 634/634,
engine 199/199.
