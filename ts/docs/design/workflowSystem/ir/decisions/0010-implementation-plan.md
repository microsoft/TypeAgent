# Decision 0010 implementation plan

Companion to [0010-finish-workflow-scope-unification.md](0010-finish-workflow-scope-unification.md).
This file tracks the rollout of the two coupled changes adopted by
decision 0010:

1. **Branch arms as `WorkflowScope`** (the §3.1 shape of 0010).
2. **Loop termination as `continueWhen` reference; `@iterate` /
   `@exit` retired** (the §3.6 / §3.7 shape of 0010).

The IR is pre-1.0 with no outside consumers (per 0010 §5.5), so the
plan does not allow for a deprecation window or dual-shape
acceptance. The two changes land together because the branch-arm
change alone introduces a regression that only the loop-termination
change resolves (0010 §5.6.2).

## Sequencing

Phases are ordered by dependency. Items within a phase are listed
in suggested execution order; most can be parallelized further if
desired.

### Phase 1 - Spec edits (no code)

Cross-references resolve cleanly only in this order. All edits land
in `ts/docs/design/workflowSystem/`.

1. Flip [0010-finish-workflow-scope-unification.md](0010-finish-workflow-scope-unification.md)
   status from **Proposed** to **Accepted**.
2. Rewrite [`../ir-v0.1.md`](../ir-v0.1.md) **§3.6** (branch node) to
   the §3.1 shape of 0010. Retract "no `outputs`, no `bind`, no
   value." Preserve the discriminant-switch rationale and the
   exhaustiveness contract. Add cross-references to `WorkflowScope`
   and ir-v0.2 §2.1.
3. Rewrite [`../ir-v0.1.md`](../ir-v0.1.md) **§3.7** (loop node) to
   the §3.6 shape of 0010. `body` becomes a plain `WorkflowScope`.
   Add `continueWhen`. Retire `@iterate` / `@exit`. Retime `output`
   and `iterateState` to body-completion-with-`continueWhen`-false /
   -true. Preserve the §8.6 snapshot-read semantics verbatim.
4. Update [`../ir-v0.1.md`](../ir-v0.1.md) **§1.1.3**: replace the
   Branch model row and add the Loop termination row per 0010 §2.
5. Update [`../ir-v0.1.md`](../ir-v0.1.md) **§5.3** (branch
   execution), **§5.5** (`onError` dispatch - extend to cover
   branch `onError`), and **§5.8.3** (drop sentinel projection
   cases). Match 0010 §3.4 and §3.7.
6. Extend [`../ir-v0.1.md`](../ir-v0.1.md) **§8.3** (branch model
   rationale) per 0010 §5.6.1. The discriminant-switch decision is
   preserved; the §3.6 publication asymmetry is lifted.
7. **Retract** [`../ir-v0.1.md`](../ir-v0.1.md) **§8.4** (loop
   sentinels rationale) per 0010 §5.6.3. Replace with a short
   pointer to 0010 explaining that the design point moved from
   routing-layer encoding to reference-layer encoding.
8. Footnote [`../ir-v0.1.md`](../ir-v0.1.md) **§8.5** per 0010 §5.6.4.
   The decision (centralized `iterateState`) stands; the
   "branches targeting `@iterate` directly" sub-rationale is moot.
9. Update [`../ir-v0.1.md`](../ir-v0.1.md) **§8.6** per 0010 §5.6.5.
   Snapshot-read and atomicity guarantees preserved verbatim; the
   commit point retimes from `@iterate` transition to
   body-completion-with-`continueWhen`-true.
10. Add cross-references to 0010 in:
    - [0001-bound-outputs.md](0001-bound-outputs.md) - one-line
      pointer noting branch now uses the existing `bind` mechanism.
    - [0002-cfg-ddg-separation.md](0002-cfg-ddg-separation.md) -
      branch listed among DDG-source-eligible kinds.
    - [0006-no-expressions-in-ir.md](0006-no-expressions-in-ir.md) -
      pointer noting 0010 is a scope-output and termination-as-
      reference adoption, not an expression addition.
    - [0008-discriminant-key-encoding.md](0008-discriminant-key-encoding.md) -
      pointer noting branch's selector / selectorSchema rules are
      preserved unchanged.
    - [0009-loop-output-source.md](0009-loop-output-source.md) -
      pointer noting `continueWhen` extends the "reference resolved
      at scope completion" pattern from output to termination.
    - Audit [0007-value-construction-in-references.md](0007-value-construction-in-references.md)
      for consistency: arm `output` templates and loop
      `continueWhen` references must not contradict the
      reference-construction rules. Add a cross-ref iff a clash or
      relevant interaction is found; record the audit outcome
      either way in `0010-design-notes.md`.
11. Update [`../revisit-triggers.md`](../revisit-triggers.md): mark
    the branch-model and loop-sentinel trigger rows resolved by
    0010.
12. Update [`../workflow-scope-proposal.md`](../workflow-scope-proposal.md):
    add a row to the "sites using `WorkflowScope`" list for branch
    arms; update the loop entry to note that body is now a plain
    `WorkflowScope` with no in-scope routing sentinels.
13. Update [`../../dsl/dsl-v0.1-gap.md`](../../dsl/dsl-v0.1-gap.md):
    - **G5** marked resolved. The lowering contract becomes "lower
      value-producing `if`/`switch`/ternary to branch nodes whose
      arms are `WorkflowScope`s with declared `output`." `identity`
      and `noop` are removed from the lowering contract and noted
      as ordinary stdlib tasks usable for non-branch literal
      materialization.
    - **G6** marked dissolved. Per-arm-scope validation replaces
      the shared-bind phi heuristic. The four DSL-integration tests
      currently marked `NO_VALIDATE` / `skipValidation` for
      branch-return convergence are called out as ready to unmark
      (Phase 2 task 23).
    - Strategy (c) "split-point phi coverage for short-circuit
      `&&` / `||`" removed.

### Phase 2 - Code

Phase 2 begins only after Phase 1 is promoted complete.
Within-phase suggested dependency order: types -> fork-reuse audit
-> validator -> engine -> emitter -> coverage-matrix design -> the
remaining items.

14. **IR TypeScript types.** Update `BranchNode` and `LoopNode`
    interfaces (and any shared discriminant types). Branch arms
    become `{ inputs, scope: WorkflowScope }`. Branch gains
    `outputSchema`, `bind`, `next`, `onError`. Loop loses sentinel
    target literals; gains `continueWhen`. Update any IR
    serialization schemas.
15. **Audit fork's per-branch-scope code path for reusability.**
    Tasks 16 and 17 below assume validator and engine can reuse
    fork's per-branch-scope code path verbatim for branch arms. If
    the code is not structured for reuse, refactor first
    (extract a per-WorkflowScope-execution helper that both fork
    and branch can call). Outcome is recorded in
    `0010-design-notes.md` whether or not a refactor is needed.
16. **Validator.** For branch: per-arm `WorkflowScope` passes
    (reuse fork's per-branch-scope code path - per task 15);
    `inputs` wiring; arm-`outputSchema`-vs-branch-`outputSchema`
    compatibility; branch as DDG producer when `bind` is declared.
    For loop: `continueWhen` resolves in body scope and is
    boolean-typed; `iterateState` and `output` retimed; remove
    `@iterate` / `@exit` projection cases; remove the rule that
    branch arms targeting `@iterate` / `@exit` do so only inside a
    loop body. Remove the G6 prefix-string phi heuristic entirely.
17. **Engine, including sentinel cleanup.** For branch: dispatch
    -> selected arm-scope execution (reuse fork's per-branch-scope
    code path) -> `scope.output` resolution -> optional `bind`
    publication -> `next`; add `onError` parallel to fork's. For
    loop: execute `body` to natural completion -> resolve
    `continueWhen` -> iterate (with `iterateState`) or exit (with
    `output`); preserve `maxIterations` and `onError` semantics.
    Remove all sentinel-aware code paths in the same change
    (transition handling, scheduling, trace events); no commit in
    this task is permitted to leave both sentinel-aware and
    sentinel-free paths live.
18. **DSL emitter.** Stop emitting `identity` shims at branch
    convergence. Stop emitting `noop` merge nodes for branch joins.
    Emit each branch arm as a `WorkflowScope` with explicit
    `output`. Lower short-circuit `&&` and `||` directly to branch
    arms with boolean `output`. For loops, emit `continueWhen` in
    place of the `@exit`-routing pattern and drop the explicit
    `@iterate` continuation. After this task, verify a sample of
    emitter outputs round-trips cleanly through the new validator.
19. **Positive coverage matrix.** Before the test-gap review
    rounds, design the positive-coverage matrix for the new
    surface and add tests covering each cell. At minimum:
    - branch with `bind` + `outputSchema` (uniform-output arms);
    - branch with mixed-type arms compatible with declared
      `outputSchema` (union case);
    - branch with `onError`;
    - branch arm-scope `inputs` wiring (templates resolved against
      outer scope);
    - branch as a DDG producer (downstream `$from: scope`
      references its `bind` name);
    - short-circuit `&&` / `||` lowering with declared boolean
      `output`;
    - loop with `continueWhen` reading body-scoped binding;
    - loop with `continueWhen` reading state;
    - loop terminating on `maxIterations` with `onError`;
    - loop iterateState commit retiming (snapshot reads in
      iteration `i+1` see values committed at iteration `i`
      body-completion).
    Coverage matrix lives in test code; if anything in the matrix
    requires a non-obvious design choice, record in
    `0010-design-notes.md`.
20. **Tracing / observability.** Sentinel events become
    body-completion events on the loop. Branch publication events
    join the existing fork-arm-publication path.
21. **Fixtures.** Rewrite hand-authored v0.1 IR fixtures
    (validator test cases, engine test cases, DSL snapshot
    fixtures) to the new shape. Regenerate emitter snapshots.
22. **Visualizer / debugger touch points.** Update any
    arm-rendering code to walk arm scopes. Drop sentinel-target
    rendering for loops.
23. **Unmark integration tests.** Remove `NO_VALIDATE` /
    `skipValidation` flags from the four DSL-integration tests
    that previously failed branch-return convergence (G6). Confirm
    they validate clean.

### Phase 3 - Cleanup

24. **Non-DSL stdlib documentation.** Update any documentation
    *outside* the DSL gap doc (which Phase 1 task 13 handles) that
    described `identity` / `noop` as load-bearing at branch
    convergence; reframe them as ordinary stdlib tasks.
25. **Search for stragglers.** Grep for `@iterate`, `@exit`,
    `identity`, `noop`, "phi", "shim", "merge node", "branch
    convergence" in code and docs; remove or update any references
    that contradict the new model.
26. **Decision-log audit.** Confirm all decisions and proposals
    that referenced the v0.1 branch / loop shape have either been
    updated under Phase 1 task 10 or annotated as historical.

## Non-goals (per 0010)

- Adopting predicate-style branches. Selector is still computed
  by an upstream task; decision 0006 stands.
- Removing `identity` or `noop` from the stdlib. They lose their
  load-bearing role but remain available.
- Modifying `WorkflowScope` itself, fork, forkMap, or the top-level
  workflow shape.
- Changing exhaustiveness, discriminant-key encoding (0008), pure-
  SSA (0004), `state` / `iterateState` semantics, `maxIterations`,
  or `onError` handling beyond extending it to branch.
- Any backward-compatibility shim or deprecation window.

## Open follow-ups (not blockers)

- Whether `identity` / `noop` should eventually leave the stdlib
  is a separate decision. Track as a future trigger row, not as
  part of 0010.
- Tooling/debugger UX for arm scopes (collapse-by-default,
  per-arm timeline view, etc.) is a UX decision out of scope
  here.
- Any future predicate-form perf escape hatch (cf. ir-v0.1 §8.3
  post-v1 note) is unaffected by 0010 and remains a separable
  future proposal.

## Tracking

Per-task status lives in the session SQL database (`todos` table)
keyed by IDs of the form `dec0010-NN`, where `NN` is the task
number above. Dependencies follow the phase ordering: every Phase
2 task depends on Phase 1 completing; Phase 3 tasks depend on
their Phase 2 antecedents.

Phase 2 and Phase 3 todos are loaded into SQL when their phase
begins, not in advance. Loading them lazily keeps the active task
set small and lets earlier-phase findings (recorded in
`0010-design-notes.md` and `0010-deferred-reviews.md`) inform the
exact wording of later-phase tasks.

## Execution policy

Each phase follows this loop:

1. **Execute** the phase's tasks.
2. **Design / code review, round 1.** Launch a code-review subagent
   over the phase's changes; address actionable findings.
3. **Design / code review, round 2.** Launch a second code-review
   subagent (fresh context) over the phase's changes including the
   round-1 fixes; address actionable findings.
4. **Test-gap review, round 1.** Launch a subagent to identify
   missing test coverage; close actionable gaps.
5. **Test-gap review, round 2.** Launch a second test-gap subagent
   (fresh context) over the phase's changes including round-1
   additions; close actionable gaps.
6. **Promote phase complete.**

Phase 1 is spec-only (no code). For Phase 1 the "test-gap" rounds
are interpreted as **spec-coverage rounds**: do the spec edits
leave dangling cross-references, ungrounded claims, missing
examples, or inconsistencies with sibling specs? Phase 2 and
Phase 3 use true test-gap rounds.

### Companion tracking documents

Two MD files alongside this plan accumulate review output that
survives the phase loop:

- [0010-design-notes.md](0010-design-notes.md) - **design
  decisions made during execution that warrant later review**.
  Non-obvious choices, places where an initial assumption was
  wrong and had to be revised, and solutions that have plausible
  alternatives worth reconsidering. Updated during execution.
  Reviewed once all phases complete.
- [0010-deferred-reviews.md](0010-deferred-reviews.md) - **review
  findings (code-review or test-gap) that were *not* acted upon**,
  with the reason for deferral. Each entry names the source review
  round, the finding, the deferral reason, and any follow-up
  pointer. Updated during the review rounds. Reviewed once all
  phases complete.

The triage rule for each finding is binary: either fix it now (and
note it in the relevant phase's task log) or record it in
`0010-deferred-reviews.md`. Nothing silently dropped.
