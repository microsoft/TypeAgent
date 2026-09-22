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
