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

## 6. Key design rules (summary)

- **Read-side switch, not write-side.** Consumer picks `scope` vs `edge`; producer's `bind` is unchanged. No third `bind` form.
- **In-degree-1 restriction.** `$from: "edge"` is legal only on nodes with exactly one CFG predecessor. Rejected on join points, `body.entry`, and handler nodes.
- **Handlers excluded.** Handler's predecessor failed, so its output is unavailable. Handlers use `$from: "error"` and `$from: "trigger"`.
- **Cross-scope rule.** Resolves within consumer's scope only, like every other reference.

Does not change: liveness rules, phi merge, dominator pass, producer's `bind` form, or refactor semantics (inserting a node re-targets `$from: "edge"` to the new predecessor).

Does not buy: producer-enforced one-reader semantics, a replacement for block scope (different granularity), or dynamic edge selection.

## 7. Open questions

- Naming: `"edge"` vs `"prev"` vs `"predecessor"`.
- Producer-side opt-out ("private bind"): probably no, reintroduces third-form complexity.
- Interaction with effect-ordering `next` edges (defer to whichever proposal lands first).
- Tooling display: draw edge-scoped reads as part of the CFG arrow.
