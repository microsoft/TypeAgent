# Add an agent to the wiki

Checklist for making a new application agent under `ts/packages/agents/**`
appear in the [Agents](../agents/index.md) section of the wiki. This page
covers the docs-registration flow only. For the actual agent-building
walkthrough (patterns, scaffolding, iteration, distribution), see
[Build an agent](../guides/build-an-agent/index.md).

The flow mirrors [Add a package](./add-a-package.md), with a couple of
agent-specific notes.

## 1. Write the agent README

Add a hand-written `README.md` at the agent's root, starting from the
[agent page template](../templates/agent-page.md). Cover what the agent
does, which pattern it follows, the actions it exposes, and any external
setup (API keys, host-app plugins, OS requirements).

## 2. (Optional) Generate the AI companion

```bash
node ts/tools/docsAutogen/bin/docs-autogen.cjs --package <name> --render --write
```

For agent packages, the generated `README.AUTOGEN.md` includes a per-action
reference table derived from the agent's schema, which is especially useful
in the wiki.

## 3. Refresh the wiki navigation

```bash
node ts/docs/scripts/build-wiki.mjs
```

The agent is discovered under `ts/packages/agents/**` and added to
`agents/toc.yml`. Nested agent packages (e.g. `agentUtils/graphUtils`) are
handled automatically.

## 4. Consider the patterns doc

If your agent introduces or exemplifies a pattern not already covered,
update [Agent patterns](../architecture/agents/agent-patterns.md)
(canonical home `ts/docs/architecture/agents/agent-patterns.md`) so the
agents index stays accurate.

## 5. Preview and open a PR

[Build locally](./build-locally.md), confirm the agent renders, then open a
PR including the new `README.md`, the regenerated `agents/toc.yml`, and any
companion or pattern-doc updates.
