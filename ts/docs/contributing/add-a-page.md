# Add or edit a page

This is the general workflow for changing wiki content. For the package- and
agent-specific flows, see [Add a package](./add-a-package.md) and
[Add an agent](./add-an-agent.md).

## Edit an existing page

1. Find the page's **canonical source** using the table in
   [Contributing](./index.md#the-one-rule-edit-content-where-it-lives). The
   "Edit this page" link on any rendered page also jumps straight to it on
   GitHub.
2. Edit the Markdown.
3. [Build the wiki locally](./build-locally.md) to preview (optional but
   recommended).
4. Open a PR.

> Reminder: do **not** edit `README.AUTOGEN.md` files by hand — they are
> regenerated. See [doc-autogen](./doc-autogen.md).

## Add a new curated page

"Curated" pages are the conceptual ones that live under `ts/docs/`
(overview, architecture map, contributing, etc.).

1. Create the `.md` file in the right section folder, e.g.
   `ts/docs/overview/my-topic.md`. Start from a
   [template](../templates/architecture-doc.md) if one fits.
2. Register it in that section's `toc.yml` (these are hand-maintained):

   ```yaml
   - name: My topic
     href: my-topic.md
   ```

3. Add cross-links from related pages so it is discoverable.
4. Preview and open a PR.

## Add a new architecture or workflow doc

1. Create the `.md` under the right group directory, e.g.
   `ts/docs/architecture/core/my-topic.md` or
   `ts/docs/architecture/workflows/...`. The groups are `core`, `collision`,
   `agents`, `browser`, `workflows`, and `doc-pipeline`.
2. Regenerate the navigation:

   ```bash
   node ts/docs/scripts/build-wiki.mjs
   ```

   The architecture toc is generated from the `ARCH_GROUPS` taxonomy in the
   script. A doc placed directly in a group directory is picked up
   automatically. If you instead add a file at the architecture **root**, assign
   it to a group by adding its filename to `ARCH_GROUPS`; otherwise it lands in
   an "Uncategorized" group. `build-wiki.mjs --check` fails if anything is
   uncategorized.

3. Link it from [`architecture/index.md`](../architecture/index.md) if it
   belongs in the curated map.

## Linking conventions

- Link to **other wiki pages** with relative paths to the `.md` file, e.g.
  `../architecture/core/dispatcher.md`. DocFX rewrites these to the correct
  output URL and validates them at build time.
- Link to **source files** (not part of the docset) with absolute GitHub URLs,
  e.g. `https://github.com/microsoft/TypeAgent/blob/main/ts/packages/...`.
- See the [Style guide](./style-guide.md) for the full set of conventions.
