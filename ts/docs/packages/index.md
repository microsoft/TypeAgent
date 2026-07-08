# Packages

Reference documentation for every library and application package under
`ts/packages/**` (application **agents** live in their own
[Agents](../agents/index.md) section).

Use the left-hand navigation to browse packages. Containers that hold several
related packages — for example `dispatcher` (`dispatcher`, `nodeProviders`,
`rpc`, `types`) and `memory` (`conversation`, `image`, `storage`, `website`) —
are grouped under a single expandable node.

## How to read a package's reference

Each package surfaces one or two pages, named to avoid confusion:

- **Overview** (`overview.md`) — the hand-written `README.md`, maintained by the
  package owners. This is the authoritative narrative and the package's primary
  page.
- **Generated README** (`generated.md`) — the `README.AUTOGEN.md` companion
  produced by the [doc-autogen pipeline](../contributing/doc-autogen.md), shown
  as a secondary page beside the Overview. It adds a deterministic **Reference**
  appendix (entry points, dependencies, used-by graph, files of interest) plus
  an AI-authored summary. Cross-check it against the Overview and the source
  before relying on specifics.

When a package has only one of the two, that single page becomes its entry.

## The most important packages

If you are new, these are the load-bearing packages to read first:

| Package                | Role                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `dispatcher`           | Core routing engine — translation, execution, context. See the [Dispatcher architecture](../architecture/core/dispatcher.md). |
| `agentSdk`             | The `AppAgent` interface every agent implements.                                                                              |
| `actionSchema`         | Parses TypeScript action types into JSON Schema for validation.                                                               |
| `actionGrammar`        | NFA/DFA compiler that turns `.agr` grammar files into matchers. See [Action grammar](../architecture/core/actionGrammar.md).  |
| `cache`                | Caches action translations to minimize LLM calls.                                                                             |
| `knowPro`              | Structured RAG implementation for conversational memory.                                                                      |
| `defaultAgentProvider` | Loads the runtime set of agents from its config.                                                                              |
| `shell`                | The Electron GUI front end.                                                                                                   |
| `cli`                  | The console front end (connected mode via the agent server).                                                                  |

## Adding a package

When a new package is added under `ts/packages/**`, regenerate this section's
navigation so it appears here:

```bash
node ts/docs/scripts/build-wiki.mjs
```

The [doc-autogen pipeline](../contributing/doc-autogen.md) can both write the
package's `README.AUTOGEN.md` and refresh these TOCs. See
[Add a package](../contributing/add-a-package.md) for the full checklist.
