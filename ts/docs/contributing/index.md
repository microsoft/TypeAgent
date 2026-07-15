# Contributing to TypeAgent

This section covers **changing the TypeAgent repo**, both code and docs.
If you are building an agent that consumes TypeAgent, start with
[Build an agent](../guides/build-an-agent/index.md) instead.

## Contributing code

- **[Development setup](./development-setup.md)**: prereqs, build, run,
  test, lint, and debug. The authoritative build instructions live in
  [`ts/README.md`](https://github.com/microsoft/TypeAgent/blob/main/ts/README.md);
  this wiki page is the index into it.
- **[CLA and contribution basics](https://github.com/microsoft/TypeAgent/blob/main/CONTRIBUTIONS.md)**:
  the CLA bot will decorate your first PR.
- **[Code of Conduct](https://github.com/microsoft/TypeAgent/blob/main/CODE_OF_CONDUCT.md)**
  and **[Security disclosure policy](https://github.com/microsoft/TypeAgent/blob/main/SECURITY.md)**
  (do **not** file security issues on GitHub).

## Contributing to the wiki

This wiki is **source-controlled Markdown** that lives in the TypeAgent
repository and is published with [DocFX](https://dotnet.github.io/docfx/).
You contribute to it the same way you contribute code: edit Markdown, open
a pull request, get it reviewed, and merge. There is no separate wiki
editor and no out-of-band content store.

### The one rule: edit content where it lives

Every piece of knowledge has exactly one canonical home. Edit it there
and it appears in the wiki automatically; never copy content into a second
place.

| You want to change…                        | Edit the file under…                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| A conceptual / overview / contributor page | `ts/docs/**` (this directory)                                                            |
| An architecture deep dive                  | `ts/docs/architecture/<group>/**`                                                        |
| A workflow-system design / decision record | `ts/docs/architecture/workflows/**`                                                      |
| A package's narrative docs                 | that package's `README.md`                                                               |
| A package's generated reference            | regenerate its `README.AUTOGEN.md` via [doc-autogen](./doc-autogen.md); do not hand-edit |

[How the wiki is structured](./wiki-structure.md) explains why, and how
DocFX assembles these sources into one site.

### Build and preview locally

Before opening a PR, build the site to check your changes. Two steps:
stage the package docs and regenerate navigation, then run DocFX.

```bash
# one-time: install DocFX (needs the .NET SDK)
dotnet tool install -g docfx

# 1. stage package/agent docs + regenerate the generated TOCs
node ts/docs/scripts/build-wiki.mjs

# 2. build to ts/docs/_site/  (or use --serve for live reload at :8080)
docfx build ts/docs/docfx.json
docfx ts/docs/docfx.json --serve
```

> Always run `node ts/docs/scripts/build-wiki.mjs` **before** > `docfx build`. A fresh checkout has no staged package docs or generated
> `toc.yml` files until it runs. See
> [Build the wiki locally](./build-locally.md) for details.

### Common tasks

- **[Add or edit a page](./add-a-page.md)**: the general workflow,
  including how to register a new page in the navigation.
- **[Add a package](./add-a-package.md)**: what to do so a new package's
  docs show up.
- **[Add an agent](./add-an-agent.md)**: the wiki-registration checklist
  for a new agent. For the agent-building walkthrough, see
  [Build an agent](../guides/build-an-agent/index.md).
- **[The doc-autogen pipeline](./doc-autogen.md)**: how `README.AUTOGEN.md`
  companions are generated and how they feed the wiki.
- **[Style guide](./style-guide.md)**: conventions for headings, links,
  and Markdown that renders cleanly in DocFX.
- **[Build the wiki locally](./build-locally.md)**: preview your changes
  before opening a PR.

## Templates

Start new pages from a template so they match the house style:

- [Package page](../templates/package-page.md)
- [Agent page](../templates/agent-page.md)
- [Architecture doc](../templates/architecture-doc.md)
