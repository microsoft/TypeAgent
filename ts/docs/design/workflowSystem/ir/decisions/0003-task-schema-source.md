# Task schema source of truth (decision 0003)

Status: **Open.** IR currently follows option 1 (IR is source of truth).
This record captures the analysis so the choice is explicit.

## Question

A `task` node carries a `task: "<task type identifier>"` field that names a
registered task implementation, and also `inputSchema` / `outputSchema`
fields. The registered task implementation has its own input and output
contract. Where does the authoritative schema for a task node live: in the
IR, in the task registry, or both?

There are two questions hiding inside this:

1. **Source of truth for validation.** Which schema does the validator use
   when checking producer/consumer compatibility?
2. **Drift detection between IR and task.** Does the engine compare what
   the IR says about a task to what the task actually declares about
   itself, and if so, when (validation time vs. runtime) and in which
   direction (subtype vs. equality)?

The current IR answers (1) implicitly with "the IR" and (2) with
"runtime, output-side only" - the only check is `outputSchema` against the
task's actual return value (§5.2). Most of the design space lives in (2).

## Options

### Option 1 - IR is the source of truth (current IR wording)

Every task node restates `inputSchema` and `outputSchema`. The validator
runs against the IR alone. The task implementation is fully opaque at
validation time. At runtime, `outputSchema` is checked against the task's
return value (§5.2).

- **Pros.**
  1. IR is fully self-contained: validation needs no registry. This
     matters for portability, offline tooling, schema review, and the
     "IR is one document" property cited in §8.13 Alt B.
  2. **Specialization.** An IR author can declare a _narrower_ schema at
     the call site than the task accepts (e.g., the task accepts any
     string but this call only ever receives a URL-shaped string). The
     validator then enforces the narrower contract on upstream producers.
  3. **Authoring friction is the DSL's problem, not the IR's.** The IR
     is verbose by design (§1.1); a DSL or codegen layer can populate
     `inputSchema`/`outputSchema` from a TypeScript task signature.
- **Cons.**
  1. Real duplication: the same shape is written in the IR and in the
     task implementation. Two edit sites for the same fact.
  2. **Asymmetric, late drift detection.** Runtime `outputSchema`
     validation catches a too-loose task return, but never catches:
     - an IR `inputSchema` that disagrees with what the task actually
       requires (the task throws on an undeclared field, blamed at
       runtime),
     - an IR `outputSchema` that is _stricter_ than the task's actual
       return when the task happens to return a value passing the
       stricter shape (the disagreement is invisible until the task
       returns a value that fails the IR but would have passed its own
       contract),
     - any disagreement at validation time, before the workflow runs.

### Option 1' - IR is authoritative, validator also checks for drift

Identical to Option 1 in IR shape. Adds one validator step: when the
registry is available at validation time, the validator compares each
task node's `inputSchema` and `outputSchema` against the registered
task's contract and reports any incompatibility. The relation can be:

- **equality** (IR must exactly match task) - strictest, no
  specialization,
- **subtype-in-the-right-direction** - IR `inputSchema` must be a
  _subtype_ of the task's input (the IR promises at most what the task
  accepts) and the task's output must be a subtype of IR
  `outputSchema` (the task promises at least what the IR consumes).
  This is the same compatibility relation used by §4.2 and preserves
  Option 1's specialization story.

When the registry is not available (offline tooling, archival
validation), the IR still validates standalone exactly as in Option 1.
The drift check is a refinement, not a precondition.

- **Pros.** Everything Option 1 gets, plus:
  1. Drift caught statically and symmetrically (input and output, not just
     output).
  2. Costs nothing at the IR layer: no schema change, no fields added
     or removed. Pure validator extension.
  3. Specialization preserved if the subtype variant is chosen.
- **Cons.**
  1. Two failure modes for the same drift: registry-available runs catch
     it at validation time, registry-absent runs catch it at runtime (or
     not at all on the input side). Documentation must make clear which
     guarantees hold when.
  2. Slightly more validator complexity than bare Option 1, though it
     reuses §4.2.

### Option 2 - Task registry is the source of truth

The task node omits `inputSchema` / `outputSchema`. The validator looks
them up from the registered task. Runtime validation uses the same lookup.

- **Pros.**
  1. No duplication; one edit site.
  2. Schemas stay in sync with the implementation by construction.
- **Cons.**
  1. IR is no longer self-contained. Validation requires the task
     registry. Offline review tools, archival validation, and
     cross-deployment portability all weaken.
  2. No specialization: the IR cannot narrow the schema at a call site.
  3. Schema evolution in the implementation silently changes the IR's
     meaning. A task that adds an optional input field would let
     previously-invalid IRs become valid; a task that tightens a type
     would silently invalidate working IRs.
  4. Conflicts with the existing minimalism rule (§1.2): introduces an
     implicit dependency on a registry whose structure is not in the IR.

### Option 3 - Hybrid: task declares, IR may narrow

Task node `inputSchema` / `outputSchema` are _optional_. If present, the
validator checks they are structural subtypes of the task's declared
schemas (consumer narrows producer, the same compatibility relation used
elsewhere - §4.2). If absent, the task's declared schemas are used.

**Relationship to Option 1'.** Option 3 = Option 1' + the omission-as-sugar
feature. The drift-checking validator step is the same in both; Option 3
adds the optional omission of the schema fields and the loader rule that
fills them in from the registry before validation runs. So Option 3 cannot
be weaker than Option 1' on drift detection; the only thing it adds is
authoring-time brevity.

- **Pros.**
  1. Defaults to no duplication for the common case.
  2. Specialization (option 1's strength) remains expressible.
  3. Drift detection still works at the boundary.
- **Cons.**
  1. The default path requires a registry, weakening the
     "IR is self-contained" property in practice even though the
     mechanism preserves it in principle.
  2. Two ways to do the same thing (with and without the schema). Slight
     P5 surprise: a reader cannot tell from one node whether the schema
     is the canonical contract or a narrowing. (Variance lens, IR §1.3
     / §10: the same `inputSchema` field shape carries a context-
     dependent rule - canonical-contract vs. narrowing-of-loader-
     expansion - which is the "one label, two rules" pattern. The
     trade-off is real but small here because the loader expansion
     reduces both readings to the same canonical form before the drift
     check runs.)
  3. Validator complexity: now does subtype-of-registry-or-defaults-to,
     plus the existing producer-to-consumer subtyping.

## Forces / criteria

| Criterion                          | Option 1 | Option 1'  | Option 2 | Option 3                 |
| ---------------------------------- | -------- | ---------- | -------- | ------------------------ |
| IR self-contained                  | yes      | yes        | no       | partial                  |
| Standalone validation works        | yes      | yes        | no       | yes (canonical form)     |
| Single edit site for shared shapes | no       | no         | yes      | yes (when schema absent) |
| Specialization at call site        | yes      | yes        | no       | yes                      |
| Static drift detection             | no       | yes        | n/a      | yes                      |
| Symmetric drift (input + output)   | no       | yes        | n/a      | yes                      |
| Validator complexity               | low      | low-medium | medium   | medium                   |
| Reader surprise (P5)               | low      | low        | low      | medium                   |
| Minimalism (§1.2)                  | high     | high       | medium   | low                      |
| Friction without DSL               | high     | high       | low      | low                      |

## How the principles bear on this

The principles converge on Option 1. Each option is rated against the
relevant principles; the IR-vs-authoring framing in the principles
preamble does most of the work.

### IR vs. authoring (preamble: "The IR is not an authoring format")

> "If a syntactic convenience (pipeline mode, inferred node types, default
> wiring) hides data flow from the reader, it undermines the principles.
> Authoring sugar belongs in a DSL that compiles to the explicit IR."

Schemas describe the shape of every value that flows through the IR, so
they are part of the data-flow contract. Removing them from the IR to
save typing is exactly the "syntactic convenience that hides data flow"
the preamble rejects. It also settles the verbosity-vs-explicitness
question at the IR layer in advance of any per-decision review: be
verbose at the IR, push convenience to the DSL.

- Option 1: aligned. Schemas live at the IR layer where the contract
  is read; a DSL handles authoring friction.
- Option 2: directly violated. The convenience is in the IR, not in a
  separate authoring layer.
- Option 3: aligned **only if** the canonical form has the schemas
  filled in. The omitted-schema syntax must be a load-time sugar that
  the loader expands against the registry before validation hands the
  IR to any other tool. If the absent-schema form is itself the
  validated form, this collapses to Option 2.

### P4: each part can be understood / validated / tested without the whole

> "given only its declared boundary contract (control and data)"
>
> "A part can be understood, validated, and tested when both sides of its
> contract are declared at its edge."

A task node's `inputSchema` and `outputSchema` are the data side of its
boundary contract. P4's "without the whole" includes "without the task
registry": validating or testing a node should require only what the
node itself declares.

- Option 1: aligned. Both sides of the contract are at the node's edge.
- Option 2: violated. The data side of the contract lives in the
  registry; the node alone does not declare what flows in or out.
- Option 3 (canonical-form-has-schemas reading): aligned, because the
  validated form has the schemas at the node edge. Aligned only at the
  cost of the loader-expands-before-validation rule above.

### P2: all data flow is traceable through the IR alone

> "For any piece of data consumed by any task, you can trace its origin
> and every transformation by reading the IR."

Tracing requires knowing the shape at each hop, not just the
producer/consumer wiring. Named `types` (§8.13) already satisfy this:
type definitions are still in the document. A registry lookup pushes
shapes outside the document.

- Option 1: aligned.
- Option 2: weakened. "Reading the IR" no longer suffices to
  understand the shape of values flowing between nodes.
- Option 3: aligned (same conditional as P4).

### P5: predict engine behavior without knowing engine conventions

> "Someone reading the IR should be able to predict what the engine
> will do, without needing to know engine defaults, conventions, or
> inference rules."

Validation against a registry-resolved schema is exactly behavior that
depends on a convention not visible in the IR ("if `inputSchema` is
absent, look up `task` in the registry and use that").

- Option 1: aligned.
- Option 2: violated.
- Option 3: introduces the smallest predictability cost in the
  document - a reader of one node cannot tell from the node alone
  whether its declared schema is the canonical contract or a narrowing.
  This is the "Reader surprise (P5): medium" entry in the table above.

### P1: every reference statically provable

P1 requires the validator to prove compatibility at every reference. The
options differ in **how complete the proof is** at validation time:

- Option 1 proves producer/consumer compatibility at every IR-internal
  reference, but defers the IR/task agreement to runtime (and only on
  the output side). The seam between the IR and the task carries an
  un-proven assumption into runtime.
- Option 1' closes that seam: the IR/task agreement is also proved
  statically when the registry is available. This is the strongest
  reading of P1 - every place a value crosses a boundary, the validator
  can prove the shapes agree before the workflow runs.
- Option 2 has nothing to prove; there is only one schema.
- Option 3 is identical to Option 1' on this axis.

P1 does not, on its surface, mandate Option 1' over Option 1 (the
IR/task seam is at the IR/implementation boundary, which the
principles explicitly mark as opaque). But the **spirit** of P1 -
"prove what can be proven before running" - clearly favors 1' once you
notice the seam exists.

### Minimization rule (preamble, also IR §1.2)

> "The IR schema should use the fewest concepts necessary to satisfy
> P1-P5. Each new node type, field, or construct must earn its place by
> enabling something the existing concepts cannot express without
> violating a principle."

This is the only rule that could be read as supporting Option 2
("fewer fields per node"). But minimization is about not introducing
concepts that fail to earn their place against P1-P5; it does not say
strip fields whose purpose is to satisfy P2/P4/P5. The schemas earn
their place precisely because P2 and P4 require them.

### Net principle scorecard

| Principle / rule            | Option 1 | Option 1' | Option 2  | Option 3 (with loader expansion) |
| --------------------------- | -------- | --------- | --------- | -------------------------------- |
| IR vs. authoring (preamble) | aligned  | aligned   | violated  | aligned (conditional)            |
| P2 (traceability)           | aligned  | aligned   | weakened  | aligned                          |
| P4 (boundary contract)      | aligned  | aligned   | violated  | aligned                          |
| P5 (predictability)         | aligned  | aligned   | violated  | medium cost                      |
| P1 (static provability)     | aligned  | strongest | aligned   | strongest                        |
| Minimization                | aligned  | aligned   | aligned\* | low cost                         |

Option 1' is **strictly stronger than Option 1 on P1**: the static drift
check is exactly the kind of "prove it before runtime" guarantee P1 was
written to formalize, applied at the IR/task seam rather than at the
producer/consumer seam. Option 1 leaves that seam to runtime; Option 1'
closes it. Option 3 inherits this strength.

\* Minimization is satisfied only if "fewer fields" is read as a goal in
its own right; under the principles' actual framing (concepts must earn
their place against P1-P5) the schemas already earn theirs.

The principles do not select Option 1 over Option 3 - both are
principle-aligned. They do firmly reject Option 2 at the IR level, and
they require any future move toward Option 3 to keep the canonical
validated form schema-complete (loader expansion, not validator lookup).

The IR is verbose by design and the "IR is one self-contained document"
property is load-bearing for portability and tooling. Option 1 is the
right _IR_ answer and is what v1 currently specifies. The duplication
problem is real but is the DSL layer's problem to solve, not the IR's.

If specialization-with-shared-defaults turns out to be a recurring
authoring pattern in practice (i.e., most task nodes restate the
implementation's schema verbatim and only a few narrow), option 3 becomes
attractive as a layered addition: keep option 1 as the underlying
contract, allow omitted schemas as a v1.1 sugar that the loader expands
against the registry before validation. That preserves the IR's
self-contained property (the canonical form has the schemas filled in)
while removing the authoring friction. This is a cleaner extension path
than starting at option 3 and trying to retreat to option 1 later.

Option 2 is rejected as the IR-level answer: it surrenders too much for
the wrong layer's convenience.

## Recommendation

Adopt **Option 1'** for v1, with the relationship between IR and task
stated explicitly: the registered task's declared contract is the
authoritative envelope; each task node's `inputSchema`/`outputSchema`
is either a verbatim restatement of that contract (the common case) or
a narrowing of it (the specialization case), and never a contradiction.
The schemas live on the node so the IR remains self-contained and
specialization is expressible; the validator enforces the
"restate-or-narrow, never contradict" rule via the §4.2 subtype
relation in both directions, gated on registry availability.

When the registry is not available, validation falls back to the bare
Option 1 behavior - the IR still validates standalone, but the
IR/task seam is not statically checked and is handled by the
runtime output check in §5.2.

Update the IR to:

- §4.1 - add a validation pass (between the type-resolution pass and the
  type-compatibility pass) for IR/task drift, gated on registry
  availability, with the task as authoritative envelope.
- §5.2 - keep the existing runtime output validation as a defense-in-depth
  layer for the registry-absent case.
- §8.16 - state the chosen design as "task is the envelope, IR is
  restatement or narrowing"; list the bare Option 1 (no static drift
  check), Option 2 (registry-only schemas), and Option 3 (loader-expanded
  omission sugar) as alternatives.

Leave Option 3 explicitly open as a v1.x or DSL-layer feature.

### Triggers to revisit Option 3

Option 3 (loader-expanded schema omission) should be reopened if any of
the following turn up in practice:

- **IR size.** IR documents become uncomfortably large because most
  task nodes restate their registered task's schemas verbatim. The
  duplication is real, just deferred to the DSL/codegen layer; if no DSL
  materializes or the IR itself is being read/edited at scale, omission
  sugar becomes the right pressure-relief valve.
- **Authoring data.** Once usage data exists, if the overwhelming
  majority of task nodes mirror the registry exactly and only a small
  minority narrow, the omission form would be the canonical case and
  the explicit form the specialization marker - the inverse of today's
  default.
- **Registry stability guarantees.** If the task registry gains a
  versioning/pinning story strong enough that loader expansion is
  reproducible across environments, the "IR self-contained" cost of
  Option 3 shrinks.

When revisited, the chosen Option 1' drift check is reused unchanged;
Option 3 is purely the addition of the omission-as-sugar feature on top
of it.

## Cross-references

- ir-v0.1.md §3.5 (task node), §3.8 (handler node) - where
  `inputSchema`/`outputSchema` are declared.
- ir-v0.1.md §4.2 (compatibility) - the subtype relation that option 3
  would reuse for the IR-narrows-registry check.
- ir-v0.1.md §5.2 (task execution) - the runtime validation point that
  enforces the IR's `outputSchema` against the implementation.
- ir-v0.1.md §8.13 (shared schemas) - the `types` block that already
  reduces duplication within a single IR; orthogonal to this decision.
- ir-v0.1.md §8.1 notes (post-v1) - the DSL layer that would handle the
  authoring-friction side of this trade-off.
- [0010-copilot-task-family.md](0010-copilot-task-family.md) §4 -
  schema-guided design for `copilot.invoke` relies on the Option 1'
  drift check to reject non-object IR `outputSchema`s at IR
  validation time.
- [0011-task-context-schema-awareness.md](0011-task-context-schema-awareness.md)
  exposes the IR-declared schemas this decision makes authoritative
  to task implementers via `TaskContext`.
