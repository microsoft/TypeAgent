# The doc-autogen pipeline

Package and agent **reference** in this wiki is fed by the **doc-autogen**
pipeline, which keeps a generated companion document next to every package's
hand-written README. This page is the contributor-facing summary; the full
architecture and operations runbook are the canonical docs:

- Architecture & format spec: [doc-autogen — architecture](../architecture/doc-pipeline/doc-autogen.md)
- Pipeline setup guide: [doc-autogen — setup](../architecture/doc-pipeline/doc-autogen-setup.md)
- Tool README: [`ts/tools/docsAutogen/README.md`](https://github.com/microsoft/TypeAgent/blob/main/ts/tools/docsAutogen/README.md)

## What it produces

For each eligible package under `ts/packages/**`, doc-autogen writes a
`README.AUTOGEN.md` file at the package root. It **never modifies the
hand-written `README.md`** — that file is treated as authoritative source and
forwarded to the model as context. The companion contains:

- an AI-authored summary (Overview / What it does / Key files / How to extend),
  validated for length, tone, and link integrity, and
- a deterministic **Reference** appendix computed from `package.json`, `src/`,
  and the workspace graph: entry points, dependencies, used-by graph, files of
  interest, and — for agents — a per-action reference table.

A staleness footer records the commit and date the companion was generated
against.

## How it feeds the wiki

To avoid two confusingly-similar "README" entries, the build stages each source
under a clear name and surfaces the hand-written one as primary:

- `README.md` → staged as `overview.md`, shown as **Overview** (the package's
  primary page).
- `README.AUTOGEN.md` → staged as `generated.md`, shown as a secondary
  **Generated README** page nested beside the Overview.

When only one of the two exists, that single page becomes the package's entry.
The policy is controlled by `WIKI_PAGE_POLICY` (`both` (default), `overview`, or
`generated`) in
[`scripts/build-wiki.mjs`](https://github.com/microsoft/TypeAgent/blob/main/ts/docs/scripts/build-wiki.mjs).
Alongside the README pair, the build also stages **every other root-level
markdown file** in the package (name preserved) and mirrors the package's
`docs/` directory if it has one, so a package's full documentation surfaces in
the wiki. It then regenerates the `packages/` and `agents/` navigation; the
DocFX `content` globs in
[`docfx.json`](https://github.com/microsoft/TypeAgent/blob/main/ts/docs/docfx.json)
include everything staged under those sections.

> **Long-term direction:** merge the two into a single page per package — the
> hand-written Overview followed by the generated deterministic **Reference**
> appendix — so there is exactly one page per package. The renaming above is the
> intermediate step; `WIKI_PAGE_POLICY` already lets a docset show just one of
> the two today.

## Running it locally

```bash
# Plan only — show which packages would be regenerated.
pnpm --filter @typeagent/docs-autogen docs:generate:dry

# Regenerate one package's companion (deterministic Reference, no LLM call).
node ts/tools/docsAutogen/bin/docs-autogen.cjs --package <name> --render --write

# Same, plus AI-authored body (requires Azure OpenAI credentials).
node ts/tools/docsAutogen/bin/docs-autogen.cjs --package <name> --render --write --llm
```

## The command reference (`--command-reference`)

Separately from the per-package companions, doc-autogen also generates the
top-level [`docs/overview/command-reference.md`](../overview/command-reference.md)
— the reference for every `@` command. Unlike the package companions, this is a
**purely deterministic** transform (no LLM): it boots a headless, read-only
dispatcher with every bundled agent's commands enabled and renders each
command's Usage / Arguments / Flags directly from its `CommandDescriptor`,
mirroring `@help`. The output is formatted through Prettier so it is
commit-ready.

```bash
# Regenerate docs/overview/command-reference.md (no API keys needed).
node ts/tools/docsAutogen/bin/docs-autogen.cjs --command-reference

# Preview on stdout without writing.
node ts/tools/docsAutogen/bin/docs-autogen.cjs --command-reference --dry-run
```

Because the descriptors are the single source of truth, **do not hand-edit
`command-reference.md`**. To change a command's summary, arguments, or flags,
edit its `CommandDescriptor` in the agent source and regenerate. Extended prose
for a command belongs in the README next to the code that implements it (e.g.
the `@config collision` family and `@grammar collisions` are documented in the
[dispatcher README](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/dispatcher/dispatcher/README.md#action-collision-detection),
and the `@package` commands in the
[default-agent-provider README](https://github.com/microsoft/TypeAgent/blob/main/ts/packages/defaultAgentProvider/README.md#managing-installed-agents-package)),
not inline in the generated reference.

## In CI

The on-demand workflow at
[`.github/workflows/docs-generate.yml`](https://github.com/microsoft/TypeAgent/blob/main/.github/workflows/docs-generate.yml)
runs the generator via `workflow_dispatch` and opens a single batched PR with
the refreshed companions.

> **Recommended integration:** the doc-autogen job should also run
> `node ts/docs/scripts/build-wiki.mjs` and include the updated
> `packages/toc.yml` / `agents/toc.yml` / `architecture/toc.yml` in
> its PR. That closes the loop: a newly added package or agent gets both a
> generated companion **and** wiki navigation without any manual step. The
> generator is being finalized on a separate branch; until it lands, run the
> TOC script by hand as described in [Add a package](./add-a-package.md).

## Do not hand-edit companions

`README.AUTOGEN.md` files are overwritten on every run. To change what they say,
improve the hand-written `README.md` (the model mirrors and extends it) or the
generator itself. To opt a package out, delete its `README.AUTOGEN.md`; an
explicit opt-out flag is tracked in the design doc.
