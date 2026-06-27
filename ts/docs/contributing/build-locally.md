# Build the wiki locally

Preview your changes before opening a PR. The wiki is built with
[DocFX](https://dotnet.github.io/docfx/).

## Prerequisites

- **.NET SDK** (DocFX is a .NET global tool).
- Install DocFX once:

  ```bash
  dotnet tool install -g docfx
  ```

  (Use `dotnet tool update -g docfx` to upgrade.)

## Refresh generated navigation, then build

```bash
# 1. Stage package docs + regenerate the generated TOCs
#    (architecture/packages/agents).
node ts/docs/scripts/build-wiki.mjs

# 2. Build the site.
docfx build ts/docs/docfx.json

# 3. Build and serve with live reload at http://localhost:8080
docfx ts/docs/docfx.json --serve
```

The rendered site is written to `ts/docs/_site/` (git-ignored).

## What to check

- Your page appears in the expected section's left-hand navigation.
- Internal links resolve (DocFX logs `Invalid file link` warnings for broken
  relative links — search the build output for them).
- Tables, code blocks, and alerts render as intended.

## Expected warnings

A clean build still emits some warnings; these are known and acceptable:

- **Pre-existing broken links in source docs** — some architecture and
  workflow docs contain links written as repo-root-relative shorthand
  (`ts/packages/...`) or with off-by-one `../`, and a few reference files that
  have since moved or been deleted. These were broken before the wiki existed.
- **Links from staged package READMEs to source files** (`./src/...`) do not
  resolve to wiki pages — READMEs are authored for the repo, not the docset.

Treat _new_ warnings about _your_ pages as actionable; the pre-existing ones
above are tracked separately. Do not enable warnings-as-errors for the whole
build until that link debt is cleaned up.

## CI check

To verify every architecture doc is assigned to a group (useful as a PR gate):

```bash
node ts/docs/scripts/build-wiki.mjs --check
```

It exits non-zero if any generated `toc.yml` is out of date, and warns if a new
`architecture/*.md` is missing from the curated architecture TOC.
