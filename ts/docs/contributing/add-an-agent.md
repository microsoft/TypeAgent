# Add an agent

When a new application agent is added under `ts/packages/agents/**`, follow
these steps so it shows up in the [Agents](../agents/index.md) section. The flow
mirrors [Add a package](./add-a-package.md), with a couple of agent-specific
notes.

## 1. Scaffold the agent

Most agents are created with the **onboarding** agent, which walks an
integration through discovery → schema → grammar → scaffolding → testing →
packaging and picks an appropriate [agent pattern](../architecture/agents/agent-patterns.md).
However it is created, an agent ends up with the standard layout:

```
packages/agents/<name>/src/
  <name>Manifest.json    # metadata, schema pointers, emoji
  <name>Schema.ts        # typed action/activity definitions
  <name>Schema.agr       # grammar rules (NL → structured actions)
  <name>ActionHandler.ts # implements instantiate(): AppAgent
```

## 2. Write the agent README

Add a hand-written `README.md` at the agent's root. Start from the
[agent page template](../templates/agent-page.md). Cover what the agent does,
which pattern it follows, the actions it exposes, and any external setup
(API keys, host-app plugins, OS requirements).

## 3. (Optional) Generate the AI companion

```bash
node ts/tools/docsAutogen/bin/docs-autogen.cjs --package <name> --render --write
```

For agent packages, the generated `README.AUTOGEN.md` includes a per-action
reference table derived from the agent's schema, which is especially useful in
the wiki.

## 4. Refresh the wiki navigation

```bash
node ts/docs/scripts/build-wiki.mjs
```

The agent is discovered under `ts/packages/agents/**` and added to
`agents/toc.yml`. Nested agent packages (e.g. `agentUtils/graphUtils`) are
handled automatically.

## 5. Consider the patterns doc

If your agent introduces or exemplifies a pattern not already covered, update
[Agent patterns](../architecture/agents/agent-patterns.md) (canonical home
`ts/docs/architecture/agent-patterns.md`) so the agents index stays accurate.

## 6. Preview and open a PR

[Build locally](./build-locally.md), confirm the agent renders, then open a PR
including the new `README.md`, the regenerated `agents/toc.yml`, and any
companion or pattern-doc updates.

## Making an agent installable

Bundled agents ship with the app. To let users **install** your agent on demand
through `@package install`, it must be reachable from an
[install source](../architecture/lifecycle/agent-sources.md). There are three
ways, matching the three source kinds.

### Local `path` (development)

No packaging needed — a built agent directory installs directly from disk:

```
@package install echo <path to the built echo package>
```

This is the flow the [Creating an Agent](https://github.com/microsoft/TypeAgent/blob/main/docs/content/tutorial/agent.md)
tutorial uses. It is the fastest inner loop and lets a local build **shadow** a
published version when its `path` source is ordered ahead of the feed.

### A `catalog` entry

A catalog is a JSON file mapping agent short names to packages, so users install
by name (`@package install echo`). Add an entry pointing at either a local path
or a published package name:

```jsonc
{
  "agents": {
    "echo": { "name": "@company/echo-agent", "execMode": "separate" },
  },
}
```

### Publishing to a feed

A `feed` source installs from an Azure Artifacts npm registry by package
specifier (`@package install echo echo-agent@^1.2`). Two author-side requirements
make a published package discoverable **as an agent**:

1. **Declare the sentinel keyword.** Add `typeagent-agent` to your package's
   `keywords` in `package.json`. Feed enumeration keeps only packages carrying
   this keyword — scope membership alone is not enough, because support libraries
   live in the same scope.

   ```jsonc
   // package.json
   {
     "keywords": ["typeagent-agent"],
   }
   ```

2. **Pass the policy check.** `npm run check:policy` fails the build if a package
   that exposes `"./agent/manifest"` in its `exports` is missing the keyword, so
   the marker cannot be forgotten.

Feed **installs** (by whoever runs `@package install`) additionally require
`az login` on the installing machine and, unless the source is configured with an
explicit `registry`/`scopes`, the `TYPEAGENT_FEED_REGISTRY` /
`TYPEAGENT_FEED_SCOPES` environment values. See
[Agent sources › the feed source](../architecture/lifecycle/agent-sources.md#the-feed-source)
for how auth and enumeration work, and the
[Agent Install Sources reference](https://github.com/microsoft/TypeAgent/blob/main/docs/content/reference/install-sources.md)
for the `@package source` commands that configure and order sources.
