# What is TypeAgent?

**TypeAgent** is sample code that explores an architecture for building a
single _personal agent_ with _natural language interfaces_, leveraging current
advances in large language models. The goal is to get work done by safely and
efficiently combining stochastic systems (language models) with traditional,
deterministic software components.

A single personal agent routes a user's natural-language request to one of
many specialized **application agents** (plugins) — for music, calendar,
email, lists, the browser, and more — while keeping cost and latency low by
distilling language-model behavior into logical structures that can handle
most requests without a model call.

## The core flow

```
User input
  → Grammar matcher        (cheap, deterministic NL → candidate actions)
  → Dispatcher             (routing, disambiguation, agent lifecycle)
  → Typed action           (validated against the agent's schema)
  → Agent handler          (executeAction)
  → ActionResult           (displayed, and remembered)
```

1. The user types or speaks a request.
2. The **action grammar** matcher tries to resolve it to a typed action
   deterministically. On a miss, the **dispatcher** falls back to an LLM-based
   translator and the **cache** records the translation so the next identical
   request is cheap.
3. The resolved, already-validated typed action is dispatched to the owning
   **application agent**, which implements `executeAction(action, context)`.
4. The agent returns an `ActionResult`, which is rendered to the user and can
   become **memory** that informs future actions.

## Major moving parts

| Piece                   | Role                                                | Learn more                                              |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| Dispatcher              | Central routing and orchestration engine.           | [Dispatcher](../architecture/core/dispatcher.md)        |
| Action grammar          | NFA/DFA matcher compiled from `.agr` grammar files. | [Action grammar](../architecture/core/actionGrammar.md) |
| Cache                   | Caches action translations to minimize LLM calls.   | [Packages › cache](../packages/index.md)                |
| Memory (Structured RAG) | Conversational memory with high precision/recall.   | [Memory](../architecture/index.md)                      |
| Application agents      | The plugins that actually do the work.              | [Agents](../agents/index.md)                            |
| Shell / CLI             | The Electron shell and console front ends.          | [Packages](../packages/index.md)                        |

## Where the code lives

TypeAgent is a **pnpm monorepo** rooted at `ts/`. The TypeScript packages live
under `ts/packages/**`; application agents live under `ts/packages/agents/**`.
There are companion Python and .NET trees, but this wiki focuses on the
TypeScript engineering surface.

> TypeAgent is **sample code**. It is meant to illustrate an architecture, not
> to ship as a product. Keep that framing in mind when reading the reference
> material here.
