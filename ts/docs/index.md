# TypeAgent Engineering Wiki

Welcome to the **TypeAgent** engineering wiki — the internal reference for
the architecture, packages, and agents that make up the TypeAgent
monorepo. This site is generated with [DocFX](https://dotnet.github.io/docfx/)
from Markdown that lives next to the code it documents, so the docs stay
close to the source and evolve with it.

> **New here?** Start with [What is TypeAgent?](./overview/what-is-typeagent.md),
> then skim the [Architecture map](./architecture/index.md). When you are ready
> to write docs, read the [Contributor guide](./contributing/index.md).

## What you'll find here

| Section                                 | What it covers                                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [Overview](./overview/index.md)         | What TypeAgent is, the design principles behind it, how to get a dev environment running, and a glossary of terms.               |
| [Architecture](./architecture/index.md) | Cross-cutting deep dives: the dispatcher, action grammar, cache, memory (Structured RAG), agent patterns, completion, and more.  |
| [Packages](./packages/index.md)         | Reference for every library and app package under `ts/packages/**` — the building blocks the agents and shell are composed from. |
| [Agents](./agents/index.md)             | Reference for every application agent under `ts/packages/agents/**`, plus the nine agent patterns they follow.                   |
| [Contributing](./contributing/index.md) | How to add and edit pages, how new packages/agents flow into the wiki, the doc-autogen pipeline, and the style guide.            |

## How this wiki is built

This wiki keeps each piece of knowledge in exactly one place:

- **Conceptual content** (overviews, the architecture map, this contributor
  guide, templates) is hand-authored here under `ts/docs/`.
- **Architecture deep dives** are native files under `ts/docs/architecture/**`,
  grouped into sub-directories — the former Design tree now lives in
  `architecture/workflows/`. They are edited in place; the DocFX build reads them
  directly, with no second copy.
- **Package and agent reference** is sourced from each package's own
  `README.md` and its `README.AUTOGEN.md` companion (produced by the
  [doc-autogen pipeline](./contributing/doc-autogen.md)) and staged in at build
  time. A generator keeps the navigation in step with the filesystem so a newly
  added package or agent shows up automatically.

See [How the wiki is structured](./contributing/wiki-structure.md) for the full
content model and the rationale behind it.

## Quick links

- Repository: [microsoft/TypeAgent](https://github.com/microsoft/TypeAgent)
- TypeScript workspace README: [`ts/README.md`](https://github.com/microsoft/TypeAgent/blob/main/ts/README.md)
- Public docs site (GitHub Pages): the Eleventy site under the repo-root
  `docs/` folder — separate from this internal wiki.
