# Per-Workflow `constants` and `types`

**Status:** Future sketch

## Context

In IR v1 (post-composition), `constants` and `types` live at the
artifact level (`WorkflowIR.constants`, `WorkflowIR.types`) and are
shared by every workflow in the artifact. This decision is captured in
`dsl/workflow-composition-decision-log.md` P1-D2.

The shape gives every workflow in a compilation unit visibility into
every constant/type. There is no notion of "private to workflow X" or
"this workflow only sees a subset of the artifact's constants."

## Candidate options

- **A. Artifact-level only (current).** One table; every body sees
  every name.
- **B. Per-`WorkflowBody` only.** Each body owns `constants`/`types`;
  no artifact-level table; no implicit sharing across workflows.
- **C. Hybrid: artifact-level shared + per-body private.** Two tables.
  Name resolution inside a body: private shadows shared.
- **D. Artifact-level store + per-body visibility list.** Single store;
  each body declares which names it can reference.

|     | Encapsulation | Sharing                     | IR diff                  | Template-resolver diff       | Author-facing               |
| --- | ------------- | --------------------------- | ------------------------ | ---------------------------- | --------------------------- |
| A   | none          | implicit, all               | none                     | none                         | one global table            |
| B   | strong        | none (or import-like sugar) | per-body table           | "which body am I in?" lookup | per-workflow declaration    |
| C   | optional      | implicit shared + private   | both tables + precedence | precedence rule              | private vs shared keyword   |
| D   | enumerated    | implicit                    | visibility list per body | filtered lookup              | visibility set per workflow |

## Why consider this

1. **DSL adds a `const` (or `type`) declaration.** Today the DSL has
   no source syntax for declaring constants; the artifact-level table
   is populated only by hand-written IR or by the compiler. A
   workflow-scoped `const NAME = …` form would have no IR home under
   option A.
2. **Cross-file imports start carrying constants.** P7 imports only
   carry workflows; if a file's local constants should be importable
   (`import { TIMEOUT } from "./config.wf"`), per-body or per-file
   tables become necessary to avoid global collision.
3. **Bundling independently-authored libraries.** Two libraries with
   colliding constant names cannot today coexist in one artifact;
   per-body encapsulation removes the collision.
4. **Capability/security boundaries.** Restricting what a sub-workflow
   can read (e.g. a "guest" workflow that may not see credentials in
   `constants`) needs encapsulation.

## Migration path

Option A → C is a strict superset: add a per-body `constants` and
`types` field (both optional), with resolution order
`body.constants[name] ?? artifact.constants[name]`. Existing artifacts
remain valid. Existing templates `$from: "constants"` keep working —
the lookup just walks the body first.

Option A → B is breaking (artifact-level table goes away). Avoid
unless we are also ready to introduce a sharing mechanism.

## Risks and costs

- Engine's `$from: "constants"` resolution becomes frame-aware (knows
  which `WorkflowBody` is executing). Cheap, but a new code path.
- Validator must check for duplicate names across the (per-body,
  artifact-level) pair if option C is chosen — what does "shadowing"
  mean for types specifically (re-declaring a type to a different
  shape vs the same shape)?
- Tooling that lists "all constants in an artifact" needs to walk
  every body in addition to the artifact-level table.

## Open questions

- Should `types` and `constants` move together, or independently?
  Types feel more bundle-wide (shared schemas); constants feel more
  per-workflow (per-task configuration).
- Does cross-file `import { CONST_NAME } …` extend P7's name table,
  or does it stay distinct from workflow imports?
- For option C, does a body's private constants become visible to its
  sub-workflow callees? (Likely no — callees are independent bodies.)

## Non-goal

- Constants-as-values (first-class). Constants remain IR literals;
  they are not workflows, tasks, or callable.
- Dynamic / computed constants. The table stays statically known at
  compile time.

## Revisit trigger

Open this note again when **any** of:

- A DSL surface for declaring constants or types is proposed.
- An import form for constants/types appears in `dsl/workflow-composition.md`
  or a successor doc.
- A real bundling scenario produces a constant-name collision that
  cannot be resolved by renaming source.
