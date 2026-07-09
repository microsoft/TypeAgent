# Replay L4b — build-from-git-ref — first-slice design

**Builds on:** L1 (schema-enriched grammar), L2 (cache, working-tree), L3 (deterministic dispatch),
L4a (live working-tree wildcard validation). This is the deepest rung of the replay fidelity ladder.

## The honest scope problem

The fidelity ladder classifies L4 as the largest, fully greenfield rung — multi-week and behind a
flag — needing a product steer before it is attempted. A faithful full L4b is genuinely multi-week
and should NOT be attempted in one pass. So this doc scopes a **tractable first slice** plus the
decision that gates which slice to build.

## What actually changes between two versions (verified)

- **Grammar (`.agr`)** — committed, versionable. Already compared at a ref via `git show`.
- **Action schema (`.ts` source)** — committed, versionable. Parsed from SOURCE (no build needed:
  `parseActionSchemaSource` reads TS text), already read at a ref via `git show` (L1 enrichment).
- **Validator / handler code (`.ts` → built `.js`)** — committed source, but only the **working
  tree** is BUILT. L4a runs the real `validateWildcardMatch` only on the working-tree side because
  that's the only side whose JS exists. The git-ref side can't run validators without a build.
- **Construction cache (`.json`)** — NOT committed (runtime artifact). Can NEVER be read at a ref.
  So "frozen cache at a ref" is impossible by construction; L4b cannot deliver it.

⇒ The ONLY thing a full build-from-ref unlocks that we don't already have is **running the ref's
compiled validator/handler JS** (and a freshly-warmed cache, which isn't a frozen artifact anyway).

## Current materialization limits (what a worktree would fix)

- `git show <ref>:<path>` reads ONE file at a time. Imported `.agr` grammars (a grammar that
  `import`s another `.agr`) aren't resolvable at a ref — each import needs its own `git show` with a
  versioned FileLoader (deferred since the real-replay slice). The doc notes 57/65 `.agr` have
  imports but **none import another `.agr`**, so this is rare.
- The `ReplayActionResolver` contract has **no `dispose()`** — `engine.ts` `cancel()` just flips a
  flag; the runtime consumes rows without a `finally` cleanup hook. Any worktree/checkout slice MUST
  add a disposer first (a hard prerequisite before any build-from-ref work).

## Three candidate first slices

### Option A — Worktree materializer + resolver `dispose()` lifecycle (infra-first, NO build)

Replace per-file `git show` with a single `git worktree add --detach <ref> <tmp>` per git-ref side;
read all grammar/schema/paramSpec files from the checkout; `git worktree remove` in a new
`dispose()`/`finally` path threaded through resolver → runtime.

- **Unlocks:** imported-`.agr` + whole-tree schema at a ref; establishes the disposer lifecycle that
  the full build rung mandates. De-risks Option C's hardest plumbing.
- **Honest gain:** modest today (imported-`.agr` is rare), but it is the **required foundation** for
  any build-from-ref and removes the "no disposer" blocker.
- **Cost:** small–medium. Main risks: worktree cleanup on crash, lock contention with the user's live
  repo, Windows path/locking. Mitigated by `--detach` (no branch checkout) + a temp dir under the OS
  temp root + best-effort `git worktree prune` on dispose.

### Option B — Ref-side wildcard validation via "unchanged-validator" shortcut (NO build)

Run L4a on the git-ref side too, but ONLY when `git diff <ref>..worktree -- <validator file>` is
empty (the agent's validator JS is unchanged between the ref and the built working tree), so the
already-built working-tree module faithfully represents the ref's validator. If the validator
changed, skip ref-side validation (honest, labelled "ref validation: skipped (validator changed)").

- **Unlocks:** symmetric wildcard validation for the common case (validator untouched, only grammar/
  schema edited — exactly the regression journey) with ZERO build machinery.
- **Honest gain:** real for the headline journey; limited to validators (timer/list).
- **Cost:** small. Risk: the "unchanged ⇒ safe to reuse working-tree module" inference must be
  conservative (compare the whole built package's source closure, not just one file, or restrict to
  the allowlisted agents whose validator lives in one known file).

### Option C — Full build-from-ref (the real L4b, multi-week, behind a flag)

`git worktree add` → `pnpm install --filter <agent>...` → scoped `tsc -b`/`asc`/`agc` → load the
built dist via a provider pointed at the worktree → full deterministic dispatch at the ref.

- **Unlocks:** true arbitrary-ref full-dispatch compare.
- **Cost:** multi-week, fully greenfield. Minutes per run (install + build). Many failure modes
  (install flakiness, native deps, disk). Clearly a flagged epic, not a one-session slice.

## Recommendation

Ship **Option A** now (the lifecycle + worktree foundation — the mandatory step 1 of the L4 epic),
and optionally **Option B** as the first user-visible fidelity win on top of it. Defer **Option C**'s
install/build orchestration to a tracked, flagged epic, started only if a concrete journey needs
ref-vs-ref full dispatch.

## Open decision

Which first slice? **A (infra foundation)**, **A+B (foundation + ref-side validation win)**, or
**commit to C (the multi-week build epic) now**?

---

## Design review — verdict & resolution

- **Option A — CUT as standalone / defer.** Worktree + disposer is infra ahead of need; `git show`
  is strictly better while we only READ committed source (no checkout cleanup, no repo-lock
  contention vs the user's live checkout, no Windows file-lock/crash-recovery burden). Build the
  lifecycle only when something real needs disposing (i.e. inside C).
- **Option B — SHIP ONLY IF very conservative + clearly labelled.** "Validator file unchanged" is
  NOT sound alone (a changed transitive import / helper / lockfile / tsconfig / data file silently
  breaks it). Acceptable only if the whole validator source CLOSURE is unchanged, only for the tiny
  timer/list validators, and surfaced as "opportunistic," not full ref fidelity. If closure
  detection starts to grow → cut (it becomes a partial rebuild system).
- **Option C — DEFER to a flagged epic** pending a real product journey. Guardrails before starting:
  explicit flag; cache built refs by commit SHA; hard timeout + clear failure modes; disposable
  worktree lifecycle first; per-agent build recipes (not guessed generic builds); strong UI
  labelling when a ref can't be built.
- **Better immediate slice:** ship **fidelity transparency** — per side/version report which
  fidelity layers ran (grammar / schema enrichment / construction cache / wildcard validation /
  dispatch) and the exact skip reason, plus a preflight "build-from-ref would add X (unsupported
  today)." Honest user value now, near-zero risk, and the right scaffold that makes L4b's eventual
  payoff visible/measurable.

**Resolution:** sandboxes are the design's intended EXECUTION CONTAINERS (today they
are metadata-only shells); a VersionSpec is a _recipe_ and L4b is the _build_ that realizes a recipe
into a populated sandbox. The UI evolves "pick 2 commits" → "pick 2 sandboxes" along a single
**realization axis**, in three incremental steps. Near-term = Steps 1–2 (transparency, no build);
Step 3 (build-from-ref) stays the deferred flagged epic.

## The sandbox-convergence plan (chosen direction)

```
VersionSpec (recipe)        L4b build (Step 3)            Sandbox (instance)
  {git, ref}      ──▶  worktree → tsc/asc → load dist  ──▶  built agent + dispatcher + cache
  {workingTree}   ──▶  (already built locally)          ──▶  the live agent
```

### Step 1 — per-side fidelity readout (SHIP NOW, no build, no new replay behavior)

Surface signals the resolver ALREADY computes. Add to `StudioReplayResult`:

```ts
interface FidelityReport {
  realization: "source" | "built-live"; // git ref ⇒ source; working tree ⇒ built-live
  layers: Record<
    | "grammar"
    | "schemaEnrichment"
    | "constructionCache"
    | "wildcardValidation"
    | "dispatch",
    { status: "ran" | "skipped" | "unavailable"; reason?: string }
  >;
}
interface StudioReplayResult {
  /* …existing… */ sideFidelity: { A: FidelityReport; B: FidelityReport };
}
```

Derive from existing `methodA`/`methodB` (`static-grammar`/`schema-grammar`/`construction-cache`),
`grammarResolver.enriched`, `wildcardValidation`, and `versionA/B.kind`. Pure mapping + unit test.
Webview: collapsible Fidelity matrix (5 rows × A/B) + a preflight line when a side is `source`-only
and a richer realization is theoretically available. Reuse `renderValidationNote` styling.

### Step 2 — relabel A/B as "Sandbox A / Sandbox B" (light)

A/B group header becomes Sandbox A / Sandbox B with a `recipe · realization` sub-label. Cements the
"2 sandboxes" model. Mostly labels on top of Step 1's descriptor.

### Step 3 — L4b build-from-ref (DEFERRED, flagged epic = old Option C)

Picker gains a "build from ref" opt-in → host realizes a real sandbox (worktree → build → load) →
ref side climbs the Step-1 matrix to `built`. Needs the resolver `dispose()`/`finally` lifecycle,
per-agent build recipes, SHA-keyed build cache, timeouts. Subprocess-mode + the L4a RPC-context
boundary remain the hardest sub-problem (context-dependent agents).

## Implementation plan — near-term (Steps 1–2)

1. **core/studioRuntimeCore.ts** — add `SideFidelity`/`FidelityReport` types + a pure
   `deriveSideFidelity(methodA, methodB, enriched, wildcardValidation, versionA, versionB)` mapper;
   populate `result.sideFidelity` (and in the error-result path). Unit test the mapper.
2. **webviewKit/protocol.ts** — carry `sideFidelity` on `replay.result` (additive/optional).
3. **webviewKit/client/impactReport.ts + media/impactReport.css** — Fidelity matrix panel +
   preflight line + Sandbox A/B relabel. Render test.
4. **Verify**: core `tsc -b` + jest, studio `tsx --test`, studio-service `npm test`, prettier,
   esbuild. No commit/push without explicit user consent.
   Deferred (Step 3): worktree materializer, scoped build, resolver `dispose()`, ref-side execution.
