# Package page template

> Copy this into a package's `README.md` and replace the placeholders. Delete
> this quote block and the guidance notes once done. The deterministic facts
> (dependencies, entry points, used-by graph) are added automatically by the
> [doc-autogen pipeline](../contributing/doc-autogen.md) in the
> `README.AUTOGEN.md` companion — you do not need to maintain them here.

---

# `<package-name>`

One or two sentences: what this package is and the single responsibility it
owns within TypeAgent.

## Overview

A short paragraph expanding on the summary. Where does this package sit in the
[architecture](../architecture/index.md)? What problem does it solve, and for
whom (which other packages or agents depend on it)?

## What it does

The main capabilities, as a short list:

- Capability one.
- Capability two.
- Capability three.

## Usage

The minimal way another package consumes this one. Use a fenced code block with
a language hint:

```ts
import { thing } from "<package-name>";
```

If the package exposes a CLI or scripts, show the most common invocation.

## Key concepts

Explain any vocabulary or model a reader must understand to use the package.
Link to the [glossary](../overview/glossary.md) for shared terms rather than
redefining them.

## How to extend

Where a contributor adds the next feature, the extension points, and any
invariants to preserve.

## Related

- Link to the relevant [architecture doc](../architecture/index.md).
- Link to packages this one depends on or is depended on by (use package names;
  the generated Reference appendix has the full graph).
