# Language style (decision 0001): imperative TS-like DSL

Status: **Adopted (v1).** Option D (shorthand IR) is deferred with an
explicit trigger.

Related:
[../../../ir/dsl-assumptions.md](../../../ir/dsl-assumptions.md) (assumptions
this decision must satisfy),
[../../../ir/revisit-triggers.md](../../../ir/revisit-triggers.md) (cross-cutting
trigger 1: "DSL cannot lower cleanly to the IR").

## 1. The question

The IR is verbose by design ([ir-v0.1.md §1.2](../../../ir/ir-v0.1.md)):
codegen pays the tax once, and the DSL absorbs the authoring cost.
What should the DSL's surface language look like?

Four options were evaluated against the IR's DSL assumptions (S1-S3,
T1-T2, A1-A3, W1-W2, D1) and the three reader/writer populations
in [ir-v0.1.md §1.1](../../../ir/ir-v0.1.md).

## 2. Options considered

### Option A: Imperative TypeScript-like DSL (chosen)

A strongly-typed, sequential script syntax that resembles TypeScript.
Task calls look like function calls; variables are `let` bindings;
control flow uses `for..of`, `if`/`match`, and `return`.

```typescript
workflow standupPrep(input: { repos: string[], author: string }): string {
  let authorArg = text.template("--author={{author}}", { author: input.author })

  let sections: string[] = []
  for repo of input.repos {
    let gitResult = shell.exec("git", ["log", "--since=yesterday", authorArg.text, "--oneline"], repo)
    let section = text.template("## {{repo}}\n{{log}}", { repo, log: gitResult.stdout })
    sections = list.append(sections, section.text).list
  }

  let joined = string.join(sections, "\n\n")
  return joined.text
}
```

### Option B: Declarative pipeline DSL

A YAML-like, step-oriented syntax where each step names a task and its
inputs as a block. Data flows through named bindings. Closer to the IR's
structure, with schema inference and reference shorthand.

### Option C: Functional/expression DSL

A terse, expression-oriented syntax with `:=` bindings, `|` pipes, and
`=>` output markers. Novel syntax, high compression ratio, steep
learning curve.

### Option D: Shorthand IR (JSON sugar) (deferred - see §5)

A preprocessor over relaxed JSONC that infers schemas, replaces `$from`
objects with `$name.path` strings, infers `next`/`entry` from key order,
and desugars `for` blocks to loop nodes.

## 3. Evaluation

| Criterion                               | A (TS-like)         | B (pipeline)   | C (functional)     | D (shorthand IR)      |
| --------------------------------------- | ------------------- | -------------- | ------------------ | --------------------- |
| Verbosity reduction vs raw IR           | ~80%                | ~50%           | ~85%               | ~40%                  |
| LLM emittability (W1)                   | High (TS in corpus) | Medium         | Low (novel syntax) | Medium (still JSON)   |
| Familiar syntax for humans              | High                | Medium         | Low                | High (for IR authors) |
| Maps cleanly to 3 node kinds (S2)       | Yes                 | Yes            | Yes                | Yes                   |
| Boundary closure preserved (S1)         | Yes (scope = block) | Yes            | Yes                | Yes                   |
| Schema access at lowering (T1)          | Natural (TS types)  | Needs registry | Needs registry     | Needs registry        |
| Absorbs A1 defaults                     | Yes                 | Yes            | Yes                | Partially             |
| Absorbs A2 sugar (match, break, dotted) | Yes                 | Partially      | Yes                | Partially             |
| IDE tooling potential                   | High (TS ecosystem) | Low            | Low                | Medium (JSON schemas) |
| Lowering complexity                     | Medium              | Low            | Medium             | Low                   |

## 4. Decision: Option A

Option A is chosen as the primary DSL for the following reasons:

1. **W1 (writer economics).** TypeScript-like syntax is the
   best-represented programming surface in LLM training data. The DSL
   must absorb the IR's verbosity tax (W1); the LLM needs a surface it
   can emit reliably. TS-like syntax gives the highest hit rate.

2. **A2 (ergonomic equivalents).** The IR spec anticipates DSL sugar
   for `match` (discriminant switch), `continue`/`break` (loop
   sentinels), dotted names (`$from` references), and assignment
   (`stateWrites`). All of these have natural, well-understood
   representations in imperative TS-like syntax.

3. **T1 (schema access at lowering).** Task schemas are already
   TypeScript types (`.ts` files in agent packages). A TS-like DSL
   can import them directly, giving the compiler authoritative schema
   access at lowering time without a separate registry lookup.

4. **IDE support.** A TS-like syntax can reuse TypeScript's language
   service infrastructure for autocomplete, type checking, and
   go-to-definition. Options B-D would need custom tooling from
   scratch.

5. **SSA legibility.** `let` bindings map directly to the IR's
   `bind` field (decision 0001). Each `let` is a single assignment;
   the SSA nature of the IR (decision 0004) is visible in the source
   without confusion. The `sections = list.append(...)` pattern looks
   like mutation but the compiler enforces single-assignment per scope
   frame, matching the IR's semantics.

## 5. Deferred alternative: Option D (shorthand IR)

Option D is not rejected; it is deferred as a complementary layer
with an explicit adoption trigger.

### Trigger to adopt Option D

Option D should be built if **any two** of the following are observed:

1. **Quick-edit friction.** Authors making small changes to existing
   workflows find the full DSL round-trip (edit DSL, compile, validate)
   slower than editing the IR directly, but raw IR editing is too
   error-prone due to schema restatement and `$from` verbosity.

2. **Bootstrap gap.** The DSL compiler is not yet available but
   authors need to hand-write or LLM-generate new workflows now.
   Option D's preprocessing is implementable in hours (string
   expansion + key-order threading + registry schema lookup), while
   a full DSL compiler is weeks of work.

3. **LLM IR-direct fallback.** The LLM-direct-to-IR path (W2) is
   actively used and its error rate on raw IR is dominated by schema
   restatement mistakes and `$from` verbosity, both of which Option D
   eliminates.

### What Option D provides that Option A does not

- Editable without a compiler (the output IS the IR, modulo expansion)
- No source-map problem (D1): DSL position = IR position
- Lower barrier for hand-authoring edge cases

### What Option D does NOT replace

- Option A's control-flow sugar (`for..of`, `if`, `match`)
- Option A's schema-level type checking
- Option A's IDE integration

If Option D is adopted, it occupies the space between raw IR and
full DSL: a convenience layer for quick edits and bootstrap, not a
replacement for Option A.

## 6. Assumption checklist

Walk of [dsl-assumptions.md](../../../ir/dsl-assumptions.md) against
Option A:

| ID  | Assumption                                  | Status with Option A                                                                                                        |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| S1  | Codegen splices without violating closure   | **Needs probe.** Block scoping in TS-like syntax maps to IR scope boundaries. The d1-standup-prep lowering probe will test. |
| S2  | DSL stays within 3 node kinds               | **Confirmed.** `let x = task(...)` lowers to `task`; `for..of` lowers to `loop`; `match`/`if` lowers to `branch`.           |
| S3  | Constants stay workflow-global              | **Confirmed.** Top-level `const` declarations lower to the IR's `constants` block; no block-scoped constants needed.        |
| T1  | Schema access at lowering time              | **Confirmed.** TS-like syntax imports task types directly.                                                                  |
| T2  | JSON Schema subset for types                | **Confirmed.** The DSL's type annotations lower 1:1 to JSON Schema.                                                         |
| A1  | DSL fills omitted required fields           | **Confirmed.** Compiler infers `maxIterations` (default 100), `default` branch, `output`, loop `inputs`.                    |
| A2  | Ergonomic equivalents for verbose IR shapes | **Confirmed.** `match` for branches, `break`/`continue` for sentinels, dotted names for refs, `=` for state writes.         |
| A3  | Bind-switch hide-by-default is remediable   | **Confirmed.** Every `let` binding emits `bind`; anonymous task calls (no `let`) emit no `bind`.                            |
| W1  | DSL absorbs verbose-by-design tax           | **Confirmed.** ~80% reduction; LLM emits DSL, codegen pays the IR tax once.                                                 |
| W2  | LLM-direct-to-IR stays viable               | **Unaffected.** The DSL does not change the IR; the fallback path is unchanged.                                             |
| D1  | Source maps in sidecar                      | **Confirmed.** The compiler emits a `.map` sidecar; runtime errors re-project via the sidecar.                              |

## 7. Next steps

1. **DSL probe.** Lower `d1-standup-prep` by hand to verify S1 and
   measure the lowering complexity. Identify any constructs that
   require IR shapes the DSL cannot produce cleanly.
2. **Grammar sketch.** Define the DSL's formal grammar (likely PEG or
   TS-compatible subset) and verify it covers the four exit-criteria
   workflows (D1, D4, D5, D8).
3. **Compiler scaffold.** Parser, type checker (leveraging task
   schemas), and IR emitter. Package as `workflow-dsl` alongside
   `workflow-model` and `workflow-engine`.
