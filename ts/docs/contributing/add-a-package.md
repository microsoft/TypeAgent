# Add a package

When a new package is added under `ts/packages/**`, follow these steps so its
documentation shows up in the [Packages](../packages/index.md) section.

## 1. Write the package README

Every package should have a hand-written `README.md` at its root. This is the
authoritative narrative — what the package is, what it does, and how to use it.
Start from the [package page template](../templates/package-page.md).

Keep the README focused on the package itself. The deterministic facts
(dependencies, entry points, used-by graph) are added automatically by
doc-autogen, so you do not need to maintain them by hand.

### Additional docs

You are not limited to the README. The wiki also publishes:

- **every other markdown file at the package root** (e.g. `USER_GUIDE.md`,
  `CHANGELOG.md`) — keeping its name, as a sibling page under the package; and
- the package's **`docs/` directory**, mirrored as a nested "docs" subtree
  (markdown + images).

Put structured, longer-form documentation in a `docs/` folder so it lands in a
tidy sub-section rather than cluttering the package root. Reference images from
within `docs/` (e.g. `docs/images/…`) so they are mirrored too — images at the
package root are not staged and will link out to GitHub.

## 2. (Optional) Generate the AI companion

The [doc-autogen pipeline](./doc-autogen.md) writes a `README.AUTOGEN.md`
companion next to your `README.md`. You can run it locally for a single
package:

```bash
node ts/tools/docsAutogen/bin/docs-autogen.cjs --package <name> --render --write
```

This is optional — the pipeline will produce it on its next run — but it lets
you preview the generated reference.

## 3. Refresh the wiki navigation

Regenerate the file-system-driven TOC so the package appears in the sidebar:

```bash
node ts/docs/scripts/build-wiki.mjs
```

The generator finds every directory under `ts/packages/**` that contains a
`package.json` (skipping `node_modules`, `dist`, `test`, `src`, and the
`agents/` subtree) and adds a node for it, with child links to whichever of
`README.md` / `README.AUTOGEN.md` exist. Multi-package containers (e.g.
`dispatcher`, `memory`) are nested automatically.

> Once the doc-autogen pipeline is running, it is expected to run this
> generator as part of its job, so steps 2 and 3 happen for you on the
> pipeline's next dispatch.

## 4. Preview and open a PR

[Build locally](./build-locally.md) to confirm the package renders and its links
resolve, then open a PR. The PR should include:

- the new/updated `README.md`,
- the regenerated `packages/toc.yml` (and `README.AUTOGEN.md` if you generated
  it),
- any cross-links you added from related pages.

## Notes

- If a package has only a `README.AUTOGEN.md` and no `README.md`, the generator
  links to the companion directly. Prefer adding a hand-written `README.md`.
- READMEs may contain relative links to source files (`./src/...`). Those
  render as links in the wiki but will not resolve to a wiki page — that is
  expected. Use absolute GitHub URLs when you want a reliably clickable link to
  source.
