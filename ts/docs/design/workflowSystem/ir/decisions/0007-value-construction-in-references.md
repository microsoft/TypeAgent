# Value construction in references (decision 0007): template-with-`$from`

Status: **Accepted.** Alternative G with G-K1.a disambiguation adopted.
Folded into [../ir-v1.md](../ir-v1.md) §3.4, §4.1 passes 4/6/7.
Revisit trigger in [../revisit-triggers.md](../revisit-triggers.md) row 10.

Related:

- Morning-brief scenario friction S1 (no inline literals: 6 constants for single-use values)
- Summarize-url scenario friction S3 (no object construction: required an `assemble` task)
- [0001-bound-outputs.md](0001-bound-outputs.md) (this decision is about the _consumer_ side; 0001 was about the _producer_ side)
- [../ir-v1.md](../ir-v1.md) §1.2 (no sugar), §1.3.1 (minimization), §1.3.2 (uniformity / variance), §3.4 (reference objects)

## 1. The proposal

Today, every `inputs.<field>` and every `output` position in the IR
is a single **reference object**:

```jsonc
{ "$from": "scope" | "input" | "constant" | "state",
  "name": "<name>", "path"?: [...], "optional"?: true }
```

A reference can only **project** from one source (via `path`); it
cannot **assemble** a value from several sources, and it cannot
contain a literal.

Proposed change: at any reference position, in addition to the four
`$from` discriminants, allow two more:

- **`$value`** - an inline JSON literal.

  ```jsonc
  { "$value": "email" }
  { "$value": 0 }
  { "$value": [] }
  ```

- **`$build`** - an object or array whose elements are themselves
  reference objects (recursively). Builds a fresh value from named
  sources.

  ```jsonc
  { "$build": {
      "path":    { "$from": "scope", "name": "joined",     "path": ["path"] },
      "summary": { "$from": "scope", "name": "summarized", "path": ["summary"] }
  }}

  { "$build": [
      { "$from": "scope", "name": "a" },
      { "$from": "scope", "name": "b" }
  ]}
  ```

The set of legal reference forms becomes six discriminated by their
sole top-level key: `$from`, `$value`, `$build`. (`$from` carries
`name`/`path`/`optional` siblings; `$value` and `$build` carry only
their own key.)

The legal reference grammar is:

```
Ref      := FromRef | ValueRef | BuildRef
FromRef  := { "$from": "input"|"constant"|"scope"|"state",
              "name": <string>, "path"?: <PathSeg[]>, "optional"?: true }
ValueRef := { "$value": <JSON> }
BuildRef := { "$build": <BuildBody> }
BuildBody:= { <string>: Ref, ... } | [ Ref, ... ]
```

`$value` and `$build` may appear anywhere `$from` may appear: an
`inputs.<field>` value, a workflow `output`, a loop `output`, a
`state[*].initial`, an `iterateState[*]` entry, a branch `selector`.

## 2. What it solves

| ID  | Concern                                                                                                       | Resolution                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | A4 §4.1 S1: every per-call literal needs a `constants` entry. The block grows linearly with use sites.        | `$value` puts the literal at the use site. `constants` reverts to its actual purpose: shared values.                                                                                                                      |
| S2  | B1 §4.1 S3: workflow `output` cannot combine values from two bound nodes; needs a single `assemble` task.     | `$build` constructs the output object inline. No assembler task.                                                                                                                                                          |
| S3  | B1 §4.1 S2: surfacing one body-computed value from a loop requires promoting it to `state` plus an `initial`. | `state[*].initial` accepts `{ "$value": null }`; `iterateState` and final `output` already reference state cleanly. The pattern remains, but its mechanics get a name.                                                    |
| S4  | A4 §4.1 G3: minimization decisions multiply at use sites.                                                     | `$value` collapses the constants overhead. `$build` collapses the assembler-task overhead. Together they remove most of the multiplicative cost.                                                                          |
| S5  | DSL compilation target: every realistic DSL needs literals and record/object construction.                    | Both lower 1:1. `let x = { a: a, b: b }` becomes a `bind` of a node that outputs `$build`-constructed value, OR (if `$value`/`$build` are accepted in `output`) the DSL can avoid creating an intermediate node entirely. |

## 3. Concerns

### K1. This is "sugar" by §1.2's stated rule

§1.2 says "every node kind, every edge, every reference is written
out. ... The IR will look verbose. That is intentional." The current
`constants`-only literal model and the required-assembler-task pattern
are the consequences §1.2 endorses.

But the §1.2 audience analysis (§1.1) draws a finer line. Sugar is
rejected because it forces _codegen and readers_ to handle multiple
spellings of the same thing. `$value` and `$build` are not multiple
spellings; they are new behavioral capabilities (literal at a
position, fresh-value construction at a position) that today require
disproportionate workarounds.

The §1.3 variance lens ("same rule, same surface") is what §1.2
actually defends. `$value` introduces one rule (a literal at a
reference position evaluates to itself) with one surface. `$build`
introduces one rule (a build expression evaluates each leaf reference
and assembles them) with one surface. Neither overloads an existing
form.

The argument therefore is not "is this sugar?" but "does this add a
behavioral rule the existing concepts do not cover, with a single
surface form?" By that test (the §1.3 phrasing), `$value` and
`$build` qualify.

### K2. Concept count

§1.3 commits to "the fewest concepts that satisfy P1-P5". This
proposal adds two reference forms. Counting concepts by behavioral
rule (§1.3 measurement):

- `$from` is one concept (single-assignment-per-frame projection),
  parameterized over the four namespaces.
- `$value` is one concept (literal value at a reference position).
- `$build` is one concept (compositional construction; no name, no
  frame, no lifetime - it evaluates leaves and aggregates).

Three concepts in reference position vs. one today. The increment is
real. The defense is that the alternatives currently in the IR
(constants for every literal; an assembler task for every multi-field
output) are themselves concepts being smuggled in via the existing
mechanisms - they spend `task` and `constant` budget on what is
really value-shaping.

### K3. Validation scope creep

Today the validator checks each reference against a single producer's
type. A `$build` reference's type is the recursively-built type from
its leaves; the validator must compose that type and check it against
the consumer's expected schema (§4.1 pass 7).

This is mechanically straightforward (the JSON Schema of a `$build`
object is the object schema with each property's type drawn from the
corresponding leaf), but it is new work for the validator. The
existing per-reference checking loop becomes a post-order traversal
into `$build` bodies.

For dominator analysis (§4.1 pass 6), each `$build` leaf that is a
`$from: "scope"` reference contributes a DDG edge exactly as it would
at top level; the dominator pass walks into `$build` bodies the same
way it currently walks into `inputs` maps. No new analysis kind, just
more reference sites to visit.

### K4. `$value` and untyped JSON

A `$value` literal is JSON. Its type is whatever the surrounding
schema position requires. The validator checks the literal against
that schema (the same check it does for a constant's `value` against
its declared `schema` today). No new mechanism.

The one wrinkle: a `$value` cannot be _given_ a `$ref` schema by the
author - it has no schema field. It is checked structurally against
the schema of the position it appears in. This is the only consistent
behavior (literals are values, not declarations) but it differs from
`constants`, where the author writes `schema` + `value` together.

### K5. `$build` and recursion

`$build` bodies may nest `$build` recursively (an object whose values
are themselves built objects). This is a single rule applied
recursively, not a new concept. Cycles are syntactically impossible
because JSON itself is acyclic.

### K6. Overlap with `path` projection

`path` projects a sub-value out of a single source. `$build` assembles
a value from multiple sources. They are orthogonal: `path` is a
read-side operator that lives inside a `$from` reference; `$build` is
a top-level reference form whose leaves are themselves references
(each of which may have its own `path`).

There is no overlap in capability and no redundancy in surface.

### K7. Performance and the §1.1 "acceptable cost" requirement

The §1.1 sufficiency-vs-cost lens requires the engine to do every
dispatch decision cheaply. Reference resolution today is one source
lookup plus an optional path walk. With this proposal:

- `$from` - unchanged.
- `$value` - one constant lookup (the literal is the value).
- `$build` - recursive evaluation of leaves, then aggregation.

A `$build` reference's cost is the sum of its leaves' costs plus
linear assembly. Bounded, predictable, and no global re-walk. Within
the §1.1 budget.

### K8. What about expressions?

This proposal does NOT introduce expressions (arithmetic,
concatenation, comparisons). Those are the topic of a separate
decision: [0006-no-expressions-in-ir.md](0006-no-expressions-in-ir.md).
The two questions are separable: literals + object construction is
about value _shape_; expressions are about value _computation_.
Deciding one does not commit the other.

This separation matters because the value-shape question has unanimous
scenario evidence (A4 + B1 both blocked) while the expressions
question still has live alternatives (standard-library tasks for
arithmetic; or DSL-only).

### K9. Bind-name necessity for intermediate values

Without `$build`, every multi-field value in the IR has to be
produced by a task and `bind`-ed. With `$build`, a one-shot value
has no name and no bind site. Reviewers no longer have a node to
locate when reading the IR.

This is mostly fine for small literal-or-projected values (the typical
`$build` use case) but could degenerate if authors build large
structures inline. Mitigation is conventional, not normative: a
linter rule capping `$build` body size or a style guide preferring a
named bind for shapes above N fields.

This is a real cost. It does not appear free.

## 4. Alternatives considered

### A. Status quo: constants for literals, assembler tasks for objects

The default. Costs documented in morning-brief scenario §4.1 S1
(6 constants for single-use literals) and summarize-url scenario
§4.1 S3 (assembler task exists only for aggregation).

The most decisive datum is the count: A4 needed 6 constants for
single-use literals, growing with the number of distinct literals.
B1 needed an `assemble` task that exists for no purpose beyond
aggregation. Both are observable in the IR and both will appear in
every realistic workflow. The status-quo cost is high and recurring.

### B. `$value` only (literals), no `$build`

Closes A4 §4.1 S1 but not B1 §4.1 S3. Half the value, less than half
the increment (one new concept instead of two). Tempting as a
minimum.

But B1 §4.1 S3 (workflow output assembly) is at least as common as
literals; every workflow with a structured output hits it. Shipping
`$value` without `$build` makes A4-style workflows easier and B1-style
workflows still painful. Asymmetric in a way that doesn't track any
principle.

If we chose this, we would write the `$build` decision again in three
months. Recommend against partial adoption.

### C. `$build` only (objects), no `$value`

Closes B1 §4.1 S3 but not A4 §4.1 S1. The literals problem stays:
authors keep declaring constants for every per-call-site value.

`$build` without `$value` also forces leaves to be `$from` references,
so a `$build` of a constant `"email"` still requires a constants
entry. Strictly worse than (B).

### D. Allow `$value` and `$build` only at workflow `output` and loop `output`, not in `inputs`

Restricts the new forms to the most-cited site (the output that was
the trigger). Smaller blast radius.

But the literal pressure (A4 S1) is at `inputs` positions, not at
`output`. Restricting to `output` closes B1's surfaced issue and
leaves A4's open. Asymmetric.

If the concern is gradual rollout, the right axis is to ship `$value`
and `$build` everywhere and let usage demonstrate where they pay off,
not to ship them at one position only.

### E. Defer everything: introduce a DSL for these cases

The DSL absorbs literals (S1) and object construction (S3) at
authoring time. Codegen lowers to constants and assembler tasks.

This works _if_ the DSL exists. As of pre-v1, no DSL exists, no
codegen exists, and the IR is what reviewers actually read and what
LLM-direct-to-IR (the §1.1.2 fallback) actually emits. Deferring
value-shape capability to "the DSL we will build" indefinitely
leaves the IR unwritable by hand and unreadable by review.

The §1.1.2 LLM-direct-to-IR fallback is explicitly required to stay
viable. Without `$value` and `$build`, an LLM writing IR directly
must emit constants blocks and assembler tasks correctly under retry
pressure. That is observably harder than emitting the literal in
place.

The DSL is not an argument _against_ this proposal; it is an
argument that the proposal's surface should also be what codegen
emits, not just what humans hand-write. Both work the same way under
this proposal.

### F. Limit `$value` to JSON primitives (no objects/arrays)

Allow `{ "$value": "email" }` but not `{ "$value": { ... } }`. Forces
authors to use `$build` for non-primitives, which keeps "compose from
named values" visible.

Tempting for clarity. But it adds a special case (primitive vs. not)
to the reference grammar with no behavioral payoff: a literal object
is structurally equivalent to a `$build` of `$value` leaves, and the
validator handles both identically.

Recommend against. Either ship `$value` for any JSON or do not ship
it; partial restrictions earn no rule.

### G. Reference position holds a JSON template (one form, not three)

The 3-form proposal carves reference positions into three
discriminated cases. There is a single, more uniform model that
subsumes all three: **a reference position holds a JSON value, which
is interpreted as a template. The only special form inside that
template is `{ "$from": ... }`; everything else is a literal.**

Under this model:

```jsonc
"inputs": {
  // pure literal at the position - no wrapper needed
  "section": "email",
  "max":     5,
  "tags":    [],

  // pure reference at the position
  "url": { "$from": "input", "name": "url" },

  // mixed: an object with literal fields and reference fields
  "config": {
    "section": "email",
    "max":     { "$from": "input", "name": "maxEmails" },
    "tags":    []
  },

  // arrays mix the same way
  "ids": [
    "alpha",
    { "$from": "scope", "name": "computedId" },
    "omega"
  ]
}
```

The mental model collapses to one rule:

> **A reference position holds a JSON template. The engine evaluates
> it by walking the JSON; any subtree of the form `{ "$from": ... }`
> is replaced with the resolved value. Everything else is a literal.**

That is the entire grammar. There is no `$value` (a literal at the
position is just the literal) and no `$build` (an object or array at
the position is naturally interpreted as a template combining its
parts).

The legal grammar reduces to:

```
Position := <JSON>                         // any JSON, interpreted as a template
Template := Literal | FromRef | TemplateObject | TemplateArray
Literal  := <JSON without $from anywhere>  // returned as-is
FromRef  := { "$from": "input"|"constant"|"scope"|"state",
              "name": <string>, "path"?: <PathSeg[]>, "optional"?: true }
TemplateObject := { <string>: Template, ... }   // any object that is not a FromRef
TemplateArray  := [ Template, ... ]
```

#### What this collapses

| Mechanism                           | 3-form (B-F)                           | Template (G)                                  |
| ----------------------------------- | -------------------------------------- | --------------------------------------------- |
| Concepts at reference position      | 3 (`$from`, `$value`, `$build`)        | 1 (template with `$from` holes)               |
| Wrapping a literal `"email"`        | `{ "$value": "email" }` (17ch)         | `"email"` (7ch)                               |
| Wrapping a literal `[]`             | `{ "$value": [] }` (15ch)              | `[]` (2ch)                                    |
| Building `{a, b}` from two refs     | `{ "$build": { a:..., b:... }}`        | `{ "a": ..., "b": ... }` directly             |
| LLM-emit instructions               | "wrap literals; wrap builds"           | "emit JSON; use `$from` for runtime data"     |
| Reader test: "is this a reference?" | Look for `$from`/`$value`/`$build` key | Look for `$from` key                          |
| Validator dispatch                  | 3-way switch on top-level key          | walk JSON, treat `$from` subtree as reference |

The verbosity reduction is significant on its own (B1's IR shrinks
~30% under (G) vs. ~10% under the 3-form proposal). The conceptual
reduction is the larger win: the IR contract collapses from "three
kinds of value-shaping at reference positions" to "JSON, with a
single special form."

#### Precedent

This is the standard pattern in declarative-config systems that
embed runtime references inside JSON: ARM templates and Bicep
(`[parameters('x')]`), CloudFormation (`{ "Ref": "Foo" }`,
`{ "Fn::Sub": "..." }`), Kubernetes downward API references. The
choice consistently across the industry is "templates with
discriminated reference holes," not "three separate wrapper kinds."
Adopting (G) puts the IR in known company; adopting the 3-form
proposal makes it idiosyncratic.

#### Concerns specific to (G)

**G-K1. Reserved-key collision.** If an author wants a literal
object whose value is `{ "$from": "lookup" }` (e.g., schema metadata
that mentions `$from`, an embedded JSON Schema fragment, an IR-as-data
payload), the engine will mistake it for a reference and fail to find
a `name` field.

The collision is intrinsic to any "JSON template with discriminated
holes" model; what varies is how much surface the disambiguation
reserves and whether an escape is needed. Six options:

**G-K1.a. Reserve `$`-prefixed keys; `$literal` escapes.** The
mitigation in the original (G) write-up. Reserves a whole prefix;
adds one escape rule (`{ "$literal": <any> }` returns its argument
verbatim). Matches the JSON Schema (`$ref`, `$id`) and JSON-LD
(`@id`, `@type`) precedent of using a sigil to mark engine-reserved
namespace.

- **Cost:** one prefix-wide reservation; one escape concept.
- **Benefit:** future engine extensions (`$secret`, `$fn`, ...) can
  add new keys without re-disambiguation.
- **Reader test:** "is this a reference?" → "is the top-level key
  `$`-prefixed and recognized?"

**G-K1.b. Reserve only `$from`; no `$literal`.** Reserve exactly the
one key that exists today. Authors who need a literal `{"$from": ...}`
in user data must restructure (rename the field, wrap in a deeper
object, etc.). No escape mechanism.

- **Cost:** zero new escape rule; user data with literal `$from` is
  effectively forbidden.
- **Benefit:** smallest possible reservation. Honest about today's
  needs; defers escape design until a real use case arrives.
- **Reader test:** "is this a reference?" → "does the object have a
  `$from` key?"
- **Risk:** if a future engine extension wants `$secret` or `$fn`, it
  has to either re-open this decision or live with the same
  collision risk.

**G-K1.c. Single sentinel key: `{ "$": { "from": ..., "name": ... } }`.**
Reserve exactly one key, named `$`, whose body holds the discriminated
form. Today's `$from` becomes `$.from`; today's `path`/`optional`
become `$.path` / `$.optional`. Literal `{"$from": ...}` in user data
is fine because `$from` is no longer special; only the bare `$` key is.

- **Cost:** every reference is one wrapper level deeper. Slight
  surface weight at every use site.
- **Benefit:** smallest possible reservation surface (one literal
  character that is rare in real-world JSON keys). One escape need
  is conceivable but not actually required by today's IR.
- **Reader test:** "is this a reference?" → "does the object have a
  `$` key?"
- **Risk:** a single character is unusual for an object key and
  reads as cryptic. JSON tooling does not highlight `$` specially
  the way it does `$ref`.

**G-K1.d. Per-position template/literal distinction.** The IR's
schema declares which positions are _templates_ (interpret `$from`)
and which are _opaque literals_ (no interpretation). Today the
opaque-literal positions are `constants[*].value`, `inputSchema`,
`outputSchema`, `selectorSchema`, `state[*].schema`, `types[*]`. The
template positions are `inputs.<field>`, `output`, `state[*].initial`,
`iterateState[*]`, `selector`. User data containing `$from` lives in
opaque positions and is never interpreted; references live in template
positions and are interpreted as today.

- **Cost:** the IR's schema gains a "is this position a template?"
  bit. Two evaluation rules instead of one.
- **Benefit:** zero collision risk in the positions where collision
  would be most painful (schemas, constants, types - exactly the
  positions where literal `$from`/`$ref`/etc. show up most often).
  No `$literal` escape needed because the opaque positions don't
  interpret anything.
- **Reader test:** "is this a reference?" → "what kind of position
  is it?" (answerable from the IR schema, not from the value alone).
- **Risk:** position-context-dependent interpretation. A reader who
  doesn't know whether they're looking at a template position or a
  schema position can't tell what `{"$from": ...}` means.

**G-K1.e. `$expr` envelope around evaluated subtrees.** A reference
position holds a literal JSON value by default; to enable template
evaluation in any subtree, wrap it in `{ "$expr": <template> }`.
Outside `$expr`, every key is literal data; inside, `$from` is the
discriminator.

- **Cost:** every template-using position needs the wrapper. The
  90% case (a position that uses references) gets a wrapper layer
  it would otherwise not need.
- **Benefit:** outside `$expr` there is zero collision. The
  evaluated/literal split is structurally explicit.
- **Reader test:** "is this evaluated?" → "is the enclosing context
  inside an `$expr`?"
- **Risk:** adds wrapper at the most common use site to fix a rare
  collision case. Bad cost-benefit.

**G-K1.f. Type-driven disambiguation.** Treat `{"$from": ...}` as a
reference only when the schema at that position permits the resolved
type; otherwise treat it as a literal.

- **Rejected** (carried over from the original G-K1): the
  reference/literal split depends on the consumer's schema, which is
  exactly the kind of context-dependent rule §1.3 ("same rule, same
  surface") rules out.

#### Comparison

| Option               | New reservations                  | Escape needed?        | Wrapper at use site                       | Future extension                          | Reader rule                       |
| -------------------- | --------------------------------- | --------------------- | ----------------------------------------- | ----------------------------------------- | --------------------------------- |
| (a) `$`-prefix       | A whole prefix                    | Yes (`$literal`)      | None                                      | Open (add new `$X`)                       | "top-level key is `$`-prefixed"   |
| (b) `$from` only     | One key                           | No                    | None                                      | Closed (re-open this decision)            | "top-level key is `$from`"        |
| (c) `$` sentinel     | One key (`$`)                     | No (today)            | One level on every reference              | Open (`$.fn`, `$.secret`)                 | "top-level key is `$`"            |
| (d) Per-position     | None on values; one bit on schema | No                    | None                                      | N/A (additive in template positions only) | "what kind of position"           |
| (e) `$expr` envelope | One key (`$expr`)                 | N/A (default literal) | Wrapper at every reference-using position | Open (under `$expr`)                      | "is the context inside `$expr`?"  |
| (f) Type-driven      | None                              | No                    | None                                      | N/A                                       | "schema-dependent" - **rejected** |

#### Lens analysis on the live options

**§1.2 (no sugar).** All options have one surface for one rule;
none introduces sugar in the §1.2 sense.

**§1.3.1 (minimization).** This sub-lens scores the live options
**by what they add today against scenarios that exist today**:

- (b) wins clearly. One reserved key. No `$literal` concept. No
  reservation surface for keys that have not been proposed. No
  current scenario (A4, B1, or anything in the wider-scope
  inventory) requires `$literal`; the literal-`$from` collision is
  hypothetical at v1.
- (a) loses on this sub-lens. It adds `$literal` and reserves an
  open prefix as future-proofing for `$X` keys that have not been
  designed. §1.3.1's speculative-extension test (ir-v1.md §1.3.1)
  is explicit: "a concept proposed for 'future uniformity' with no
  current scenario that needs it fails §1.3.1."
- (c) and (e) also lose: each adds a permanent surface cost
  (sentinel, wrapper) for a hypothetical case.
- (d) is neutral on minimization (no new surface), but loses on
  §1.3.2 below.

**§1.3.2 (uniformity: P3's representation-surface axis).** All five
live options pass the basic test today (one rule, one surface form
today). The variance is in _how local_ the rule is and _how stable_
it is across IR evolution:

- (a), (b), (c), (e) are **purely local**: a single object's keys
  decide whether it is a reference. A reader can answer
  "reference or literal?" by looking at the object alone.
- (d) is **context-dependent**: the same object means a reference
  in one position and a literal in another. This is the P3
  representation-surface amber flag: not "same rule, two surfaces"
  but "two rules, same surface."
- (a) wins on a forward-looking variant of §1.3.2: when a second
  engine-recognized template key is added, (a) extends without
  changing the reader's rule ("`$`-prefixed at template root is
  engine-recognized"). (b) requires the reader to _re-learn_ the
  rule (no longer "key is `$from`"; now "key is `$from` or `$X`").
  This forward-looking score depends on the prediction that more
  `$X` keys will appear; if none do, (a)'s win evaporates and (b)
  was right on §1.3.1 grounds.

**Net §1.3.** (b) wins minimization; (a) wins uniformity (P3). This
is the characteristic P3-vs.-minimization tension the design handles
by deferring until scenario-driven (MapNode, expressions, per-scope
constants are all the same shape). §1.3 does not deliver a single
verdict. The deciding question is the prediction in the last bullet:
do we expect a second `$X` template-position key during v1's
lifetime?

**§1.1 (audience).**

| Audience                        | (a)                                   | (b)                                     | (c)              | (d)                                 | (e)                               |
| ------------------------------- | ------------------------------------- | --------------------------------------- | ---------------- | ----------------------------------- | --------------------------------- |
| Engine sufficiency              | OK                                    | OK                                      | OK               | OK (plus position lookup)           | OK                                |
| Reviewer (locality)             | Local                                 | Local                                   | Local            | **Non-local**                       | Local                             |
| Codegen (one way per construct) | One way                               | One way                                 | One way          | One way per position kind           | One way (with wrapper)            |
| LLM-direct emission             | "use `$from`; escape with `$literal`" | "use `$from`; restructure if collision" | "wrap in `$.`"   | "use `$from` in template positions" | "wrap evaluated parts in `$expr`" |
| Hand author                     | Easy                                  | Easy (mostly)                           | Slightly cryptic | **Requires knowing position kinds** | Wrappers                          |

The LLM-direct (§1.1.2 fallback) row is interesting: (b) is the
simplest rule any LLM has to follow, (a) is the second simplest,
(d) is the trickiest because the LLM has to know which position
it is in.

**§1.4 (boundary closure).** All options preserve closure;
references resolve through `$from` regardless of disambiguation.

#### Recommendation

The choice is between **(b) "Reserve only `$from`"** (smallest
v1 commitment, no escape) and **(a) "Reserve `$`-prefix; `$literal`
escape"** (uniform reservation, escape always available).

This is a genuine trade-off, not a clean win. The two §1.3
sub-lenses (see ir-v1.md §1.3) point in opposite directions:

- **§1.3.1 (minimization) favors (b).** No current scenario in the
  validation corpus or in the wider-scope inventory requires
  `$literal`. The literal-`$from` collision class is hypothetical.
  Adding `$literal` and reserving the `$`-prefix at v1 pays a
  speculative-extension cost the minimization sub-lens explicitly
  rejects.
- **§1.3.2 (uniformity) favors (a).** One rule learned once for the
  IR's lifetime, even as new engine-recognized template keys appear.
  (b) sets a one-key rule that has to be re-learned the first time a
  second `$X` key lands.
- **P5 (predict behavior) favors (a), narrowly.** When the collision
  case fires, (a) gives a named, visible escape; (b) leaves authors
  with a structural workaround indistinguishable from intentional
  shape choice. The win is real but small because the case is rare.
- **§1.1 (audience) splits.** LLM-direct (§1.1.2) and
  reviewer-of-today's-IR favor (b)'s simpler rule. Codegen and
  reviewer-of-future-IR favor (a)'s longer-stable rule.

**Adopt (a), with the trade acknowledged.** The recommendation rests
on one prediction: at least one additional engine-recognized
template-position key will be proposed during v1's lifetime. If that
prediction holds, (a) saves a rule revision and an in-flight
`$literal` retrofit; (b) would have to land both later anyway. If the
prediction fails - no second `$X` ever appears - then (a) was
speculative and (b) was right on §1.3.1 grounds.

The prediction is plausible but not certain. Candidate future `$X`
keys discussed informally include `$secret` (capability-bounded
references), `$expr` (typed expressions, post-v1), and template
helpers for sub-workflow inlining. None is committed; none is
ruled out. (a) is a bet that at least one will land.

The other live options remain rejected:

- Option (c) (the `$` sentinel) pays a wrapper-at-every-use-site cost
  forever for a collision class that may never occur. Bad
  amortization.
- Option (d) (per-position) is rejected on §1.3.2 locality: "the
  meaning of `{"$from": ...}` depends on where it sits" is exactly
  the kind of non-local rule the §1.3.2 lens flags.
- Option (e) (`$expr` envelope) puts the wrapper cost at the common
  case and the saving at the rare case. Wrong direction.

**Folded recommendation:** v1 reserves all `$`-prefixed object keys
at template subtree roots; the only recognized form today is
`{ "$from": ... }`; `{ "$literal": <any JSON> }` evaluates to its
argument verbatim and is the escape for embedding values that
themselves contain `$`-prefixed keys. Future engine extensions add
new `$X` forms without re-disambiguation; every (a)-era IR remains
valid as new forms appear.

**Revisit trigger.** If, after N additional decisions (suggested:
five), no second engine-recognized template-position key has been
proposed and no scenario has surfaced a literal-`$from` collision,
revisit whether `$literal` and the `$`-prefix reservation are
earning their keep. The §1.3.1 case for retreating to (b) gets
stronger with each empty interval. Add this row to
[`../revisit-triggers.md`](../revisit-triggers.md) when 0007 is
folded into ir-v1.md.

**G-K2. Walking cost.** The validator and engine must walk every
template at every reference position to find `$from`s. Cost is
linear in template size; templates are bounded by IR size; this is
the same total cost as walking `$build` bodies under the 3-form
proposal. No new asymptotic cost.

**G-K3. "Where's the construction explicit?"** Under the 3-form
proposal, `$build` makes object construction visible by name. Under
(G), an object-shaped template just _is_ an object. Reviewers
identify a template by the absence of `$from` at the top level.

This is mostly fine: the syntax is the structure, exactly the way a
JavaScript object literal is the structure of the object it builds.
The "named ceremony for construction" that `$build` provided was
not buying anything other than self-identification, and templates
are self-identifying by shape.

The one place the loss is real is in error messages. Under the
3-form proposal, the validator can say "in `$build` body at
`workflow.nodes.compose.inputs.repoSections[2]`, leaf failed". Under
(G), the same message reads "at template position
`workflow.nodes.compose.inputs.repoSections[2]`, ...". Identical
information; slightly different framing. No real cost.

**G-K4. Type validation is the same problem with the same answer.**
The validator computes the type of the resolved template and checks
it against the position's expected schema. For a pure-literal
template, this is JSON Schema validation of the literal. For a
reference, it is the producer's output type (with `path` projection
applied). For an object template, it is the object whose fields are
the recursively-computed types. For an array template, ditto.

Identical to the 3-form proposal's `$build` validation, just applied
uniformly to every position.

**G-K5. Diagnostic naming.** Same JSON-pointer locator as `$build`
sub-question 5; nothing changes.

**G-K6. The §1.1.2 LLM-direct-to-IR fallback gets dramatically
easier.** Under the 3-form proposal, an LLM emitting IR has to
correctly choose among three wrapper kinds at every reference
position. Under (G), the LLM emits JSON with `$from` holes - the
same way it would emit any other parameterized JSON, which is the
LLM's strongest skill. The §1.1.2 "fallback stays viable"
requirement is materially better served.

**G-K7. P3's representation-surface axis (the variance test).**
"Same rule, same surface."
Three-form proposal: literal-at-position has surface `{ $value: x }`,
literal-as-build-leaf has surface `x` (because `$build` leaves are
themselves references and a leaf reference must be `$value`-wrapped
again). That is **one rule (literal at a value position) with two
surface forms.** The 3-form proposal _fails P3's representation-
surface test_ once you look at nested cases.

(G) has one surface for one rule: a literal at any depth is the
literal itself. No wrapping, no escape (unless you need a literal
`$`-keyed object, which is the K1 escape).

**This is the strongest individual argument for (G).** The 3-form
proposal violates P3's representation-surface axis (§1.3.2) in the
very area it is meant to govern. Note: this is the P3 / §1.3.2
(uniformity) sub-lens specifically; the 3-form proposal does not
fail §1.3.1 (minimization) on its own terms, since each of
`$from`/`$value`/`$build` corresponds to a distinct behavioral rule
the proposal claims is needed.

#### What is lost moving from 3-form to (G)

- The named ceremony of `$build` and `$value`. Under (G) you read a
  position's value to see what is going on; you do not read a
  discriminant key first. For some readers this is a loss of "what
  am I about to read" warning; for others it is a gain in "the IR
  _is_ the value."
- An explicit signal that a position is "definitely a literal" vs.
  "might be a reference." Under (G) you check by walking. In
  practice, JSON tooling (editors, linters, validators) can render
  this distinction via syntax highlighting on `$from`, exactly as
  they do for `$ref` in JSON Schema today.

#### Recommendation for (G)

**Adopt (G) instead of the 3-form proposal in §1.** Update §5 to
make (G) the recommended path; preserve §1's `$value`/`$build`
framing as the rejected stepping-stone that led to (G).

The rest of this document (sections 2 "What it solves," 3 K1-K9
concerns, 6 open sub-questions) applies to (G) with the
substitutions in this entry; the analysis that motivated §1 still
holds. (G) is a refinement of §1, not a different decision.

## 5. Recommendation

**Adopt Alternative G (template-with-`$from`)** with the **G-K1.a**
disambiguation: a reference position holds a JSON value, evaluated as
a template; `$`-prefixed object keys at template subtree roots are
reserved for the engine; the only recognized form in v1 is
`{ "$from": ... }`; `{ "$literal": <any JSON> }` evaluates to its
argument verbatim and is the escape for embedding values that
themselves contain `$`-prefixed keys.

This supersedes the 3-form (`$from` / `$value` / `$build`) framing in
§1 of this document. The §1 framing is preserved as the path that
led to (G) and as the case for _any_ value-construction mechanism;
(G) with G-K1.a is the specific shape recommended for adoption.

The case rests on four points, with the trade-off named honestly:

1. **Two scenarios independently surface the gap.** A4 needs literals;
   B1 needs object construction. Neither is the corner of the design.
   This evidence supports adopting (G) (template-with-`$from`); it is
   neutral on the (a) vs. (b) sub-question within (G).
2. **The increment is one rule (G) plus one escape (G-K1.a).** (G)
   adds one behavioral rule (template evaluation with `$from` holes);
   G-K1.a adds one escape (`$literal`) that completes the model
   uniformly for any present or future `$X`. The 3-form framing in
   §1 added three rules and _fails P3's representation-surface test_
   in nested cases (see §4 G-K7). The escape is the part where
   P3 / §1.3.2 (uniformity) and §1.3.1 (minimization) disagree:
   the characteristic P3-vs.-minimization tension. See §4 G-K1
   "Recommendation" for the explicit trade.
3. **The status-quo costs are recurring.** Every workflow pays them,
   every codegen output emits them, every reviewer reads them. Closing
   them once is cheaper than paying forever. This argues for (G) over
   status quo; it is again neutral on the (a) vs. (b) sub-question.
4. **(G) puts the IR in known company.** ARM/Bicep/CloudFormation/K8s
   downward API all use template-with-discriminated-holes. The 3-form
   alternative would be idiosyncratic. The cited precedents also all
   reserve a prefix and offer a literal-escape, which is mild
   additional support for (a) over (b).

The G-K1.a recommendation rests on one prediction: at least one
additional engine-recognized template-position key will appear during
v1's lifetime. If it does, (a) saves a later rule revision. If it
does not, (a) was a speculative-extension cost the §1.3.1
minimization sub-lens explicitly warns against, and (b) was right.
A revisit-trigger is added (see §4 G-K1 Recommendation) to test the
prediction over time.

Adoption changes [../ir-v1.md](../ir-v1.md):

- **§3.4 (reference grammar):** replace "every reference is the object
  above" with "every reference position holds a JSON template; an
  object whose top-level key is `$`-prefixed is engine-recognized; the
  recognized forms in v1 are `{ "$from": ... }` (a reference) and
  `{ "$literal": <any JSON> }` (an escape that yields its argument
  verbatim); any other object is a literal template."
- **§3.4.1 (path semantics):** unchanged; `path` lives on `$from` as
  today.
- **§4.1 pass 4 (name resolution):** walk each template position;
  resolve every `$from` subtree's `name` against its declared
  namespace; literals require no resolution.
- **§4.1 pass 6 (dominator):** each `$from` subtree contributes a DDG
  edge as today, regardless of nesting depth inside its template.
- **§4.1 pass 7 (type compatibility):** compute the template's
  resolved type compositionally (literals = their JSON-Schema-derived
  type; `$from` = producer output type with `path` applied; objects =
  property-wise; arrays = element-wise) and check against the
  position's expected schema.

It does not change any existing decision record; it does not invalidate
any existing scenario IR (they remain valid as-written; (G) makes the
_verbose_ form still legal but optional).

## 6. Open sub-questions if adopted

1. **Position-side schema declaration.** A template's resolved type is
   computed from its parts; the position's expected schema validates
   the result. Templates do not carry their own schema field.
   Recommendation: confirmed; this matches how every other JSON-Schema
   validator works.
2. **Empty objects and empty arrays as templates.** `{}` and `[]` are
   legal templates that evaluate to themselves. Recommendation: yes;
   the position's schema decides acceptability.
3. **Literal `null` at a value position.** A `null` literal is just
   the JSON value `null`. The §3.3 "absent fields, no `null`" rule
   governs _structural_ positions (`onError`, `bind`, `next`); a value
   position's schema decides whether `null` is acceptable.
4. **`optional` on a non-`$from` template.** `optional: true` is a
   property of `$from` (it controls what happens when the producer
   does not run); a literal or template-without-`$from` always produces
   its value. The validator rejects `optional` outside `$from`
   subtrees.
5. **Diagnostic naming inside templates.** Error messages use
   JSON-pointer locators
   (`workflow.nodes.compose.inputs.config.section`); identical to
   today's reference-position locators, just one level deeper inside
   templates.
6. **`$literal` interaction with `$from`.** `$literal` short-circuits
   template evaluation: its argument is returned verbatim, even if it
   contains `$from` subtrees or other `$`-prefixed keys. This is the
   only way to ship a literal `{ "$from": ... }` value (rare, but
   needed when an IR's data payload is itself another IR or a JSON-
   Schema fragment that mentions `$from`). Nested `$literal` is also
   verbatim: `{ "$literal": { "$literal": 1 } }` evaluates to
   `{ "$literal": 1 }`, not `1`. There is no way to "unescape" inside
   a `$literal` body, by design.
7. **`$from` as a sibling of other keys at the same object level.**
   Disallowed. `{ "$from": "scope", "name": "x", "extra": 1 }` is a
   reference, but `extra` is not a legal sibling of `$from`. Object
   templates and references are disjoint at any given level: an object
   either _is_ a reference (top-level key is `$from`) or it _is not_
   (no `$from` key at all). Mixing is rejected by the validator. This
   keeps the disambiguation rule strictly local.
