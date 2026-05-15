# photo

Photo dispatcher agent. Used to launch the camera functionality within the shell.

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b53ea0671995203dcb1bdf8008281a924b69394d9dc73e3f50a1dd46100d8ea8 -->

## AI Overview

> 🤖 **AI-authored summary**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. May lag the working tree by up to 24h — see the staleness footer.

The `photo-agent` package is responsible for handling photo-related actions within the TypeAgent system. It acts as a dispatcher agent that can take photos or upload existing images based on user requests. This package is situated in the dispatcher → agent flow, where it interprets user commands and executes the corresponding photo actions.

The main entry point for contributors or AI agents looking to modify this package is the [photoManifest.json](./src/photoManifest.json) file, which defines the agent's capabilities and schema. The schema, grammar, and handler are crucial components that work together to process photo-related actions. The schema is defined in [photoSchema.ts](./src/photoSchema.ts), the grammar rules are specified in [photoSchema.agr](./src/photoSchema.agr), and the action handler logic is implemented in [photoActionHandler.ts](./src/photoActionHandler.ts).

To understand and modify the package, contributors should start by examining the [photoManifest.json](./src/photoManifest.json) file to get an overview of the agent's functionality. Next, they should review the schema in [photoSchema.ts](./src/photoSchema.ts) to understand the structure of photo actions. The grammar file [photoSchema.agr](./src/photoSchema.agr) provides the rules for parsing user requests into actionable commands. Finally, the [photoActionHandler.ts](./src/photoActionHandler.ts) file contains the implementation of the action handler, which executes the photo actions based on the parsed commands.

Typical modifications might involve updating the schema to support new photo actions, refining the grammar to better interpret user requests, or enhancing the action handler to improve the execution of photo-related tasks. By following this structured approach, contributors can effectively navigate and enhance the `photo-agent` package.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this block. Hand edits inside the AUTOGEN region will be overwritten on the next run.

### Entry points

- `./agent/manifest` → [./src/photoManifest.json](./src/photoManifest.json)
- `./agent/handlers` → [./dist/photoActionHandler.js](./dist/photoActionHandler.js)

### Dependencies

Workspace:

- [@typeagent/action-schema-compiler](../../../packages/actionSchemaCompiler/README.md)
- [@typeagent/agent-sdk](../../../packages/agentSdk/README.md)

External: _None at runtime._

### Used by

- [default-agent-provider](../../../packages/defaultAgentProvider/README.md)

### Files of interest

`./src/photoActionHandler.ts`, `./src/photoManifest.json`, `./src/photoSchema.agr`, …and 3 more under `./src/`.

### Agent surface

- Manifest: [./src/photoManifest.json](./src/photoManifest.json)
- Schema: [./src/photoSchema.ts](./src/photoSchema.ts)
- Grammar: [./src/photoSchema.agr](./src/photoSchema.agr)
- Handler: [./src/photoActionHandler.ts](./src/photoActionHandler.ts)

### Example

_Example snippet pending LLM authoring; will be filled in once the generator is wired to the LLM (see `ts/docs/architecture/doc-autogen.md`)._

---

_Auto-generated against commit `f9a2c5dc1de6e0ed208cb0024add2b9d55546418` on `2026-05-15T00:52:34.811Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter photo-agent docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
