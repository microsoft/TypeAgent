<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=4b3e22f5356c1d5f58efb8971fee1be9ee424a13112ee0986642b5971d59e59b -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# coder-wrapper — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `coder-wrapper` package is a TypeScript library designed to provide a pseudo terminal (PTY) wrapper for CLI coding assistants such as Claude Code. It supports multiple assistants through a pluggable configuration system and includes caching capabilities to improve performance by checking the TypeAgent cache before forwarding requests to the assistant.

## What it does

The `coder-wrapper` package offers several key functionalities:

- **Spawns CLI coding assistants** in a pseudo terminal using `node-pty` for proper TTY support.
- **Transparent I/O passthrough**: All stdin, stdout, and stderr are passed through unchanged, supporting terminal features like colors, cursor control, and resizing.
- **Multiple assistant support**: Configurable through [src/assistantConfig.ts](./src/assistantConfig.ts), allowing easy addition of new assistants.
- **Caching**: Intercepts user input and checks the TypeAgent cache before forwarding to the assistant. If a cache hit occurs, the cached result is returned immediately, bypassing the assistant.
- **Debug mode**: Provides detailed logging of cache operations, including cache check attempts, hit/miss status, and timing information.

## Setup

To set up the `coder-wrapper` package, follow these steps:

1. Navigate to the package directory:

   ```bash
   cd packages/coderWrapper
   ```

2. Install the necessary dependencies:

   ```bash
   npm install
   ```

3. Build the package:
   ```bash
   npm run build
   ```

## Key Files

The `coder-wrapper` package is structured as follows:

- **Entry point**: The main entry point is [src/index.ts](./src/index.ts), which exports key components such as `PtyWrapper`, `AssistantConfig`, `CacheClient`, and `DebugLogger`.
- **Assistant configuration**: [src/assistantConfig.ts](./src/assistantConfig.ts) defines the configuration for different CLI coding assistants and provides a function to retrieve the configuration by name.
- **Cache client**: [src/cacheClient.ts](./src/cacheClient.ts) implements the client for checking the TypeAgent cache via the MCP server.
- **Debug logger**: [src/debugLogger.ts](./src/debugLogger.ts) provides a logger that writes debug information to a file.
- **PTY wrapper**: [src/ptyWrapper.ts](./src/ptyWrapper.ts) wraps a CLI coding assistant in a pseudo terminal, handling transparent I/O and cache checking.

## How to extend

To extend the `coder-wrapper` package, follow these steps:

1. **Add a new assistant**:

   - Edit [src/assistantConfig.ts](./src/assistantConfig.ts) to add the new assistant configuration. For example:
     ```typescript
     export const ASSISTANT_CONFIGS: Record<string, AssistantConfig> = {
       claude: {
         name: "Claude Code",
         command: "claude",
         args: [],
       },
       newAssistant: {
         name: "New Assistant",
         command: "new-assistant",
         args: [],
       },
       // Add more assistants as needed
     };
     ```

2. **Implement custom caching logic**:

   - Modify [src/cacheClient.ts](./src/cacheClient.ts) to implement custom caching logic or integrate with a different caching system.

3. **Enhance debug logging**:

   - Extend [src/debugLogger.ts](./src/debugLogger.ts) to include additional debug information or change the logging format.

4. **Modify PTY wrapper behavior**:

   - Update [src/ptyWrapper.ts](./src/ptyWrapper.ts) to change how the PTY wrapper handles I/O, caching, or assistant interactions.

5. **Testing**:
   - Ensure that your changes are covered by tests. Add or update tests in the appropriate test files and run the test suite to verify your changes:
     ```bash
     npm test
     ```

By following these steps, you can extend the functionality of the `coder-wrapper` package to support new assistants, customize caching behavior, enhance logging, and modify the PTY wrapper's behavior.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/agent-server-client](../../packages/agentServer/client/README.md)
- [@typeagent/dispatcher-types](../../packages/dispatcher/types/README.md)

External: `@modelcontextprotocol/sdk`, `node-pty`

### Used by

- [agent-sdk-wrapper](../../packages/agentSdkWrapper/README.md)

### Files of interest

`./src/index.ts`, `./src/assistantConfig.ts`, `./src/cacheClient.ts`, …and 3 more under `./src/`.

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.903Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter coder-wrapper docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
