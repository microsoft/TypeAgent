# Build an agent

An **application agent** is a plugin that the
[dispatcher](../../architecture/core/dispatcher.md) routes typed actions to.
This section walks through building one, whether it lives inside the
TypeAgent repo or in a package of your own.

Two starting points, depending on where the agent will live:

- **Bundled with TypeAgent** (`ts/packages/agents/<name>`): ships in the repo,
  discoverable to any local build. Most agents in the tree are bundled.
- **Standalone npm package**: your own repo, consumed by TypeAgent via
  `@package install`.
  [Tutorial: build an Echo agent (standalone package)](./tutorial-echo.md)
  is the full external-package walkthrough.

This page is the overview: the shape of an agent, the end-to-end flow, and
distribution options. Deeper topics have their own sub-guides; see
[Topics](#topics) below.

## Topics

Building an agent breaks into several areas of interest. This section will
grow to cover each; today the following are available:

- [User interaction (`ActionIO` and display)](./user-interaction.md): how an
  action handler shows text, status, HTML, tables, and message kinds
  (`info`/`status`/`warning`/`error`/`success`) to the user; append modes;
  the display helpers from `@typeagent/agent-sdk/helpers/display`.

Planned (not yet written; see the
[agent SDK README](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agentSdk/README.md)
in the meantime):

- **Actions and grammar** - authoring `<name>Schema.ts` and
  `<name>Schema.agr`, the `executeAction` contract, validated typed actions.
- **Agent lifecycle** - `initializeAgentContext`, `updateAgentContext`,
  `closeAgentContext`, and when to hold long-lived resources.
- **Readiness and setup flows** - `checkReadiness`, `setup`, and the
  yes/no choice card pattern via `handleChoice`.
- **Commands** (`@`-commands) - `getCommands` / `executeCommand` and
  `CommandDescriptors`.
- **Storage** - `instanceStorage` and `sessionStorage` on `ActionContext`.
- **Streaming** - `streamPartialAction` and `streamingActionContext` for
  incremental output.
- **Dynamic display** - `getDynamicDisplay` for results that update over
  time.

## 1. Pick a pattern

Every TypeAgent agent falls into one of nine architectural patterns based on
how it talks to external systems, whether it keeps state, and what output it
produces. Read [Agent patterns](../../architecture/agents/agent-patterns.md)
first and pick one; use the corresponding examples as a reference.

The most common choice is `schema-grammar`: a bounded set of typed actions
defined in a `.ts` schema with a matching `.agr` grammar file.

## 2. Scaffold the agent

There are two ways to create the initial files:

- **Automated (recommended):** the `onboarding` agent walks an integration
  through discovery, schema, grammar, scaffolding, testing, and packaging,
  and picks a pattern for you. From a running shell or CLI:
  ```
  start onboarding for <integration-name>
  ```
  See [`packages/agents/onboarding/README.md`](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/agents/onboarding/README.md).
- **Manual:** copy an existing agent whose pattern matches yours (for
  `schema-grammar`,
  [`list`](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agents/list)
  is a good starting point) and rename its files.

Either way, an agent ends up with the standard layout:

```
packages/agents/<name>/src/
  <name>Manifest.json    # metadata, schema pointers, emoji
  <name>Schema.ts        # typed action/activity definitions
  <name>Schema.agr       # grammar rules (NL to structured actions)
  <name>ActionHandler.ts # implements instantiate(): AppAgent
```

## 3. Define actions and grammar

Author the four files above. The important contracts:

- `<name>Schema.ts` exports a union of typed actions. This is the API
  surface the LLM (and grammar matcher) targets.
- `<name>Schema.agr` maps natural-language patterns to those actions.
- `<name>ActionHandler.ts` exports `instantiate(): AppAgent` and implements
  `executeAction(action, context)`. The dispatcher hands you an
  already-typed, already-validated action; agents never parse language
  directly.

See [Agent patterns](../../architecture/agents/agent-patterns.md) for
pattern-specific details (long-lived resources, `closeAgentContext`,
streaming, sub-agent orchestration, etc.).

## 4. Build and try it

From `ts/`:

```bash
pnpm run build
pnpm run shell     # or: pnpm run cli
```

In a running shell or CLI, install a locally-built agent from disk:

```
@package install <name> <path to the built package>
@config agent
```

`@package install` accepts a local path, a catalog entry, or a feed
specifier; see [Agent install sources](../../architecture/lifecycle/agent-sources.md).
While iterating, ordering a local `path` source ahead of the feed lets your
local build **shadow** a published version.

## 5. Distribute the agent

Once the agent works, decide how users will install it. There are three
sources, in order of decreasing friction.

### Local `path` (development)

No packaging needed. A built agent directory installs directly from disk:

```
@package install <name> <path to the built package>
```

This is the fastest inner loop and the flow used by the Echo tutorial.

### A `catalog` entry

A catalog is a JSON file mapping short names to packages, so users install
by name (`@package install <name>`). Add an entry pointing at a local path
or a published package name:

```jsonc
{
  "agents": {
    "<name>": { "name": "@company/<name>-agent", "execMode": "separate" },
  },
}
```

### Publishing to a feed

A `feed` source installs from an Azure Artifacts npm registry by package
specifier (`@package install <name> <name>-agent@^1.2`). Two author-side
requirements make a published package discoverable **as an agent**:

1. **Declare the sentinel keyword.** Add `typeagent-agent` to your
   package's `keywords` in `package.json`. Feed enumeration keeps only
   packages carrying this keyword; scope membership alone is not enough,
   because support libraries live in the same scope.

   ```jsonc
   // package.json
   {
     "keywords": ["typeagent-agent"],
   }
   ```

2. **Pass the policy check.** `npm run check:policy` fails the build if a
   package that exposes `"./agent/manifest"` in its `exports` is missing
   the keyword, so the marker cannot be forgotten.

3. **(Recommended) Declare a default agent name.** Add
   `typeagent.defaultAgentName` to `package.json` so users can install by
   a friendly name in one argument (`@package install <name>`) instead of
   the full package specifier. It must be a legal dispatcher agent
   identifier (letters, digits, `-`/`_`, starting with a letter); an
   illegal or missing value simply disables one-argument name install, and
   the package can still be installed with the two-argument form
   (`@package install <package> <name>`). The same field applies to
   `path` and catalog `path` entries, read from the resolved directory's
   `package.json`.

   ```jsonc
   // package.json
   {
     "typeagent": { "defaultAgentName": "<name>" },
   }
   ```

Feed **installs** additionally require `az login` on the installing
machine and, unless the source is configured with an explicit
`registry`/`scopes`, the `TYPEAGENT_FEED_REGISTRY` /
`TYPEAGENT_FEED_SCOPES` environment values. See
[Agent sources › the feed source](../../architecture/lifecycle/agent-sources.md#the-feed-source)
for how auth and enumeration work, and the
[TypeAgent command reference](../../overview/command-reference.md#package-source-list--order--add--remove---manage-install-sources)
for the `@package source` commands that configure and order sources.

## Landing the docs

If the agent lives in the repo, its README shows up on the wiki
automatically once you follow the wiki-registration checklist in
[Add an agent](../../contributing/add-an-agent.md).

## Related

- [Agent patterns](../../architecture/agents/agent-patterns.md): pick the right
  shape for your agent.
- [Dispatcher](../../architecture/core/dispatcher.md): how the host routes
  actions to your agent.
- [Agent SDK](https://github.com/microsoft/TypeAgent/tree/main/ts/packages/agentSdk):
  the `AppAgent` interface and helpers.
- [Agent install sources](../../architecture/lifecycle/agent-sources.md): the
  full path/catalog/feed model.
- [Tutorial: build an Echo agent (standalone package)](./tutorial-echo.md):
  step-by-step walkthrough of a standalone external agent.
