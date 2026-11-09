# PDF To Markdown Converter

The format-based runtime lives in
`ts/packages/agents/browserControlRpc/src/converters/pdfToMarkdown`, leaving
`src/converters` available for future formats such as EPUB. Tests and synthetic
fixtures live in `browserControlRpc/test/pdfToMarkdown`. This directory contains
regeneration, artifact copying, comparison, qualification, and provenance
patches, not a standalone package. Dependencies and compilation belong to the
parent `@typeagent/browser-control-rpc` package.

## Source And Attribution

The extraction and Markdown algorithms come from
[Papero](https://github.com/beatrizalmeidaf/papero-pdf-text-extractor), pinned to
`f9e92cbc0224d1413c11dda15b284ee41b9fc48f`. The full upstream MIT license,
including `Copyright (c) 2026 Beatriz Almeida`, is preserved in runtime `LICENSE`
and third-party notices. Every vendored JavaScript file starts with the upstream
copyright, license, its exact pinned `web/assets` source URL, and explicit
TypeAgent modification attribution. TypeAgent-authored adapters and tools use
Microsoft MIT headers; these do not claim ownership of upstream algorithms.

Runtime `source-manifest.json` retains original SHA-256 hashes and records
adapted hashes, local adapter hashes, dependencies, and patch locations. All
patches are stored here, including header-only patches for unchanged helper
bodies. Reversing the patches reconstructs the exact pinned upstream bytes.
Historical deployed-demo comparisons are retained as evidence of matching
asset bytes, not a claim about the deployment's commit ID.

Local adaptations replace the CDN import and worker mutation, manage document
lifecycle and cancellation, normalize PDF.js 5 compact operator lists, and
support caller-owned viewer proxies with bounded work. The exporter retains the
previous exact AST-selected Markdown dependency closure. No extraction,
layout, formula, table, or rendering algorithm is pruned or reimplemented by
this restructuring. Vendored bodies and generated evidence are excluded from
Prettier to keep patches reproducible.

## Runtime Contract

The production entrypoint `src/converters/pdfToMarkdown/index.js` and matching
declarations expose only `extractExistingDocument`, `toMarkdown`, and
`figureWords`. Qualification code imports `engine.js` directly when it needs
`extractDocument`, `openPdf`, or `SCHEMA`; these remain intact in the engine.

```ts
import {
  extractExistingDocument,
  toMarkdown,
} from "./converters/pdfToMarkdown/index.js";

const result = await extractExistingDocument(viewerPdf, {
  signal: abortController.signal,
  concurrency: 1,
  maxTextChars: 10000000,
  maxBlocks: 100000,
});
const markdown = toMarkdown(result.doc, {
  math: "latex",
  images: "none",
  pageBreaks: false,
});
```

The viewer owns the PDF proxy and worker; existing-document extraction does not
destroy the proxy or clean viewer pages. The engine document schema remains
`pdf-text-api/document@1`. Pages are 1-based; bounding boxes use top-left,
rotation-zero PDF points. Markdown has no synthetic page headings or added
provenance. The supported application adapter remains
`@typeagent/browser-control-rpc/pdfMarkdown`.

PDF.js **5.3.31** is the only runtime PDF.js dependency. The parent explicitly
declares `pdfjs-baseline` (`npm:pdfjs-dist@4.10.38`) and `@napi-rs/canvas`
**0.1.100** as dev dependencies. Node qualification resolves both with
`createRequire` anchored to the parent package, never through optional
transitive canvas dependencies.

## Build And Tests

From the repository root, with the workspace already provisioned:

```powershell
if (Test-Path $PROFILE) { . $PROFILE }
pnpm --dir ts run build packages/agents/browserControlRpc
pnpm --dir ts/packages/agents/browserControlRpc run test:pdf
pnpm --dir ts run build packages/agents/browser packages/agents/browserExtension
pnpm --dir ts/packages/agents/browser run test:pdf
pnpm --dir ts/packages/agents/browserExtension run test:local -- --runInBand
```

The parent compiler emits runtime JavaScript into
`dist/converters/pdfToMarkdown`. Artifact copying adds only the public
declarations, compact source manifest, full upstream license, third-party
notices, and PDF.js license. Tests, docs, scripts, and patches are not copied.
Viewer, Chrome, and Electron distributions carry notices under
`vendor/converters/pdfToMarkdown` and PDF.js support assets under `vendor/pdfjs`.

## Regeneration And Qualification

Use a clean upstream checkout at the exact pin:

```powershell
$upstream = "$env:TEMP/typeagent-papero-upstream-f9e92c"
$tools = "ts/tools/scripts/converters/pdfToMarkdown"
node "$tools/vendor-source.mjs" $upstream
node "$tools/compare-upstream.mjs" $upstream
```

Refresh verifies the original hashes before updating adapted hashes and patches,
adds headers idempotently, regenerates the exact Markdown closure and 12 export
goldens, and preserves historical fetch metadata. `--restore` first rebuilds
adapted files from the pinned checkout plus recorded patches. `--compare-demo`
optionally refreshes public asset evidence; normal refresh requires no network.
The synthetic comparison uses the original engine and helpers on PDF.js 4 in a
separate process, then compares geometry, blocks, and Markdown with PDF.js 5.

Full-book qualification writes private outputs outside the repository:

```powershell
$output = Join-Path $env:TEMP "typeagent-pdf-to-markdown-book"
node "$tools/qualify-book.mjs" "C:/Users/hillarym/Downloads/Goldfarb_NotesonMetamath.pdf" $upstream $output
```

The command requires exact parity across upstream PDF.js 4, adapted PDF.js 5,
and emitted production adapter: **118 pages**, **273,552 characters**, SHA-256
`a8befc8ef1023be20226910a05ee4ed78ebaef5256364e3f98357951c156d0e0`.
No book bytes, Markdown, or private reports belong in this repository.

Parity establishes upstream equivalence, not independent correctness of every
formula. Inherited rotated-text sub/superscript classification remains tested.
Encrypted real PDFs, worker-thread behavior, complete figure/crop semantics,
and live LLM ingestion still require separate runtime evidence. There is no
OCR; callers must enforce byte/page/output/pixel limits and cancellation cannot
interrupt a synchronous layout pass before an asynchronous boundary.
