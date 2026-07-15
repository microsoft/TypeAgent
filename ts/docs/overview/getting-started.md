# Getting started

This page summarizes how to build, configure, and run TypeAgent locally.

## Set up from scratch

To stand up a development environment from nothing, follow the per-platform
guide:

- [Set up on Windows](./setup-windows.md)
- [Set up on WSL2](./setup-wsl2.md)
- [Set up on Linux](./setup-linux.md)
- [Set up on macOS](./setup-macos.md)

The rest of this page is the quick summary for an environment that already has
Node and pnpm.

## Prerequisites

- **Node ≥ 22** (the monorepo targets Node 22+).
- **pnpm ≥ 10** (`npm i -g pnpm && pnpm setup`).
- On Linux/WSL, see the [WSL2](./setup-wsl2.md) / [Linux](./setup-linux.md)
  guides for extra system requirements.

## Build

All commands run from the `ts/` directory.

```bash
pnpm i                  # install
pnpm run build          # build all packages via fluid-build
pnpm run build:shell    # build only the shell app and its dependencies
```

`pnpm run build <dir|regexp>` builds a single package (and its dependencies).

## Configure service keys

The scenarios require service keys, stored in `ts/config.local.yaml`:

```bash
cp config.sample.yaml config.local.yaml   # then fill in keys
```

See **[Service keys & configuration](./service-keys.md)** for the full config
format (Azure OpenAI and OpenAI), which keys each capability needs, Azure Key
Vault management, keyless access, and the Linux/WSL keyring.

## Run

There are two front ends, both backed by the shared
[dispatcher](../architecture/core/dispatcher.md). TypeAgent currently runs from
the repo only (no published builds).

The **TypeAgent Shell** is an Electron app — a lightweight GUI for the personal
agent — that includes:

- a single personal-agent conversational interface with **voice** support;
- dispatch of actions to an extensible set of agents, plus Q&A and conversation;
- **conversational memory** based on Structured RAG;
- integration with the **TypeAgent Cache** to lower cost and latency.

```bash
pnpm run shell          # start the Shell GUI
```

See [`ts/packages/shell/README.md`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/shell/README.md).

The **TypeAgent CLI** is a console front end with extra commands for exploring
TypeAgent internals:

```bash
pnpm run cli            # list available commands
pnpm run cli -- connect # interactive prompt (connects to the agent server over WebSocket RPC)
```

See [`ts/packages/cli/README.md`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/cli/README.md).

The Shell and CLI are not the only ways in: see **[Surfaces](./surfaces.md)** for
all the clients — VS Code (chat, embedded shell, CODA, Studio), the Chrome
browser extension, Android, and the web API.

## Key components to explore

| Component                                            | What it explores                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [Dispatcher](../architecture/core/dispatcher.md)     | Structured prompting + LLM to route a request to the agent whose typed contract best matches user intent — the core of the personal agent. |
| [KnowPro / memory](../architecture/memory/memory.md) | Agent memory using Structured RAG (the `knowPro` package; see the [Packages](../packages/index.md) section).                               |
| [Cache](../packages/index.md)                        | Using an LLM with structured prompting to cache action translation, minimizing trips to the LLM.                                           |

## Build your own agent

To add action dispatch for your own scenario, create a **custom agent** that
plugs into the Shell and routes through the dispatcher.
[Build an agent](../guides/build-an-agent/index.md) is the canonical guide:
picking a pattern, scaffolding, defining actions and grammar, iterating
locally, and distributing via path / catalog / feed. The
[Echo tutorial](../guides/build-an-agent/tutorial-echo.md) is a concrete
standalone-package walkthrough. The
[TypeAgent SDK](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agentSdk/)
defines the interface between the dispatcher and an agent. See also
[Add an agent](../contributing/add-an-agent.md) for how an agent surfaces in
this wiki.

## Test, lint, format

```bash
pnpm run test:local      # unit tests (*.spec.ts) across packages
pnpm run test:live       # integration tests (*.test.ts) — needs API keys
pnpm --filter <pkg> test # tests for one package
pnpm run prettier        # check formatting
pnpm run prettier:fix    # fix formatting
```

Tests run against compiled output in `dist/test/`, so build before testing.

## Where data and tracing live

- User data and state (registration, chat, memory) are stored **locally** under
  `~/.typeagent/` as ordinary text/JSON; agents that use external services
  (e.g. Microsoft Graph) may store state in those services. The repo does **not**
  collect telemetry by default.
- Tracing: the `debug` package — enable with `DEBUG=typeagent:*`.
