# TypeAgent Engineering Wiki (DocFX)

This directory is a self-contained [DocFX](https://dotnet.github.io/docfx/)
docset that is the basis of the TypeAgent **eng.ms** engineering wiki. It covers
the architecture, packages, and agents of the monorepo.

> This `README.md` is for people browsing the repo on GitHub. It is **not** part
> of the rendered wiki (DocFX excludes it). The wiki's own landing page is
> [`index.md`](./index.md).

## Layout

| Path                                | What it is                                                                                                                                                                                | Committed?                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `docfx.json`, `toc.yml`, `index.md` | docset config, top-level navigation, landing page                                                                                                                                         | yes                              |
| `overview/`                         | what / principles / getting-started / glossary                                                                                                                                            | yes                              |
| `architecture/`                     | architecture deep dives, grouped into sub-directories (`core`, `collision`, `agents`, `browser`, `workflows`, `doc-pipeline`). The former **Design** content is folded into `workflows/`. | yes (except generated `toc.yml`) |
| `plans/`                            | implementation plans (repo docs; **excluded** from the wiki build)                                                                                                                        | yes                              |
| `packages/`, `agents/`              | curated `index.md`; the rest is staged from `ts/packages/**`                                                                                                                              | `index.md` only                  |
| `contributing/`, `templates/`       | contributor guide and page templates                                                                                                                                                      | yes                              |
| `scripts/build-wiki.mjs`            | stages package/agent docs + regenerates navigation                                                                                                                                        | yes                              |
| `media/`                            | wiki-owned images                                                                                                                                                                         | yes                              |

Build-time output is git-ignored: the staged `packages/**` and `agents/**`
(everything but their `index.md`), the generated `toc.yml` files, and `_site/`.
See [`.gitignore`](./.gitignore).

## Why this layout?

The docset root is **`ts/docs` itself**, so the architecture, overview, and
contributing content are native files in the tree — they need no copying and are
edited in place. Each piece of knowledge has exactly one home:

- conceptual content is authored here under `ts/docs/`;
- architecture deep dives live under `ts/docs/architecture/**` (the former
  separate Design tree now lives in `architecture/workflows/`);
- package / agent reference comes from each package's own documentation — its
  `README.md`, its `README.AUTOGEN.md` companion (produced by the
  [doc-autogen pipeline](../architecture/doc-pipeline/doc-autogen.md)), any other
  root-level markdown, and its `docs/` directory.

(`ts/docs/plans/**` stays in the repo but is excluded from the wiki build.)

The **only** content that lives outside `ts/docs` is the package/agent docs
under `ts/packages`. `build-wiki.mjs` crawls those — every root-level markdown
file plus a mirror of each `docs/` directory — stages them under
`packages/`/`agents/` (rewriting each relative link to an in-wiki link or an
absolute GitHub URL and adding a short "source of truth" banner), and
regenerates the file-system-driven `toc.yml` files. The full rationale is in
[`contributing/wiki-structure.md`](./contributing/wiki-structure.md).

## Build locally

```bash
# 1. Install DocFX once.
dotnet tool install -g docfx

# 2. Stage content + regenerate navigation.
node ts/docs/scripts/build-wiki.mjs

# 3. Build (or serve with live reload).
docfx build ts/docs/docfx.json
docfx ts/docs/docfx.json --serve     # http://localhost:8080
```

The rendered site is written to `_site/` (git-ignored). A CI gate can run
`node ts/docs/scripts/build-wiki.mjs --check` to confirm every architecture doc
is assigned to a group in the taxonomy.

## eng.ms onboarding

To publish this docset as an eng.ms wiki:

1. **Docset root:** `ts/docs` (the directory containing `docfx.json`).
2. **Pre-build step:** the publishing pipeline must run
   `node ts/docs/scripts/build-wiki.mjs` **before** `docfx build`, so the
   staged content and generated TOCs exist. (Node ≥ 22 is already required to
   build the repo.)
3. **Build:** `docfx build ts/docs/docfx.json` (DocFX 2.78+). Output is
   `_site/`.
4. **Edit links / contribution:** `docfx.json` sets `_gitContribute` to this
   GitHub repo so curated pages get an "Edit this page" link; staged pages carry
   an explicit source banner instead.
5. **Integrate with doc-autogen:** once the
   [doc-autogen pipeline](../architecture/doc-pipeline/doc-autogen.md) is back
   online, have it run `build-wiki.mjs` as part of its job so newly added
   packages, agents, and docs flow into the wiki automatically.

See [`contributing/`](./contributing/index.md) for the contributor-facing guide.

## Trademarks

This project may contain trademarks or logos for projects, products, or
services. Authorized use of Microsoft trademarks or logos is subject to and must
follow [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must
not cause confusion or imply Microsoft sponsorship. Any use of third-party
trademarks or logos are subject to those third-party's policies.
