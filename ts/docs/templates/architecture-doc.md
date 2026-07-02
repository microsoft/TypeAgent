# Architecture doc template

> Copy this into a new file under `ts/docs/architecture/` and replace the
> placeholders. Delete this quote block once done. After adding the file, add
> one line to the curated `ts/docs/architecture/toc.yml` (see
> [Add a page](../contributing/add-a-page.md)).

---

# `<Topic>` — Architecture & Design

> **Scope:** One or two sentences stating exactly what this document covers and,
> importantly, what it does **not** cover — with links to the adjacent docs that
> do. Example: "This document describes the cache. For the grammar matcher it
> feeds, see `actionGrammar.md`."

## Overview

The 10,000-foot view: what this system is, where it sits in the request flow,
and the packages that implement it. A small table mapping responsibilities to
packages is often useful:

| Package | Role |
| ------- | ---- |
| `<pkg>` | …    |

## Design goals and non-goals

What the design optimizes for, and the things it deliberately does not try to
do. Non-goals prevent scope creep and answer "why doesn't it just…?" questions.

## How it works

The core mechanism, ideally with a diagram. ASCII diagrams render fine in
DocFX inside a fenced block:

```
input ──▶ [ stage A ] ──▶ [ stage B ] ──▶ output
```

Walk through the stages, the key data structures, and the important code paths
(reference files by their repo path).

## Key decisions

The non-obvious choices and their rationale — effectively inline ADRs. For
larger efforts, link to the decision records under
[the workflow-system design notes](../architecture/workflows/README.md).

## Edge cases and failure modes

What happens when things go wrong, and the invariants that must hold.

## Related

- Adjacent architecture docs.
- The [packages](../packages/index.md) and [agents](../agents/index.md) that use
  this system.
