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
