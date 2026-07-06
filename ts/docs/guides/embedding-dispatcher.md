# Embedding the dispatcher

TypeAgent's dispatcher — the engine that turns natural language and
`@`-commands into typed actions and dispatches them to application agents — is a
library. This page is for **host integrators**: developers who want to run that
engine inside their own process (a service, a CLI, a bot bridge, a test harness)
rather than using the shipped Shell, CLI, or web API.

> This is the _how to embed_ guide. For the engine's internals see
> [Dispatcher](../architecture/core/dispatcher.md); for where agents come from
> and how they go live see [Agent sources](../architecture/lifecycle/agent-sources.md)
> and [Agent lifecycle](../architecture/lifecycle/agent-lifecycle.md). To
> _author_ an agent, see [Add an agent](../contributing/add-an-agent.md).

## Creating a dispatcher

A host creates a dispatcher with `createDispatcher(hostName, options)` from
`agent-dispatcher`:

```ts
import { createDispatcher } from "agent-dispatcher";

const dispatcher = await createDispatcher("my-host", {
  appAgentProviders, // static agent set (bundled, MCP): AppAgentProvider[]
  appAgentSources, // dynamic (installed) agent set: AppAgentSource[]
  clientIO, // required for any I/O
  storageProvider, // where session/agent state is saved
  instanceDir, // cross-session agent storage (config, tokens, agents.json)
  persistSession: true,
});

const result = await dispatcher.submitCommand("what time is it in Tokyo?");
```

`DispatcherOptions` is defined in
[`commandHandlerContext.ts`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/dispatcher/dispatcher/src/context/commandHandlerContext.ts).
**Every field is optional.** Calling `createDispatcher("my-host")` with no
options gives you a working engine that has only the built-in system agents and
does no I/O. The four fields that decide which agents run and how the
host talks to them — and what happens when you leave each one out — are:

| Option                            | Purpose                                                                                                                                                                                          | When omitted                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `appAgentProviders`               | The static agent set — bundled agents and MCP. Plain `AppAgentProvider`s that are never installed or uninstalled.                                                                                | Only the built-in `system` agents are available.                         |
| `appAgentSources`                 | The dynamic agent set — installed agents. Each `AppAgentSource` is connected once per dispatcher; it provides its agents and propagates any later install, uninstall, or update to this session. | No installed agents and no `@package` commands.                          |
| `clientIO`                        | The `ClientIO` the dispatcher uses to show output and ask for input.                                                                                                                             | The dispatcher does no I/O.                                              |
| `storageProvider` / `instanceDir` | Where session state and cross-session agent state (including `agents.json`) are stored. `getFsStorageProvider()` from `dispatcher-node-providers` stores them on the file system.                | Nothing is saved between runs; `instanceDir` falls back to `persistDir`. |

You can set the two agent-set options independently: set neither (an engine with
only the built-in agents), only `appAgentProviders` (a fixed set with no
installing), only `appAgentSources` (all agents come from a source), or both. The
[three common setups](#three-common-setups) below cover the usual combinations.

## Which package to depend on

The dispatcher core does not know about npm feeds, Azure DevOps, `az`, or the
different kinds of install sources. All of that lives in `default-agent-provider`.
You choose how much you pull in by which package you depend on:

- Depend on **`agent-dispatcher`** only → you get the engine and the
  `AppAgentProvider` / `AppAgentSource` interfaces, and you supply your own
  agents. No Azure or npm code is included.
- Depend on **`default-agent-provider`** → you also get the ready-made bundled
  provider, the installed-agent source, the source registry, and the full set of
  `@package` commands.

The dependency only goes one way: the core never imports `default-agent-provider`,
which is what lets you use the engine without the Azure and npm code. For a full
breakdown of what each package owns and why, see
[Agent lifecycle › overview](../architecture/lifecycle/agent-lifecycle.md#overview).

## Three common setups

Your main decision is which agent set or sets to pass in. These three setups
cover the common cases.

### 1. Your own agents, no `@package`

Pass in your own providers and no source. The dispatcher runs exactly those
agents and offers no install commands. This is what the
[onboarding test runner](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agents/onboarding/src/testing/runTests.ts)
does:

```ts
import { createDispatcher } from "agent-dispatcher";
import { createNpmAppAgentProvider } from "dispatcher-node-providers";

const dispatcher = await createDispatcher("my-test-runner", {
  appAgentProviders: [createNpmAppAgentProvider(myAgents, requirePath)],
  // no appAgentSources → no @package, and no source or feed code is loaded.
  clientIO,
  storageProvider: getFsStorageProvider(),
  persistDir: tmpDir,
});
```

### 2. The ready-made agents (the default setup)

Use the providers and installed source that `default-agent-provider` assembles for
you. This is what the [agent server](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agentServer/server/src/server.ts)
and [web API](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/api/src/webDispatcher.ts)
pass in — the same call, with the full set of `@package` commands (install,
uninstall, update, list, source):

```ts
import { createDispatcher } from "agent-dispatcher";
import {
  getDefaultAppAgentProviders,
  getDefaultAppAgentSource,
} from "default-agent-provider";
import { getFsStorageProvider } from "dispatcher-node-providers";

const dispatcher = await createDispatcher("my-host", {
  appAgentProviders: getDefaultAppAgentProviders(instanceDir),
  appAgentSources: [getDefaultAppAgentSource(instanceDir)],
  storageProvider: getFsStorageProvider(),
  clientIO,
  persistSession: true,
});
```

**Hosts with no local file system** (for example a remote server) pass
`excludePathSources: true` so `path` sources are not resolved against the
server's own disk (the web API does this):

```ts
appAgentSources: [
  getDefaultAppAgentSource(instanceDir, { excludePathSources: true }),
],
```

### 3. Your own source, without `default-agent-provider`

If you want installable agents but not the Azure and npm feed code, implement
`AppAgentSource` yourself. You add your own `@package`-style commands as a
`CommandHandlerTable` from your source's own app agent, and the core merges in
whatever table you return:

```ts
import { createDispatcher, type AppAgentSource } from "agent-dispatcher";

const mySource: AppAgentSource = {
  connect(host) {
    // return { providers, whenReady, dispose } — see AppAgentConnection
  },
};

await createDispatcher("my-host", { appAgentSources: [mySource], clientIO });
```

## What the host is responsible for

- **`ClientIO`.** Implement it to receive output and answer input requests.
  Without it the dispatcher does no I/O.
- **Connecting and disconnecting sources.** `createDispatcher` connects each
  `AppAgentSource` at startup and disconnects it at shutdown for you. If you build
  your own source (setup 3), its `connect()` must hand out shared provider
  instances and its `dispose()` must be safe to call more than once (see
  [Agent lifecycle › connection lifecycle](../architecture/lifecycle/agent-lifecycle.md#connection-lifecycle)).
- **One process per `instanceDir`.** An instance directory and its `agents.json`
  are used by one process at a time; do not point two running hosts at the same
  `instanceDir`.
- **Setup for feed installs.** If you use the default source and want feed agents,
  the process needs `az login` and, unless you configure them, the
  `TYPEAGENT_FEED_REGISTRY` and `TYPEAGENT_FEED_SCOPES` environment values — see
  [Agent sources › the feed source](../architecture/lifecycle/agent-sources.md#the-feed-source).

## Related

- [Dispatcher](../architecture/core/dispatcher.md) — the `Dispatcher` interface
  and the engine you are embedding.
- [Agent sources](../architecture/lifecycle/agent-sources.md) /
  [Agent lifecycle](../architecture/lifecycle/agent-lifecycle.md) — what
  `appAgentProviders` and `appAgentSources` do at runtime.
- [Add an agent](../contributing/add-an-agent.md) — authoring and publishing the agents a host
  runs.
