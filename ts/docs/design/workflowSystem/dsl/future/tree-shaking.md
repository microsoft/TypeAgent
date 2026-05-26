# Tree-Shaking the Merged Workflow Set

**Status:** Future sketch

## Context

The file loader (`fileLoader.compileFile`) is non-tree-shaking. Phase 4
emits every workflow declared in every loaded file into the merged
`WorkflowIR.workflows` table, mangled per file. There is no
reachability analysis from `entryWorkflows`.

Consequences today:

- An `import { } from "./foo.wf"` pulls `foo.wf`'s workflows into the
  IR. They are unreachable from source names in the entry file (no
  local-map entry binds them) but their bodies still occupy IR.
- Importing a single helper from a large library file drags every
  other workflow in that file into the artifact.
- Bundle mode (a single self-contained IR shipped to the engine) pays
  the size cost of every transitively imported file, not just the
  reachable subset.

This mirrors TypeScript's per-file emit model: the compiler emits
every declaration; tree-shaking is a bundler concern.

## Candidate options

- **A. Status quo (non-tree-shaking).** Document the behavior;
  optimization left to a separate pass or a future bundler.
- **B. Reachability prune in the loader.** After Phase 4, walk the
  call graph from `entryWorkflows`, drop any workflow not reached.
  Affects every consumer uniformly.
- **C. Bundle-mode-only prune.** Loader stays non-pruning;
  add a separate `bundleWorkflowIR(ir, entryNames)` pass invoked by
  the bundle emitter. Library/incremental consumers retain everything.
- **D. Opt-in prune flag.** `compileFile(..., { treeShake: true })`.
  Caller chooses per invocation.

## Why consider this

- **Bundle size.** Bundle mode is the primary motivator — it ships
  the full IR to an engine; carrying unreachable bodies bloats
  artifacts and the engine's workflow table.
- **Less surprise.** `import { } from "./x.wf"` becoming a
  side-effect import that injects workflows is unintuitive.
- **Better dead-code reporting.** A reachability pass naturally
  produces "unused workflow" diagnostics that the IDE could surface.

## Risks and costs

- **Behavior change for non-bundle callers.** Tools that introspect
  the full set of workflows in an artifact (e.g. for documentation
  generation) would see fewer entries under option B.
- **Dynamic dispatch.** If a future feature lets a workflow name be
  resolved at runtime (e.g. registry lookup), static reachability
  becomes unsound. Today every call is a static `workflowCall`, so
  this is not an immediate concern.
- **Pluggable engines.** An engine that loads multiple artifacts and
  cross-calls between them would need its own merge step that
  re-tracks reachability across artifacts.

## Open questions

- Should pruning be loader-level (option B) or bundler-level (option
  C)? Option C is the conservative default; option B is simpler.
- How are unreachable workflows reported — silently dropped, warned,
  or surfaced as a separate `unusedWorkflows` field in the result?
- Do we keep mangled names stable when pruning, or compact them?

## Non-goal

- Per-workflow tree-shaking inside a body (dead-node elimination).
  That is a separate IR-level optimization.
- Cross-artifact reachability for dynamically loaded engines.
