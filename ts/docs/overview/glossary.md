# Glossary

Vocabulary used throughout the TypeAgent wiki.

| Term                          | Meaning                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action**                    | A typed, validated operation an agent can perform (e.g. `playTrack`). Actions are defined by TypeScript schema types.                                    |
| **ActionResult**              | The structured value an agent returns from `executeAction`; rendered to the user and may become memory.                                                  |
| **Activity**                  | A longer-lived, possibly multi-step interaction an agent participates in, as opposed to a one-shot action.                                               |
| **Agent (application agent)** | A plugin that implements the `AppAgent` interface and handles a set of typed actions. Lives under `ts/packages/agents/**`.                               |
| **`AppAgent`**                | The interface (from `@typeagent/agent-sdk`) every agent implements: `initializeAgentContext`, `updateAgentContext`, `executeAction`, and optional hooks. |
| **`.agr` file**               | A grammar source file describing natural-language patterns that map to typed actions.                                                                    |
| **`.ag.json`**                | Compiled grammar output produced from `.agr` sources.                                                                                                    |
| **Cache**                     | The translation cache that records NL → action results to avoid repeat LLM calls.                                                                        |
| **Collision**                 | When more than one agent/schema could match a request; the dispatcher resolves it via grammar, registry, one-shot, or user clarification.                |
| **Dispatcher**                | The core routing engine that turns user input into typed actions and dispatches them to agents.                                                          |
| **doc-autogen**               | The pipeline that writes `README.AUTOGEN.md` companions next to each package; see [the doc-autogen guide](../contributing/doc-autogen.md).               |
| **Grammar matcher**           | The NFA/DFA matcher that resolves input to actions deterministically before any LLM call.                                                                |
| **Manifest**                  | An agent's `*Manifest.json` describing its metadata, schema pointers, and emoji.                                                                         |
| **Schema**                    | The TypeScript action/activity type definitions for an agent (`*Schema.ts`), parsed into JSON Schema for validation.                                     |
| **Shell**                     | The Electron GUI front end (`ts/packages/shell`).                                                                                                        |
| **Structured RAG**            | TypeAgent's indexing/query approach for conversational memory; higher precision/recall than classic RAG.                                                 |
| **Translator**                | The LLM-backed step that resolves an action when the grammar matcher misses.                                                                             |
