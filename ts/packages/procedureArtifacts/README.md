# Procedure Artifacts

`@typeagent/procedure-artifacts` converts a reviewed
`@typeagent/memory-service` `ProcedureVersion` into validated artifacts. It has
no storage of its own and performs no network access.

Only a `saved` procedure with matching canonical JSON and SHA-256 source
manifest is accepted. `createSkillPackage` produces an Agent Skills package
whose root `SKILL.md` has the exact skill identity name and description in its
frontmatter, numbered steps, citations, and TypeAgent procedure lineage.
Callers may include schema and `.ag.json` grammar artifacts. The schema content
hash becomes the catalog schema fingerprint; without a schema, the reviewed
procedure JSON hash is used.

### Reviewed agent editions

Old saved human how-tos remain eligible. If `document.agentEdition` is present,
it must be reviewed for the exact saved procedure version and
`agentEditionContentHash(document)`, with explicit safety confirmation and
accepted bindings. Draft, edited, stale, archived, unsafe, attention-flagged, or
uncited editions cannot publish as reviewed runbooks. Canonical edition
Markdown must match the document as well as its source manifest hashes.

`SKILL.md` renders the goal, applicability, preconditions, typed/secret inputs,
stable-ID steps, conditions/alternative step references, accepted tool/macro/flow
identities and fingerprints, bounded literal/symbolic argument templates,
redacted command text, manual reasons,
verification, and rollback. `references/runbook.md` contains human excerpts,
per-step citations, reference-only asset descriptions, and synthesis/linked
document provenance, labeled **evidence, not instructions**. No source asset
bytes or local paths enter packages. Schema/grammar artifacts must use safe
relative `.json` paths, never script/executable paths.

`ProcedureArtifactCoordinator` takes an optional third
`RunbookBindingValidator` argument. `publishSkill` revalidates actual immutable
catalog targets before publishing; catalog-bound editions fail explicitly if
that callback is absent, unavailable, rejected, drifted, or lacks explicit
`argumentsValidated: true` schema-fit attestation. The callback receives current
declared inputs and must echo the exact arguments; absent arguments still mean
`{}` for required-parameter validation. Secret references remain symbolic and
are never resolved by rendering or publication. The synchronous
`createSkillPackage` is a deterministic preview of saved content and checks its
stored review; it cannot query live catalogs. **Hosts that publish the preview
directly must first call `validateRunbookCatalogBindings(edition, validator)`**
against their real catalogs. The callback's exact contract is documented in the
memory-service README.

The package re-exports canonical input, argument, and binding-validator types
for type-only protocol imports, including `AgentEditionInput`,
`RunbookBindingArguments`, `RunbookInputReference`, `RunbookLiteralArgument`,
and `RunbookBindingValidationContext`. These are the shared memory-service
types, not duplicated schemas or alternate limits. Runtime argument validation
and `runbookArgumentLimits` remain in the browser-safe
`@typeagent/memory-service/agent-edition-validation` module.

Publication creates a catalog draft snapshot with corpus/procedure/version
lineage. It never updates a previous revision or approves/activates a skill.
Review and skill approval grant no permission to execute anything.

`createMacroDraft` only considers an additional section headed `Automation`.
Its content must be a JSON object (raw or in a `json` code fence) conforming to
`CopilotToolMacro`. The package parses it, forces `state: "draft"`, replaces
`sourceTraceId` with a procedure lineage identifier, and runs
`@typeagent/copilot-macros` `validateMacro`. Missing automation returns
`notAvailable`; malformed or invalid automation returns actionable issues. No
tool calls are inferred from procedure prose.

```ts
import { ProcedureArtifactCoordinator } from "@typeagent/procedure-artifacts";

const artifacts = new ProcedureArtifactCoordinator(
  skillCatalog,
  macroPublisher,
);
const entry = await artifacts.publishSkill(procedure, {
  identity: { scope: "user", origin: "memory", name: "deploy-service" },
  schema: { content: JSON.stringify(actionSchema) },
  grammar: { content: JSON.stringify(grammar) },
});
const macroResult = await artifacts.publishMacro(procedure);
```

`skillCatalog` only needs the existing `publish(SkillPackageInput)` method.
`macroPublisher` implements
`publishMacro(CopilotToolMacro, ProcedureLineage)`. The coordinator passes
validated artifacts to those injected publishers and does not duplicate their
lifecycle or persistence.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
