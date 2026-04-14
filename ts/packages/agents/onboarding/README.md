# Onboarding Agent

A TypeAgent agent that automates the end-to-end process of integrating a new application or API into TypeAgent. Each phase of the onboarding pipeline is a sub-agent with typed actions, enabling AI orchestrators (Claude Code, GitHub Copilot) to drive the process via TypeAgent's MCP interface.

## Overview

Integrating a new application into TypeAgent involves 7 phases:

| Phase | Sub-agent               | What it does                                                       |
| ----- | ----------------------- | ------------------------------------------------------------------ |
| 1     | `onboarding-discovery`  | Crawls docs or parses an OpenAPI spec to enumerate the API surface |
| 2     | `onboarding-phrasegen`  | Generates natural language sample phrases for each action          |
| 3     | `onboarding-schemagen`  | Generates TypeScript action schemas from the API surface           |
| 4     | `onboarding-grammargen` | Generates `.agr` grammar files from schemas and phrases            |
| 5     | `onboarding-scaffolder` | Stamps out the agent package infrastructure                        |
| 6     | `onboarding-testing`    | Generates test cases and runs a phrase→action validation loop      |
| 7     | `onboarding-packaging`  | Packages the agent for distribution and registration               |

Each phase produces **artifacts saved to disk** at `~/.typeagent/onboarding/<integration-name>/`, so work can be resumed across sessions.

## Usage

### Starting a new integration

```
start onboarding for slack
```

### Checking status

```
what's the status of the slack onboarding
```

### Resuming an in-progress integration

```
resume onboarding for slack
```

### Running a specific phase

```
crawl docs at https://api.slack.com/docs for slack
generate phrases for slack
generate schema for slack
run tests for slack
```

## Workspace layout

```
~/.typeagent/onboarding/
  <integration-name>/
    state.json              ← phase status, config, timestamps
    discovery/
      api-surface.json      ← enumerated actions from docs/spec
    phraseGen/
      phrases.json          ← sample phrases per action
    schemaGen/
      schema.ts             ← generated TypeScript action schema
    grammarGen/
      schema.agr            ← generated grammar file
    scaffolder/
      agent/                ← stamped-out agent package files
    testing/
      test-cases.json       ← phrase → expected action test pairs
      results.json          ← latest test run results
    packaging/
      dist/                 ← final packaged output
```

Each phase must be **approved** before the next phase begins. Approval locks the phase's artifacts and advances the current phase pointer in `state.json`.

## For Best Results

The onboarding agent is designed to be driven by an AI orchestrator (Claude Code, GitHub Copilot) that can call TypeAgent actions iteratively, inspect artifacts, and guide each phase to completion. For the best experience, set up TypeAgent as an MCP server so your AI client can communicate with it directly.

### Set up TypeAgent as an MCP server

TypeAgent exposes a **Command Executor MCP server** that bridges any MCP-compatible client (Claude Code, GitHub Copilot) to the TypeAgent dispatcher. Full setup instructions are in [packages/commandExecutor/README.md](../../commandExecutor/README.md). The short version:

1. **Build** the workspace (from `ts/`):

   ```bash
   pnpm run build
   ```

2. **Add the MCP server** to `.mcp.json` at the repo root (create it if it doesn't exist):

   ```json
   {
     "mcpServers": {
       "command-executor": {
         "command": "node",
         "args": ["packages/commandExecutor/dist/server.js"]
       }
     }
   }
   ```

3. **Start the TypeAgent dispatcher** (in a separate terminal):

   ```bash
   pnpm run start:agent-server
   ```

4. **Restart your AI client** (Claude Code or Copilot) to pick up the new MCP configuration.

Once connected, your AI client can drive onboarding phases end-to-end using natural language — e.g. _"start onboarding for Slack"_ — without any manual copy-paste between tools.

## Agent Patterns

The scaffolder supports nine architectural patterns. Use `list agent patterns` at runtime for the full table, or see [docs/architecture/agent-patterns.md](../../../../docs/architecture/agent-patterns.md) for the complete reference including when-to-use guidance, file layouts, and manifest flags.

| Pattern                  | When to use                              | Examples                        |
| ------------------------ | ---------------------------------------- | ------------------------------- |
| `schema-grammar`         | Bounded set of typed actions (default)   | `weather`, `photo`, `list`      |
| `external-api`           | Authenticated REST / cloud API           | `calendar`, `email`, `player`   |
| `llm-streaming`          | Agent calls an LLM, streams results      | `chat`, `greeting`              |
| `sub-agent-orchestrator` | API surface too large for one schema     | `desktop`, `code`, `browser`    |
| `websocket-bridge`       | Automate a host app via a plugin         | `browser`, `code`               |
| `state-machine`          | Multi-phase workflow with approval gates | `onboarding`, `scriptflow`      |
| `native-platform`        | OS / device APIs, no cloud               | `androidMobile`, `playerLocal`  |
| `view-ui`                | Rich interactive web-view UI             | `turtle`, `montage`, `markdown` |
| `command-handler`        | Simple settings-style direct dispatch    | `settings`, `test`              |

## Building

```bash
pnpm install
pnpm run build
```

## TODO

### Additional discovery crawlers

The discovery phase currently supports web docs and OpenAPI specs. Planned crawlers:

- **CLI `--help` scraping** — invoke a command-line tool with `--help` / `--help <subcommand>` and parse the output to enumerate commands, flags, and arguments
- **`dumpbin` / PE inspection** — extract exported function names and signatures from Windows DLLs for native library integration
- **.NET reflection** — load a managed assembly and enumerate public types, methods, and parameters via `System.Reflection`
- **Man pages** — parse `man` output for POSIX CLI tools
- **Python `inspect` / `pydoc`** — introspect Python modules and their docstrings
- **GraphQL introspection** — query a GraphQL endpoint's introspection schema to enumerate types and operations
- **gRPC / Protobuf** — parse `.proto` files or use server reflection to enumerate services and RPC methods

Each new crawler should implement the same `DiscoveryResult` contract so downstream phases (phrase gen, schema gen) remain crawler-agnostic.

## Architecture

See [AGENTS.md](./AGENTS.md) for details on the agent structure, how to extend it, and how each phase's LLM prompting works.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
