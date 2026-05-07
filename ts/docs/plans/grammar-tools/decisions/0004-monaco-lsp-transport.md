# ADR 0004 - Monaco LSP transport

Status: **Open**. Resolve before: **Track G start** (chunk 05 web app
scaffold, step G.0). Part of the Phase 2 decision gate.
Blocks: 05.

## Context

The web app (chunk 05) hosts Monaco with monaco-languageclient and needs
to talk to the same LSP server the VS Code extension (chunk 03) uses.
There are two reasonable transports.

## Options

### A. WebSocket to Node-hosted LSP server _(recommended)_

- Pros: keeps `grammar-tools-core` Node-friendly (free use of `fs`,
  `path`, etc.); single LSP implementation shared with the VS Code
  extension.
- Cons: requires the web app server process to host the LSP server.

### B. LSP server in a Web Worker

- Pros: no server dependency, fully client-side.
- Cons: `grammar-tools-core` must be browser-safe (no Node `fs`, no
  `path`); complicates the loader (can't read `.agr` from disk in the
  worker).

## Decision

_Pending._ Recommendation: **A** for v1, with B as a future option if
we ever need to ship a static-only build.

## Consequences

Choosing A keeps chunk 01 free to use Node APIs. Choosing B forces an
abstraction over file I/O in chunk 01.
