# ADR 0005 - Shared service contract

Status: **Accepted** (2026-04-28). Surface declared; framing and
trace-event shape deferred per the open sub-decisions below.
Blocks: 01 (re-states the public surface as the wire contract), 03
(removes the webview messaging open question), 04 (`GrammarBackend`
formalized), 05 (REST + WebSocket endpoints), 06 (shell IPC).

## Context

The `grammar-tools-core` service surface (chunk 01: loader, diagnostics,
symbols, format, completion preview, trace, coverage, diff) is consumed
across four host shapes today and a fifth in the future:

1. VS Code webview ↔ extension over `postMessage`.
2. Web app over HTTP REST + WebSocket (chunk 05).
3. Shell renderer ↔ main over IPC (chunk 06).
4. In-process direct call (CLI in chunk 07; unit tests; LSP server inside
   the extension).
5. (Deferred per [ADR 0004](./0004-monaco-lsp-transport.md)) Web Worker
   hosting core in the browser.

Chunk 04 already declares `GrammarBackend` "mirrors `grammar-tools-core`
services 1:1." Chunk 03 has an open question on webview messaging shape.
Chunk 05 will expose REST endpoints proxying core. Without a single
declared contract, three hosts will reinvent framing and the typed
mirror will drift from `grammar-tools-core`.

## Decision

**`grammar-tools-core`'s exported function signatures are the
authoritative contract.** Three constraints follow:

1. **One typed mirror.** `grammar-tools-ui` exports a single
   `GrammarBackend` interface whose methods correspond 1:1, name for
   name, parameter for parameter, return type for return type, to the
   public functions in `grammar-tools-core`. Hosts inject an
   implementation; UI components depend only on `GrammarBackend`.

   ```ts
   // grammar-tools-ui
   export interface GrammarBackend {
     loadGrammarFromFile(path: string): Promise<LoadResult>;
     loadGrammarFromAgent(agentName: string): Promise<LoadResult>;
     loadGrammarFromSnapshot(snapshot: GrammarSnapshot): Promise<LoadResult>;
     getDiagnostics(g: LoadedGrammar): Promise<Diagnostic[]>;
     getSymbolIndex(g: LoadedGrammar): Promise<SymbolIndex>;
     format(source: string): Promise<string>;
     previewCompletion(
       g: LoadedGrammar,
       input: string,
       cursor?: number,
     ): Promise<CompletionPreview>;
     traceMatch(g: LoadedGrammar, input: string): TraceMatchResult; // shape per "Open" below
     runCoverage(
       g: LoadedGrammar,
       corpus: Iterable<string>,
     ): Promise<CoverageReport>;
     diffGrammars(a: LoadedGrammar, b: LoadedGrammar): Promise<GrammarDiff>;
   }
   ```

   All methods are `Promise`-returning even when the in-process
   implementation is synchronous, so the same interface serves remote
   transports without per-method specialization.

2. **One serialization rule.** Every transport that crosses a process
   boundary serializes parameters and return values as JSON using the
   exact types declared in `grammar-tools-core`. No transport-specific
   DTOs. `LoadedGrammar`, `Diagnostic`, `SourceLocation`, `RuleId`,
   `PartId`, `TraceEvent`, `CoverageReport`, `GrammarDiff` are the wire
   types as well as the in-process types.

   In-process callers skip serialization and use the values directly;
   the typed shape is identical either way.

3. **Schema versioning.** The package version of `grammar-tools-core`
   is the contract version. Additive changes (new optional fields, new
   methods) are minor-version-safe. Any breaking change to a
   wire-visible type bumps `grammar-tools-core` major and is called
   out in the PR description.

### What this decision does **not** lock

Two concrete sub-decisions are deferred to chunk 03 / 05 implementation
because they depend on UX requirements that are not yet defined:

- **Wire framing** (plain request/response vs JSON-RPC 2.0 vs custom).
  The typed contract is framing-agnostic. Resolve when the first remote
  host (VS Code webview in chunk 03) needs it. Recommended default if
  no UX pressure: JSON-RPC 2.0, because it covers both request/response
  and server-pushed notifications uniformly across postMessage / HTTP /
  IPC.
- **`traceMatch` event-stream shape** (one-shot array vs streamed
  events vs both). Depends on the debug-panel UX in chunk 04 (does the
  user see events as they happen, or after match completes?). Until
  that's defined, `TraceMatchResult` is an opaque placeholder in the
  interface above; the concrete shape lands with chunk 04's debug-panel
  spec and B.2 implementation.

Both sub-decisions are scoped to "how the same typed contract is
transported," not "what the contract is."

## Consequences

- Chunk 03's open question on webview ↔ extension messaging contract is
  closed: same shape as the chunk 05 HTTP API, both are
  `grammar-tools-core` signatures over the chosen framing.
- Chunk 04's `GrammarBackend` is formalized here rather than redefined
  per host. The fixture backend in D.0 is a `GrammarBackend`
  implementation against canned data.
- Chunk 01 should add a one-liner declaring its public function
  signatures the wire contract; this ADR is the canonical reference.
- Future Web Worker host (deferred ADR 0004) inherits the contract for
  free - it is one more transport, not a new shape.
- Schema-versioning expectations are now explicit; reviewers can flag
  PRs that break the wire contract.

## Open sub-decisions

| Sub-decision                               | Resolve when                    | Owner              |
| ------------------------------------------ | ------------------------------- | ------------------ |
| Wire framing (plain RPC vs JSON-RPC 2.0)   | Chunk 03 webview implementation | Track C lead       |
| `traceMatch` shape (one-shot vs streaming) | Chunk 04 debug-panel UX defined | Track D lead + B.2 |
