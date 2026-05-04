# Post-v1: edge-scoped bind (`$from: "edge"`)

Status: **Post-v1 sketch.** Listed in [../ir-v1.md](../ir-v1.md) §2.2.

## 1. Motivation

v1's data-visibility granularity is the scope. A node either binds (and
the value is addressable from every dominated descendant in the scope) or
it doesn't bind (and the value is unaddressable to anyone). There is no
way to say "this value is only for my immediate successor."

That intermediate granularity is the most common shape in real workflows:
a producer hands a value to exactly one consumer that runs right after
it, and nobody else in the scope should ever name that value. v1 forces
the author to choose between two imperfect encodings:

- **Bind anyway.** Pick a name, declare `bind: "x"`, and rely on the
  convention that nothing else references it. The validator can't enforce
  the one-reader intent; refactors that add a second reader are silent.
  Liveness still works (the SHOULD `free after last reader` rule frees
  the value when the one consumer runs), but visibility is wider than
  the author wants.
- **Don't bind.** Fold the consumer's logic into the producer task so
  the value never crosses an IR boundary. This is correct when the two
  steps are conceptually one task; it's an over-correction when they are
  two distinct tasks that happen to be linearly chained.

Edge-scoped bind closes this gap with a small, self-contained mechanism.

## 2. The proposal in one sentence

Add a sixth `$from` value, `"edge"`, that resolves against **the unique
control-flow predecessor** of the referencing node. Producers continue to
declare `bind` exactly as today; the choice of visibility moves to the
**consumer**, who picks `$from: "scope"` (full-scope visibility, current
behavior) or `$from: "edge"` (predecessor-only).

```jsonc
"summarize": {
  "kind": "task",
  "task": "llm.summarize",
  "inputs": {
    // Reads the immediate predecessor's bound output.
    // Equivalent in result to $from:"scope",name:"fetch",
    // but expresses "this is a one-step handoff".
    "text": { "$from": "edge", "path": ["body"] }
  },
  "next": null,
  "bind": "result"
}
```

The `name` field is **omitted** for `$from: "edge"`: there is at most one
predecessor, so there is at most one bound name in scope to read. The
optional `path` and `optional` fields work as in any other reference.

## 3. Why a separate namespace

The natural way to read this proposal is "scope-bind, but narrower." That
framing is wrong and gets the design into trouble (it conflates two
different lookup rules and makes phi-merge interaction murky).

The right framing: `edge` is its own namespace, parallel to `scope`,
`input`, `state`, `constant`, `error`, `trigger`. It does not participate
in the scope namespace's binders set, phi merge, or dominator coverage
rules. A consumer says "I want the predecessor handoff" and the lookup
walks one CFG edge backwards. That's the entire mechanism.

This means:

- **Name resolution stays scope-flat per namespace.** The reader sees
  `$from: "edge"` and knows the lookup rule without looking at the CFG
  context (P5 holds: "predict by reading").
- **No third `bind` form.** Producers keep `bind: "<name>" | null`.
  Visibility is a read-side concept.
- **No interaction with phi merge.** `B(X)` for a `$from: "scope", name: X`
  reference is unchanged; edge-scoped reads aren't in any binder set.
- **Existing dominator pass is untouched.** Edge resolution is a one-step
  predecessor lookup, not a dominance query.

## 4. Why it slots in cleanly

The IR already has six `$from` discriminants (§3.4). Each declares its
own namespace, lookup rule, and legality scope. Adding a seventh is the
same kind of additive change that `error` and `trigger` were when handlers
were specified.

| Namespace  | Lookup rule                         | Legal where                |
| ---------- | ----------------------------------- | -------------------------- |
| `input`    | enclosing scope's declared input    | every scope                |
| `constant` | workflow root constants             | every scope                |
| `scope`    | scope-flat bound name               | every scope                |
| `state`    | enclosing loop's state slot         | loop body only             |
| `error`    | triggering error value              | handler `inputs` only      |
| `trigger`  | triggering node's input field       | handler `inputs` only      |
| **`edge`** | **unique CFG predecessor's `bind`** | **in-degree-1 nodes only** |

The legality column is what carries the new validator rule. See §6.

## 5. Sketch

### 5.1 Linear handoff (the common case)

```jsonc
"fetch": {
  "kind": "task",
  "task": "http.get",
  "inputs": { "url": { "$from": "input", "name": "url" } },
  "next": "summarize",
  "bind": "fetch"                    // produces the value
},
"summarize": {
  "kind": "task",
  "task": "llm.summarize",
  "inputs": {
    "text": { "$from": "edge", "path": ["body"] }   // consumes from predecessor
  },
  "next": null,
  "bind": "result"
}
```

`fetch` still binds (so its output exists in the runtime), but no node
other than `summarize` can name it. If a future edit inserts `analyze`
between `fetch` and `summarize`, `summarize`'s `$from: "edge"` reference
silently re-targets to `analyze` - which is a static error caught by
the type-compatibility pass if `analyze` doesn't produce a `body`-shaped
output. (See §7 "refactor semantics" for the discussion of this.)

### 5.2 What is illegal

```jsonc
"format": {
  // format is reachable from summarizeNews / explainCode / fallback
  // (in-degree 3). $from: "edge" is rejected by the validator.
  "kind": "task",
  "inputs": {
    "value": { "$from": "edge" }   //  ERROR: in-degree > 1
  }
}
```

Authors who want this pattern keep using `$from: "scope"` with the
SSA-style phi merge (§3.3).

## 6. The five design choices

### 6.1 Read-side switch, not write-side

The producer is unchanged. A consumer picks `scope` vs `edge` based on
what it wants to declare about its dependency. This means the same
producer can serve both an edge-scoped consumer (its successor) and
scope-scoped consumers (downstream readers) without changing its `bind`.

- **Pro:** producers don't need to predict their consumers' visibility
  preferences. A library task can be reused in both patterns.
- **Pro:** no third `bind` form; minimal grammar growth.
- **Con:** the producer can't enforce "I only want one reader." A
  malicious or accidental scope-scoped reader can still see the value.
  This is acceptable: hiding from accidents is the goal; the producer's
  `bind` already says "I'm publishing this."

The opposite framing (write-side switch: `bind: { to: "successor" }`)
was rejected because it puts visibility control on the wrong side and
adds the third `bind` form that §8.15 explicitly avoided.

### 6.2 In-degree-1 restriction

`$from: "edge"` is legal only on nodes whose CFG in-degree (within their
scope) is exactly 1. The validator rejects it on:

- Branch join points (multiple `next`/`cases` edges arrive).
- Loop `body.entry` (entered from loop init AND from `@iterate`).
- Handler nodes (entered only via `onError`; see 6.3).
- Any node reachable from more than one upstream `next`.

The error is local and explainable: "edge-scoped reference requires a
unique predecessor; this node has N." Authors who want the pattern at a
join point use `$from: "scope"` (with phi merge if needed).

This rule is the one new validator check. It runs in pass 4 (name
resolution) or pass 6 (dominator), both of which already iterate the
CFG.

### 6.3 Handlers and `onError`

A handler's CFG predecessor is its triggering node `T`, but `T` failed
by definition - its output value is not available. `$from: "edge"` on a
handler is therefore rejected by the validator. Handlers continue to
use `$from: "error"` (the failure value) and `$from: "trigger"` (T's
inputs); these already cover the handler's needs without overloading
edge.

### 6.4 Loop body interactions

Inside a loop body, edge-scope works exactly like in the workflow scope,
subject to the in-degree-1 rule. `body.entry` cannot use `$from: "edge"`
(in-degree > 1 because `@iterate` re-enters it). Other body nodes with
unique predecessors can use it freely.

A node whose `next` is `@iterate` or `@exit` does not change its own
ability to use `$from: "edge"`; the sentinel is on the outgoing side.

### 6.5 Cross-scope rule (block scope, sub-workflow)

`$from: "edge"` resolves within the consumer's scope only, like every
other reference. A block or sub-workflow's first body node has no
predecessor in its own scope (its predecessor is the block / call node
in the outer scope), so `$from: "edge"` is illegal there. The data
must enter via the scope's declared `inputs`, exactly as today.

## 7. What this does NOT change

- **Liveness rules.** The SHOULD "free after last reader" already
  collapses to "free at successor's completion" for any value whose
  only reader is the successor. Edge-scope makes that fact statically
  obvious without changing the rule.
- **Phi merge.** Edge-scoped reads are not in `B(X)`. The §6.2 diamond
  pattern (multiple branch arms binding the same scope name) keeps
  working unchanged.
- **Dominator pass.** Edge-scope adds a one-step lookup, not a
  dominance query. The pass 6 algorithm is the same.
- **Producer's `bind`.** Still `"<name>" | null`. Still publishes
  to the scope namespace. Edge-scope is a parallel read mechanism, not
  a replacement.
- **Refactor semantics.** Inserting a node between producer and
  consumer changes the predecessor that `$from: "edge"` resolves to.
  This is intentional - it makes "I am reading the value handed to me"
  the literal meaning. If the new intermediate node binds a
  type-compatible value, the workflow keeps validating; if not, the
  type-compatibility pass flags it. Authors who want refactor-stable
  references use `$from: "scope"` with an explicit name.

## 8. What this does NOT buy

- Not **producer-enforced one-reader semantics.** A scope-scoped reader
  elsewhere in the scope can still reach the producer's bound output. A
  truly private value still requires "fold the consumer into the producer"
  or (post-v1) a block scope that contains both.
- Not **a replacement for block scope.** Blocks give region-grain
  visibility (multiple producers and consumers, all hidden from outside).
  Edge-scope gives one-step-grain visibility. They solve different
  shapes; both are useful.
- Not **dynamic edge selection.** The predecessor is whatever the CFG
  says it is, statically. There is no "choose your predecessor at
  runtime" form (P1 scenario 8 still applies).

## 9. Why record this now

Two near-term design conversations are influenced by knowing this
exists in the post-v1 backlog:

- **Bound-outputs review** (§8.15) currently has Alts A-C covering full
  hide/share polarity choices. Adding "edge-scoped read" as Alt D - and
  pointing at this file - keeps the §8.15 discussion shaped correctly:
  the bind-vs-no-bind axis is settled, and the orthogonal
  read-granularity axis has a concrete post-v1 proposal.
- **DSL design.** A `let x = f() in g(x)` lowering with `x` not escaping
  `g` has a clean target (`f` binds, `g` reads `$from: "edge"`). DSL
  designers can rely on this being the planned lowering rather than
  inventing their own escape-analysis convention.

## 10. Open questions

- **Naming.** `"edge"` is the most accurate (it names the CFG construct
  it resolves over), but `"prev"` or `"predecessor"` may read more
  naturally. The name is a bikeshed, not a design issue.
- **Producer-side opt-out.** Should a producer be able to declare "I am
  bound but my value is only consumable via `$from: "edge"`" (a
  write-side hint that scope-scoped reads of this name are illegal)?
  This is the "private bind" idea. Probably no: it splits `bind` into
  two flavors and reintroduces the third-form complexity that §6.1
  rejected. If the use case proves out, it's an additive future change.
- **Interaction with effect-ordering `next` edges.** Once §3.2.2's v1
  limitation closes (post-v1 side-effect declarations), a `next` edge
  may exist purely to sequence side effects, with no data flow. An
  edge-scoped consumer on such a node would still be valid (it reads
  the producer's bound output, regardless of why the edge exists), but
  the validator may want to warn when an edge that exists only for
  effect-ordering carries an edge-scoped data read - the read suggests
  the edge is doing double duty and might benefit from being split.
  Defer to whichever proposal lands first.
- **Tooling display.** Visualizers should probably draw edge-scoped
  reads as part of the CFG arrow (since they ride the same edge),
  rather than as a separate DDG arrow. Cosmetic.
