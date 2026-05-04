# Bound outputs (decision 0001): hide-by-default node values

Status: **Adopted (v1).** Folded into [../ir-v1.md](../ir-v1.md)
(§3.2, §3.3, §3.4, §3.8, §4.1, §5.7, §8.15). This doc retains the analysis,
the decision rationale for each open question, and the relationship to
future extensions.
Related: [0002-cfg-ddg-separation.md](0002-cfg-ddg-separation.md) (C2, C3, C4, C5),
[../post-v1/block-scope.md](../post-v1/block-scope.md)
(blocks remain post-v1 for the multi-statement try and the regional
grouping cases that bound outputs alone don't address).

## 1. The proposal

Today, every node's output is implicitly a name in its scope's namespace.
Any dominated descendant may reference it via `{ "$from": "node",
"name": "<nodeId>" }`. The dominator check decides reachability; the
namespace itself is unrestricted.

Proposed change:

- **Default:** a node's output is **not** addressable from other nodes.
- **Sharing mechanism:** a node opts in by declaring its output as a
  named scope variable via a `bind` field. Once bound, dominated
  descendants reference it as `{ "$from": "scope", "name": "<bind>" }`.
- A node without `bind` can still execute. Its output goes nowhere
  addressable: the node exists for its `next` chain (sequencing,
  side effects) only.

Sketch:

```jsonc
"fetch": {
  "kind": "task",
  "task": "http.get",
  "inputs": { "url": { "$from": "input", "name": "url" } },
  "next": "summarize",
  "bind": "page"
},
"summarize": {
  "kind": "task",
  "task": "text.summarize",
  "inputs": {
    "body": { "$from": "scope", "name": "page", "path": ["body"] }
  },
  "next": null
}
```

The `node` namespace effectively becomes a "scope variable" namespace,
populated only by explicit `bind` declarations. The fact that a node
produces the value is a CFG detail; the value's name is a separate,
explicit decision.

## 2. What it solves

| ID  | Concern (from `cfg-ddg-analysis.md`)        | Resolution                                                                                                                                                                           |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | C2 (no data hiding)                         | Hiding is the default. Refactoring an internal step doesn't change a contract.                                                                                                       |
| S2  | Implicit contract surface                   | Scope's exports are scannable: collect every `bind`. Today the contract is "every node id".                                                                                          |
| S3  | C3 (refactoring fragility from CFG changes) | Only references into bound values can break. Internal chains refactor freely.                                                                                                        |
| S4  | C4 (name pressure as scope grows)           | Name pressure becomes proportional to API, not to size. 50 steps with 3 binds = 3 names worth caring about.                                                                          |
| S5  | C5 (spooky distance reader cost)            | DDG only crosses into bound nodes; CFG-only sequencers don't pollute the data model.                                                                                                 |
| S6  | DSL compilation target                      | `let x = ...` lowers to `bind: "x"`. Anonymous expression statements lower to nodes without `bind`. The IR distinguishes the two cases naturally.                                    |
| S7  | Four-namespace model coherence              | `node` namespace becomes a true "scope variable" namespace populated by explicit declarations. The `$from` value was renamed from `node` to `scope` as part of the v1 fold-in.       |
| S8  | Liveness analysis becomes trivial           | Unbound outputs are free-able the moment the producer completes. Bound outputs use the existing DDG last-reader pass. The optimization moves from engine analysis to language model. |

## 3. Concerns

### K1. Two ways to fail to use a value

A node without `bind` is either:

- An intentional hide ("I produce a value but don't want anyone to
  depend on it"), or
- An omission bug ("I forgot to publish").

The validator can't tell the difference. Mitigation: a non-normative
warning when a node lacks `bind` AND its `next` chain has no terminal
side effect. Combined with future effect declarations, "this is
side-effect-only" becomes statically visible (see K2).

### K2. Side-effect-only nodes look "useless"

A `log.info` task that exists purely to write a log line correctly has
no `bind`. Reads as "this node produces nothing useful" - which is true,
but the reader needs to see the side-effect intent. This argues for
combining bound outputs with the post-v1 effect declarations: a node
that's `effects: ["log"]` and unbound is clearly side-effect only.
Without effect declarations, authors lean on naming conventions or
comments.

### K3. Bound name vs node id - one or two namespaces?

Three options:

- **(a) Bound name = node id always.** `bind: true` (boolean) suffices.
  Simpler, but loses renaming use case (publish a long-named computation
  under a short alias).
- **(b) Bound name is separate from node id always.** `bind: "page"`
  where node id is `fetchAndParse`. Most flexible, but creates two
  namespaces in the same scope - node ids for CFG references, bound
  names for DDG references. P3 friction.
- **(c) Bound name defaults to node id, can be overridden.** Best of
  both, slight reader complexity.

**Decision (v1): (c).** `bind: true` is shorthand for the node id;
`bind: "<name>"` overrides. Common case has zero surface cost; rename
case is opt-in. Variance lens (IR §1.3 / §10): the chosen design is
one concept (bound name) parameterized by "use node id" vs. "use
explicit alias". The rejected (a) and the implicit-publication design
in §1's K-discussion both collapse two rules (CFG identity + DDG
publication) under one label - one label, two concepts.

**Update (v1, post-revision): the `bind: true` shorthand was removed.**
The variance lens applied a second time to the surface itself: `bind:
"<name>"` and `bind: true` carry one publication rule but two writing
forms; the boolean is sugar by the §1.2 "no sugar" test, and the
shortcut it bought (saving a few characters) does not earn its second
writing form. The chosen v1 surface is `bind: "<name>" | null` only;
authors who want "publish under the node id" write the id explicitly.
The (c) framing above is preserved as the historical reasoning that
led to (b)-with-an-alias-allowed; the conclusion of that re-analysis
is (b) outright. This decision document records the shape of the
thought; IR §8.15 carries the current normative statement.

### K4. Multiple slots per node

Sometimes a node logically produces several distinct values (e.g., a
parsed document with `headers`, `body`, `links`). Two options:

- **(a) Bind once, keep using `path`.** `bind: "doc"`, then
  `{ "$from": "scope", "name": "doc", "path": ["headers"] }`. Most
  consistent with today.
- **(b) Bind multiple slots.** `bind: { "headers": ["headers"],
"body": ["body"] }`. Flatter consumer-side API but introduces a new
  bind grammar.

Recommendation: **(a)**. Consistent with current `path` story.

**Decision (v1): (a).**

### K5. Handler / `onError` access to triggering node state

A handler reads `error` via `$from: "error"` and dominator-scope values.
Under this proposal, the handler can only read **bound** dominator
values. Question: should the handler get implicit access to the
_triggering_ node's intermediate state (inputs, partial outputs) without
requiring the trigger to bind anything?

Argument for **yes**: the trigger relationship is special. The handler
is the trigger's continuation; forcing the trigger to bind for the
handler's benefit leaks the handler's needs into the trigger's
contract.

Argument for **no**: uniform rule - if you want to inspect, you bind.
Simpler; one rule for everything.

Recommendation: think of `$from: "trigger"` as a small additional
namespace available only inside a handler, exposing the triggering
node's inputs (and the failure value via `$from: "error"`). This
preserves uniformity for normal references while giving handlers the
tooling they need.

**Decision (v1): adopt `$from: "trigger"`.** A handler may reference
any field of the triggering node's `inputs` via
`{ "$from": "trigger", "name": "<inputFieldName>" }`. The trigger does
not need to bind anything for the handler's benefit.

### K6. Terminal nodes / workflow output

`outputBinding`, loop `outputs`, and `@exit` all reference some
producer's output. Under this proposal, every such producer must
`bind`. That's actually fine: the output contract is visible on both
sides (producer binds, scope output references the bound name). Just
needs to be specified.

### K7. v1 vs post-v1 timing

If v1 ships with the current "every node id is a name" model and we
add bound outputs later, every existing IR breaks. Options:

- Ship v1 with `bind` required from the start (cheap now, since v1
  isn't shipped). Clean.
- Ship v1 with `bind` optional and a "default to today's behavior"
  fallback, then flip the default in v2 (semver). Introduces a
  long-lived backward-compat surface.

Recommendation: **v1**. The migration cost is zero now and high later.

**Decision: v1.** Folded in.

### K8. Reader complexity at the use site

`{ "$from": "scope", "name": "page" }` requires the reader to find the
node that bound `page`. Today, `{ "$from": "node", "name": "fetch" }`
points directly to the node id. With option K3(c), the bound name
defaults to the node id, so the common case reads identically to today
modulo the `scope`-vs-`node` namespace label.

### K9. P3 alignment (structure mirrors computation)

Today: "every node is a value" maps to "every step computes
something". Proposal: "some steps publish, some don't" maps to "real
programs have private locals and exported values". The proposal is
**more** mirror-of-computation, not less. P3 endorses.

### K10. P5 alignment (reader predicts engine behavior)

Today's prediction model: "node X's output is alive until scope end if
anything dominates and references it." Proposal's prediction model:
"node X's output is alive only if X has `bind`; otherwise it's freed
immediately after X completes." The proposed model is **more
concrete**. P5 endorses.

### K11. `path` projection

Only bound producers are referenceable, so `path` applies only to
bound values. Same as today; just with an explicit gate.

### K12. Phi merges: shared bind names across mutually-exclusive paths

During v1 fold-in, a follow-on question surfaced: can two binders in
the same scope share a bound name if they sit on mutually exclusive
paths (e.g., the arms of a branch)?

Three options:

- **(a) Disallow.** Each bind name has exactly one binder. Diamond
  merges require state slots or a future block-scope join.
- **(b) Allow with phi soundness.** Multiple binders may share a name
  iff no two of them lie on the same path from scope entry to any
  consumer. The validator checks this with a standard SSA-style pass.
  At the join, references resolve to whichever binder ran on the
  actual path.
- **(c) Always implicit phi.** Any consumer reference auto-merges from
  any reachable binder regardless of co-occurrence. Rejected: makes
  the producer set non-deterministic and the type rule ambiguous.

**Decision (v1): (b).** Bound outputs as designed already require a
dominator pass; extending it to handle multiple binders for the same
name is a small generalization (the pass becomes "some binder of X
dominates Y on every path; no two binders of X dominate each other")
and directly resolves v1's diamond-merge gap without needing block
scope. Type compatibility requires every binder's `outputSchema` to
be a subtype of every consumer's expected type.

This decision noticeably extends what bound outputs solve: the **join
/ phi pattern (C10)** moves from "block scope solves" to "bound
outputs solve directly". See updated relationship table in section 4.

## 4. Relationship to block scope

Bound outputs and post-v1 block scope solve overlapping but distinct
problems:

| Concern                    | Bound outputs (v1)             | Block scope (post-v1)                                                 |
| -------------------------- | ------------------------------ | --------------------------------------------------------------------- |
| Per-node hiding (C2)       | **Solves directly.**           | Indirectly (hide via inner block)                                     |
| Multi-statement try        | No direct help.                | **Solves directly.**                                                  |
| Join / phi pattern (C10)   | **Solves directly** (via K12). | Also solves; cleaner when arms are also regions needing their own try |
| Refactoring fragility (C3) | **Strongly improves.**         | Improves (block-internal refactors are local)                         |
| Name pressure (C4)         | **Solves.**                    | Helps via sub-namespace per block                                     |
| DSL `let` compilation      | **Direct target.**             | Direct target for `do { ... }` blocks                                 |

The two are complementary:

- Bound outputs solve **per-node hiding** and **simple phi merges**
  with one optional field plus a generalized dominator pass.
- Block scope solves **regional grouping** (one handler over a region,
  joins where each arm is itself a region with its own concerns).

A future IR with both has a uniform story: nodes hide by default,
binders may share a name across mutually exclusive paths, blocks group
regions when grouping is needed. They don't conflict.

## 5. What it does NOT solve

- Not **typed errors**.
- Not **`finally`**.
- Not **shared handlers**.
- Not **memory pressure for long-lived bound values** (the engine
  liveness recommendation in §5.7 still applies for them).
- Not **C5 entirely** - CFG-only sequencers still exist; their role
  just becomes clearer (they can't have any DDG consumers, so they
  must exist for ordering or side effects).

## 6. Decisions settled (v1 fold-in)

| # | Question | Decision | IR doc location |\n| --- | ------------------------------------- | ------------------------------------------------------ | ------------------------------- |\n| 1 | Namespace name | `$from: \"scope\"` (renamed from `node`) | \u00a73.2 namespace table, \u00a73.4 |\n| 2 | Bind grammar (K3) | (c) defaults to node id, overridable with explicit string | \u00a73.3 |\n| 3 | Handler access to trigger state (K5) | `$from: \"trigger\"` namespace, only inside handlers | \u00a73.4, \u00a73.8 |\n| 4 | Multiple binders per name (K12) | Allowed if no two co-occur on a path (SSA-style phi) | \u00a73.3, \u00a74.1 passes 5 \u0026 6 |\n| 5 | Workflow / loop output contract (K6) | `outputBinding` and loop `outputs` must reference bound producers | \u00a74.1 pass 11 |\n| 6 | Conformance bar implications (S8) | Engines SHOULD free unbound outputs immediately | \u00a75.7 |\n\nStill open as future tooling work, not blocking v1:\n\n- Validator warning for nodes with no `bind` and no declared effects\n (\"possibly unused node\"). Becomes precise once effect declarations\n land post-v1.\n\n## 7. Outcome\n\nAdopted for v1. The change is small at the IR level (one optional\nfield, one renamed `$from` value, one new `$from: \"trigger\"`\nnamespace) and pays off across multiple design axes: hiding,\nrefactoring, name pressure, reader experience, DSL compilation, engine\nliveness, diamond merges, and principle alignment.
