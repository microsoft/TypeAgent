# TypeAgent Engineering Wiki

Welcome to the **TypeAgent** engineering wiki — the internal reference for the
architecture, packages, and agents that make up the TypeAgent monorepo. This
site is generated with [DocFX](https://dotnet.github.io/docfx/) from Markdown
that lives next to the code it documents, so the docs stay close to the source
and evolve with it.

> **Note:** TypeAgent is **sample code** exploring a single-personal-agent
> architecture — not a framework or product. For the Python port, see
> [microsoft/typeagent-py](https://github.com/microsoft/typeagent-py).

## What is TypeAgent?

**TypeAgent** explores an architecture for building a single _personal agent_
with _natural language interfaces_, leveraging current advances in large
language models. The goal is to get work done by safely and efficiently
combining stochastic systems (language models) with traditional, deterministic
software components.

A single personal agent routes a user's natural-language request to one of many
specialized **application agents** (plugins) — for music, calendar, email,
lists, the browser, and more — while keeping cost and latency low by distilling
language-model behavior into logical structures that can handle most requests
without a model call. The aim is a single agent that can apply to **any**
application, mapping requests to actions at far lower cost and latency than
current systems.

Actions and memories flow together. An action like _"add to my calendar a
pickleball game 2–3pm Friday"_ yields a **memory** that can become a parameter
of a future action like _"put an hour of recovery time after my pickleball
game."_ TypeAgent is working toward an architecture, **AMP**, that integrates
**a**ctions, **m**emory, and **p**lans so this information flows naturally — and
is applying AMP to the web by building a browser that lets sites register
actions through a JavaScript interface. For agent memory it uses a new indexing
and query approach called **Structured RAG**, which answers questions about past
conversations ("what books did we talk about?") substantially better than
classic RAG.

## Design principles

Three principles have emerged during the investigation. Each applies across the
project's three pillars — **actions**, **memory**, and **plans** — and they are
the _why_ behind much of the architecture documented in this wiki.

### 1. Distill models into logical structures

Replace model calls with patterns wherever a pattern can be discovered.

- **Actions** — find translation patterns and replace some model calls by
  applying them (what the [action grammar](./architecture/core/actionGrammar.md)
  and cache do).
- **Memory** — build ontologies from text.
- **Plans** — people, programs, and models collaborate using "tree of thought".

### 2. Use structure to control information density

Tight structure keeps the relevant information inside the model's attention
budget.

- **Actions** — applications define discrete categories with dense descriptions
  of their action sets (the typed schemas).
- **Memory** — tight semantic structures fit into the attention budget
  (Structured RAG).
- **Plans** — each search-tree node defines a focused sub-problem.

### 3. Use structure to enable collaboration

Structure lets humans, programs, and models cooperate on the same problem.

- **Actions** — humans decide how to disambiguate action requests.
- **Memory** — simple models extract logical structure from text.
- **Plans** — quality models, advantage models, language models, humans, and
  programs collaborate to expand each best-first-search node.

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

| Piece                   | Role                                                | Learn more                                             |
| ----------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| Dispatcher              | Central routing and orchestration engine.           | [Dispatcher](./architecture/core/dispatcher.md)        |
| Action grammar          | NFA/DFA matcher compiled from `.agr` grammar files. | [Action grammar](./architecture/core/actionGrammar.md) |
| Cache                   | Caches action translations to minimize LLM calls.   | [Packages › cache](./packages/index.md)                |
| Memory (Structured RAG) | Conversational memory with high precision/recall.   | [Memory](./architecture/memory/memory.md)              |
| Application agents      | The plugins that actually do the work.              | [Agents](./agents/index.md)                            |
| Shell / CLI             | The Electron shell and console front ends.          | [Packages](./packages/index.md)                        |

## Where the code lives

TypeAgent is a mono-repo organized by language, with the TypeScript tree as the
primary surface this wiki documents:

- [`ts`](https://github.com/microsoft/TypeAgent/tree/main/ts) — TypeScript code
  (a **pnpm monorepo**: libraries under `ts/packages/**`, application agents
  under `ts/packages/agents/**`).
- [`python`](https://github.com/microsoft/TypeAgent/tree/main/python),
  [`dotnet`](https://github.com/microsoft/TypeAgent/tree/main/dotnet),
  [`android`](https://github.com/microsoft/TypeAgent/tree/main/android) —
  companion trees. (A separate Python port lives at
  [microsoft/typeagent-py](https://github.com/microsoft/typeagent-py).)

Agents define their actions using [TypeChat](https://github.com/microsoft/typechat)
schemas, which TypeAgent also uses to validate LLM responses.

## Sample code — scope, status & limitations

TypeAgent is **sample code**, not a framework or a product. It is shared to
encourage exploration of natural-language agent architectures built with
structured prompting and LLMs. Keep this framing in mind when reading the
reference material here:

- It is in **active development** with frequent updates and refactoring; sample
  agents are not meant for production without further testing and validation.
- It has been tested with **Azure OpenAI** on developers' own machines, and
  primarily in **English** — performance may vary otherwise.
- Because it uses schema to validate LLM responses, an agent's validity depends
  on how well **its schema** captures the user intents and LLM responses for its
  domain.
- **You supply the API keys** for the services an example uses.
- State (registration, chat, memory, …) is **stored locally** in your user
  folder (`~/.typeagent/`) as text/JSON; agents that use external services
  (e.g. Microsoft Graph) may store state there. The repo **does not collect
  telemetry by default**.

**Roadmap:** the team intends to publish reusable libraries for agent memory and
action dispatch.

## What's in this wiki

| Section                                 | What it covers                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture](./architecture/index.md) | Cross-cutting deep dives: the dispatcher, action grammar, cache, memory (Structured RAG), agent patterns, completion, the workflow system, and more. |
| [Packages](./packages/index.md)         | Reference for every library and app package under `ts/packages/**` — the building blocks the agents and shell are composed from.                     |
| [Agents](./agents/index.md)             | Reference for every application agent under `ts/packages/agents/**`, plus the nine agent patterns they follow.                                       |
| [Contributing](./contributing/index.md) | How to build the wiki, add and edit pages, how new packages/agents flow in, the doc-autogen pipeline, and the style guide.                           |

The rest of this Overview section: **[Getting started](./overview/getting-started.md)**
(build, configure, and run the Shell) and the
**[Glossary](./overview/glossary.md)**.

## How this wiki is built

This wiki keeps each piece of knowledge in exactly one place:

- **Conceptual content** (this page, the architecture map, the contributor
  guide, templates) is hand-authored under `ts/docs/`.
- **Architecture deep dives** are native files under `ts/docs/architecture/**`,
  grouped into sub-directories — the former Design tree now lives in
  `architecture/workflows/`. They are edited in place; the DocFX build reads them
  directly, with no second copy.
- **Package and agent reference** is sourced from each package's own
  documentation (its `README.md`, its `README.AUTOGEN.md` companion from the
  [doc-autogen pipeline](./contributing/doc-autogen.md), any other root-level
  markdown, and its `docs/` folder) and staged in at build time. A generator
  keeps the navigation in step with the filesystem so a newly added package or
  agent shows up automatically.

See [How the wiki is structured](./contributing/wiki-structure.md) for the full
content model and the rationale behind it.

## Quick links

- Repository: [microsoft/TypeAgent](https://github.com/microsoft/TypeAgent)
- TypeScript workspace README: [`ts/README.md`](https://github.com/microsoft/TypeAgent/blob/main/ts/README.md)
- Questions: [Q&A discussions](https://github.com/microsoft/TypeAgent/discussions/categories/q-a)
- Code of Conduct: [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/)
- Python port: [microsoft/typeagent-py](https://github.com/microsoft/typeagent-py)
- Public docs site (GitHub Pages): the Eleventy site under the repo-root
  `docs/` folder — separate from this internal wiki.
