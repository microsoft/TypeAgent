# Agent page template

> Copy this into an agent's `README.md` and replace the placeholders. Delete
> this quote block once done. A per-action reference table is generated into the
> `README.AUTOGEN.md` companion by the
> [doc-autogen pipeline](../contributing/doc-autogen.md).

---

# `<agent-name>` agent

One or two sentences: what this agent lets a user do in natural language.

- **Pattern:** one of the nine [agent patterns](../architecture/agents/agent-patterns.md)
  (e.g. `schema-grammar`, `external-api`, `state-machine`). State which and why.
- **Emoji / id:** from `<name>Manifest.json`.

## What it does

The user-facing capabilities, as a short list of example utterances:

- "play some jazz" → `playTrack`
- "skip this song" → `next`

## Actions

The typed actions this agent exposes, defined in `<name>Schema.ts`. Summarize
the important ones here; the full, always-current list is in the
**Generated README** companion.

| Action         | What it does |
| -------------- | ------------ |
| `<actionName>` | …            |

## Setup

Any external prerequisites: API keys and where they go (`config.local.yaml`),
host-app plugins, OS requirements, or a one-time auth flow. If none, say "No
external setup required."

## How it works

A short description of the handler flow: how `executeAction` dispatches the
typed action, any external service or RPC bridge it uses, and any persistent
state it keeps.

## File layout

```
src/
  <name>Manifest.json    # metadata, schema pointers, emoji
  <name>Schema.ts        # typed action/activity definitions
  <name>Schema.agr       # grammar rules (NL → structured actions)
  <name>ActionHandler.ts # implements instantiate(): AppAgent
```

## Related

- [Agent patterns](../architecture/agents/agent-patterns.md)
- [Dispatcher](../architecture/core/dispatcher.md)
- Any architecture doc specific to this agent (e.g. the browser agent docs).
