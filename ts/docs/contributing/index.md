# Contributing to the wiki

This wiki is **source-controlled Markdown** that lives in the TypeAgent
repository and is published with [DocFX](https://dotnet.github.io/docfx/).
You contribute to it the same way you contribute code: edit Markdown, open a
pull request, get it reviewed, and merge. There is no separate wiki editor and
no out-of-band content store.

## The one rule: edit content where it lives

Every piece of knowledge has exactly one canonical home. Edit it there and it
appears in the wiki automatically — never copy content into a second place.

| You want to change…                        | Edit the file under…                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| A conceptual / overview / contributor page | `ts/docs/**` (this directory)                                                             |
| An architecture deep dive                  | `ts/docs/architecture/<group>/**`                                                         |
| A workflow-system design / decision record | `ts/docs/architecture/workflows/**`                                                       |
| A package's narrative docs                 | that package's `README.md`                                                                |
| A package's generated reference            | regenerate its `README.AUTOGEN.md` via [doc-autogen](./doc-autogen.md) — do not hand-edit |

[How the wiki is structured](./wiki-structure.md) explains why, and how DocFX
assembles these sources into one site.

## Common tasks

- **[Add or edit a page](./add-a-page.md)** — the general workflow, including how
  to register a new page in the navigation.
- **[Add a package](./add-a-package.md)** — what to do so a new package's docs
  show up.
- **[Add an agent](./add-an-agent.md)** — same, for application agents.
- **[The doc-autogen pipeline](./doc-autogen.md)** — how `README.AUTOGEN.md`
  companions are generated and how they feed the wiki.
- **[Style guide](./style-guide.md)** — conventions for headings, links, and
  Markdown that renders cleanly in DocFX.
- **[Build the wiki locally](./build-locally.md)** — preview your changes before
  opening a PR.

## Templates

Start new pages from a template so they match the house style:

- [Package page](../templates/package-page.md)
- [Agent page](../templates/agent-page.md)
- [Architecture doc](../templates/architecture-doc.md)
