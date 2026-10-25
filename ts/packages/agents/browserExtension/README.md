# @typeagent/browser-extension

The TypeAgent browser extension (Chrome/Edge + Electron). This package holds the
extension source, build scripts, and packaging. The core browser **agent** lives
in `browser-typeagent` (`../browser`); the shared browser types and content-script
RPC client live in `@typeagent/browser-control-rpc` (`../browserControlRpc`).

## Build

To build the extension, run `pnpm run build` in this folder. For debug support,
run `pnpm run dev`. Output goes to `dist/extension/` (Chrome/Edge) and
`dist/electron/` (Electron).

## Install (Chrome/Edge)

1. Enable developer mode in your browser. For Chrome and Edge, the steps are:

   - Launch browser
   - Click on the extensions icon next to the address bar. Select "Manage extensions" at the bottom of the menu.
   - This launches the extensions page. Enable the developer mode toggle on this page.

2. Build the extension (see above).
3. Load the unpacked extension:
   - Go to the "Manage extensions" page from step #1
   - Click on "Load unpacked". Navigate to this package's `dist/extension` folder.

## Running the extension

1. Launch the browser where you installed the extension.
2. Launch the TypeAgent shell or the TypeAgent CLI. These are integrated with the
   extension and can send commands. You can issue commands such as:
   - open new tab
   - go to new york times
   - follow news link
   - scroll down
   - go back
   - etc.

## Crossword Decision mode

In extension options, set **Crossword mode** to **Decision** to resolve clues
on demand rather than extracting a complete Generative schema. Generative
remains the default. Decision mode reports unavailable providers, unsupported
layouts and ambiguous selections explicitly; it does not fall back to chat.

Configure `decision.provider` as `copilot`, `azure`, or `inherit` in the
TypeAgent runtime configuration. See the
[native Decision configuration](../../config/README.md#native-decision-configuration)
and [AI client API](../../aiclient/README.md#native-decisions) for provider
settings and Azure deployment requirements.

Discovery classifies visible regions before selecting a clue from bounded
candidate choices. The Hybrid2 strategy caches selected regions for subsequent
clues. Entry uses the selected live node; clue reads request a literal body
string only when needed and cache it. Clue-text sentinels invalidate the puzzle
on replacement or text changes without treating ordinary grid progress as a
new puzzle. Frame/document identity, configuration changes, cancellation and
deadlines remain part of the request lifecycle.

### Tests

Build from the repository's `ts` directory before running compiled tests:

```powershell
pnpm run build
pnpm --filter @typeagent/browser run test:crossword
pnpm --filter @typeagent/browser-extension run test:crossword
pnpm --filter @typeagent/aiclient run test:local
pnpm --filter @typeagent/config run test:local
```

The browser tests cover native Azure/Copilot wire adapters with mocked HTTP,
batching, Azure 422 repacking, model-owned ambiguity, body reads and cache
invalidation. Extension unit tests cover settings, private/frame RPC, collection,
sentinels and verified entry.

For optional browser integration tests, install Chromium with Playwright or
use an existing Edge/Chrome installation. Prepare the pinned Exolve renderer
once, then run the offline isolated-world scenarios:

```powershell
pnpm --filter @typeagent/browser-extension run test:crossword:setup
pnpm --filter @typeagent/browser-extension run test:crossword:chromium
```

The fixture, puzzle and renderer license live in
[test/fixtures/crossword](test/fixtures/crossword); no example package is needed.
Renderer setup downloads only hash-verified assets from a pinned revision.
Native-model lanes are disabled unless `TYPEAGENT_CROSSWORD_LIVE=1` is set.

The optional installed-extension harness uses actual typed AppAgent actions
through the service worker and backend, not natural-language dispatcher routing:

```powershell
$output = Join-Path $env:TEMP ('crossword-e2e-' + [guid]::NewGuid())
pnpm --filter @typeagent/browser-extension run test:crossword:extension -- $output --demo --mode=decision --site=exolve --headed --reads
```

This command makes native inference calls and records the owned page. Use it
only with authorized provider access and recording consent. `--preflight`
checks the page without inference or recording. The default local fixture is
deterministic; the optional Seattle and Universal scenarios assert specific
editions and are not general all-puzzle qualification.

## Chat panel

The extension's chat panel supports the same `@conversation` slash
commands and natural-language conversation management as the Shell and
CLI (`new`, `list`, `info`, `switch`, `prev`, `next`, `rename`,
`delete`). Switching, creating, or moving between conversations clears
the panel and replays the new conversation's history, so peer activity
from a Shell or CLI joined to the same conversation is also visible.

## Memory imports

The browser context menu exposes **Memory** as the single entry point to Memory
Hub. The retired Memory Center and Knowledge Library menu entries are no longer
shown; their legacy URLs remain compatible. Menu initialization replaces the
extension's existing entries so stale duplicates do not survive worker restarts.

Website and HTML-folder imports, automatic indexing, and save-page capture use
the model-driven `content` pipeline. The options page and import dialogs do not
offer alternate modes or quality presets. Content extraction requires an
available model; there is no metadata-only indexing fallback. Unsupported
pre-release extraction settings are reported explicitly; use **Reset to
Defaults** on the options page to discard them. Procedure discovery settings
and candidate review remain independent of memory processing.

## PDF imports

Memory Hub's **Add to memory** dialog provides **Import PDF**. Select a named
corpus in the persistent selector and a local PDF, then import. Memory Hub
extracts Markdown locally and submits `corpusId`, `title`, `markdown` and
`canonicalUri` through ordinary `memoryImportDocument`. No PDF bytes, layout
artifacts or location maps are sent to memory. The selected Memory Hub corpus
is the explicit import target. The host uses the shared memory service's
`content` pipeline.

The extension-hosted PDF viewer provides **Save to corpus** in its toolbar.
Choose a corpus and submit to extract from the already-loaded PDF using the same
adapter in Chrome and Electron. The bridge initializes by parent-window messaging rather than a URL
token, checks source/origin/token, and reuses the extension transport. Standalone
viewer pages do not expose save without that bridge. This channel check does not
grant PDF storage or read access. Viewer messages carry Markdown, source identity
and extraction statistics, never PDF bytes or layout artifacts.

Extraction reports page progress. The dialog observes ordinary memory job states
and saves only pending job, corpus, source and revision identifiers in session
storage for reconnect without resubmission. Import and Cancel share one action
row. Closing after submission leaves indexing running; cancellation uses
`memoryCancelJob`. Monitoring uses source-scoped `memoryListJobs` pages and
verifies the accepted job, source and revision identity. Source content and
forgetting use ordinary memory operations.

Import currently limits local PDFs to 10 MiB and inline Markdown requests to
16 MiB. These are enforced limits, not a performance qualification. Preview,
export and inspection keep PDF bytes and extraction artifacts local; corpus
import stores Markdown through memory ingestion. Local source identity
uses the original-byte SHA-256; remote identities reject credentials and query
parameters unless the user selects a safe alias or byte-hash identity.

The shared `@typeagent/browser-control-rpc/pdfMarkdown` adapter uses the pinned
Papero engine and Markdown/math exporter, without OCR. Runtime code lives in
`browserControlRpc/src/converters/pdfToMarkdown`, parent tests in
`browserControlRpc/test/pdfToMarkdown`, and regeneration/qualification tools in
`ts/tools/scripts/converters/pdfToMarkdown`. Dependencies belong to the parent
package. Full-book upstream/adapted/production Markdown parity is verified, not
general correctness of every table, formula, figure/caption or reading order.
Image-only PDFs fail explicitly;
textless pages require consent to import available text. Encrypted local imports
request a password without persisting it. Viewer inspection now has tested
in-memory semantic caching and pause/cancel; persistent text-page checkpoints
and block/crop controls are removed. Offline tests do not qualify live indexing,
all PDF layouts or full-book performance.

See [PDF Markdown import boundaries](../browser/docs/pdf-markdown-import.md).

Passing offline import/bridge tests does not
mean that all PDF work packages or live acceptance scenarios are complete.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
