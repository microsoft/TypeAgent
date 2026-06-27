# Architecture map

This section collects the **cross-cutting architecture deep dives** for
TypeAgent. The documents themselves are the canonical engineering docs that
live under `ts/docs/architecture/` — they are pulled into this wiki by the
DocFX build, so there is exactly one copy of each to maintain. Edit them in
their canonical location; they appear here automatically.

> **Adding an architecture doc?** Drop the Markdown into `ts/docs/architecture/`
> and add one line to [`architecture/toc.yml`](./toc.yml). See
> [Add a page](../contributing/add-a-page.md).

## Start with the core

The fastest way to understand how a request becomes an action:

1. **[Dispatcher](./core/dispatcher.md)** — the central routing and orchestration
   engine. Read this first.
2. **[Action grammar](./core/actionGrammar.md)** — the NFA/DFA matcher compiled from
   `.agr` grammar files that resolves natural language to typed actions before
   any LLM call.
3. **[Completion](./core/completion.md)** — how input completion and suggestions are
   produced.
4. **[Message queueing](./core/messageQueueing.md)** — how messages are ordered and
   processed.
5. **[Workflows](./workflows/workflows.md)** — multi-step workflow execution.

## Collision resolution

When more than one agent or schema could match a request, the dispatcher must
choose. These docs cover detection, resolution strategies, and rollout:

- [Collision analysis](./collision/collision-analysis.md)
- [Collision rollout](./collision/collision-rollout.md)
- [Context-weighted resolution — design](./collision/context-weighted-collision-resolution-design.md)

## Agents & conversations

- [Agent patterns](./agents/agent-patterns.md) — the nine architectural patterns an
  agent can follow. Essential reading before building a new agent; the
  [Agents](../agents/index.md) section indexes the agents themselves.
- [Agent-server conversations](./agents/agentServerConversations.md) — how the agent
  server models conversations.
- [User settings](./core/user-settings.md) — the settings subsystem.

## Browser agent

The browser agent is large enough to warrant its own set of docs:

- [Browser agent](./browser/browserAgent.md)
- [Browser RPC](./browser/browserRpc.md)
- [Browser scenarios](./browser/browserScenarios.md)

## Workflow system

The design of TypeAgent's workflow DSL and intermediate representation (IR) —
formerly the separate "Design" section, now folded in here:

- [Workflow system overview](./workflows/README.md) — the surface DSL, the IR
  it compiles to, the editor/LSP design, engineering plan, and principles.
- [Workflows architecture](./workflows/workflows.md) — how workflows are
  captured, persisted, and executed at runtime.

## Documentation pipeline

How this wiki's package and agent reference stays current:

- [doc-autogen — architecture](./doc-pipeline/doc-autogen.md)
- [doc-autogen — setup guide](./doc-pipeline/doc-autogen-setup.md)

See the contributor-facing summary in
[Contributing › doc-autogen](../contributing/doc-autogen.md).

## Related reference

- **Memory / Structured RAG** — the memory subsystem is implemented primarily
  in the [`knowPro`](../packages/index.md) package. A conceptual overview lives
  on the public docs site
  ([memory.md](https://github.com/microsoft/TypeAgent/blob/main/docs/content/architecture/memory.md)).
- **Packages** — every library that the architecture above is built from is in
  the [Packages](../packages/index.md) section.
- **Agents** — the plugins the dispatcher routes to are in the
  [Agents](../agents/index.md) section.
