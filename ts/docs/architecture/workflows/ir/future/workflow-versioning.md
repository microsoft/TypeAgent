# Workflow Versioning

**Status:** Future sketch

## Context

The composition design (`dsl/workflow-composition.md`) introduces a
`WorkflowRef` carrying only `{ name, source }` for v1. There is no
version, no content digest, and no compatibility range. This aligns
with the broader v1 deferral of deployment and evolution concerns
(see `principles/design-principles.md` "Out of scope for v1" and
`ir/ir-v0.1.md` "Out of scope" table).

Within a single bundled artifact, name-only identity is unambiguous:
the compiler resolved the call against a specific `WorkflowBody` and
embedded that body in the same IR. Versioning becomes load-bearing
only when workflows can be authored, shipped, and resolved
independently of the calling IR.

This note records the candidate design space and the conditions under
which the question must be revisited. It is the concrete instance of
the open follow-on in `principles/principle-gaps.md`:

> **Sub-workflow evolution:** when sub-workflows are added, does P4's
> boundary contract need strengthening for versioning?

## Why consider this

The following capabilities cannot be honestly supported without an
identity story beyond a bare name:

1. **Cross-bundle composition.** Two bundles each named `summarize`
   are not the same workflow. Resolution without identity is a
   coin-flip.
2. **Engine-side workflow registry.** The reserved
   `WorkflowRef.source: "registry"` extension point in §2.2 of the
   composition doc cannot resolve safely without identity.
3. **Reproducibility audits.** "Re-running this bundle gives the
   same result" requires knowing which exact body each call
   resolved against.
4. **Compatibility evolution.** A widely-used helper that gains an
   optional field should not silently change callers' behavior.
5. **Cache keys.** Memoization across runs (a later concern) wants a
   content-stable identity per call site.

None of these are pressuring v1 today.

## Candidate options

### Option A &mdash; Name + content digest

`WorkflowRef = { name, source, bodyDigest }`. The compiler computes a
deterministic digest of the resolved `WorkflowBody` (recursively,
including its callees' digests) and stamps it at every call site.

- **Pros:** Content-addressed; exactly what was compiled against is
  preserved; drift is detectable; aligns with Nix / Bazel / container
  layer models; cache keys get a natural primitive; no author
  bookkeeping.
- **Cons:** Requires deterministic IR emit (mostly already true, but
  must be specified); the digest's input set
  (schemas + node graph + callees' digests) needs a contract; does
  not express _intent_ of compatibility (callers cannot say "I'm OK
  with a patch-compatible body").

### Option B &mdash; Name + semantic version

`WorkflowRef = { name, source, version: "1.2.0" }`. Workflows declare
a version; callers depend on a version or range.

- **Pros:** Familiar (npm / Cargo); expresses compatibility intent;
  lets callees evolve without forcing recompile of every caller;
  ranges enable ecosystem-style sharing.
- **Cons:** Author bookkeeping (semver discipline is hard); version
  mismatch is a runtime concern unless paired with a digest; ranges
  require a resolver; richer surface than necessary before there is
  a real cross-bundle ecosystem.

### Option C &mdash; Name + digest + optional semantic version

Digest is mandatory (A), semver is optional metadata authors can add
when they want to communicate compatibility intent.

- **Pros:** Digest gives reproducibility and identity for free;
  semver becomes a tooling/policy concern, not a resolution concern;
  covers both technical identity and human-meaningful evolution.
- **Cons:** Two identifiers to think about (one load-bearing, one
  advisory); slight surface bloat.

### Option D &mdash; Name only (status quo, accept the limits)

Stay with `{ name, source }` permanently. Treat cross-bundle
composition and an engine registry as never-supported.

- **Pros:** Simplest possible; matches today's task model.
- **Cons:** Forfeits the capabilities listed above. Almost certainly
  not viable long term.

## Granularity sub-decision (applies to A and C)

What is _in_ the body digest?

- `inputSchema` and `outputSchema` (the contract surface).
- The node graph: kinds, ids, ordering, edges, `bind` names.
- Per-node task references and their inputs (literals included).
- Recursively, every transitively reached `WorkflowBody`'s digest.

What is _excluded_:

- Source-level comments and formatting (`leadingComments`).
- Source file path or import-resolution metadata.
- Compiler/tool versions (separate concern).

These exclusions keep the digest a property of the _computed graph_
rather than the source text. A reformatting pass must not change a
digest.

## Revisit triggers

Promote out of `future/` when any of the following arrives or becomes
imminent:

1. The reserved `WorkflowRef.source: "registry"` path is being
   implemented (composition doc §2.2).
2. Cross-bundle composition is requested (a workflow in one artifact
   calling one defined in another).
3. A reproducibility / audit requirement lands that needs an identity
   beyond name.
4. A workflow-level cache or memoization layer is being designed
   (overlaps with `ir/future/effect-inference.md`).
5. Multiple bundles with name collisions exist in any deployment
   target.

At promotion, the recommended default is **Option A (name + content
digest)** with the granularity above. Option C layers semver on top
as policy metadata if and when authoring practice asks for it.

## Risks and costs of deferral

- A bundle's authoritative identity is only its top-level workflow
  name. Two bundles cannot be safely composed if their helpers
  collide.
- The `WorkflowRef.source: "registry"` slot cannot be used until
  this is resolved; teams should not build registry-style features
  before then.
- Migration to a digest-bearing `WorkflowRef` is additive (a new
  optional field), so the deferral does not paint the IR shape into
  a corner.

## Open questions

- Should the digest be of the **resolved** body (after compilation /
  type-checking) or of the **source**? Resolved is recommended:
  source can vary without changing the computed graph (whitespace,
  comments, declaration order) and vice versa (refactors that
  change the graph but preserve source intent).
- Does the digest cover the workflow's `inputSchema` and
  `outputSchema` only, or its full body? Full body is recommended;
  callers care about behavior, not just the type signature.
- How does this interact with task versioning, which is also
  deferred (`ir/ir-v0.1.md` §2.2 "Dynamic task registry")? Likely:
  when one lands, the other lands shortly after, and they share a
  conceptual model (content-addressed contracts).

## Non-goals

- Designing the registry that would resolve versioned references.
- A package manager / dependency resolver.
- Migration mappings between workflow versions (separate concern;
  see `principles/principle-gaps.md` "IR identity across versions").
- Coupling workflow identity to source file path or git revision.
