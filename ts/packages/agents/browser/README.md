# Browser TypeAgent (core agent)

`browser-typeagent` is the core browser **agent** (`AppAgent`): it handles
browser-related actions, knowledge extraction/indexing, search and answer
generation, WebFlows, and the PDF viewer. It runs inside the dispatcher /
agent-server process and controls a browser through the shared
`BrowserControl` interface, implemented by either the Chrome/Edge extension
(`@typeagent/browser-extension`) or the Electron shell's inline browser.

Related packages:

- **`@typeagent/browser-control-rpc`** (`../browserControlRpc`) — shared
  browser types + content-script RPC client this agent depends on.
- **`@typeagent/browser-extension`** (`../browserExtension`) — the
  Chrome/Electron extension. See that package's README to build, install, and
  run the extension.

## Build

Run `pnpm run build` in this folder (builds the agent, PDF views, and
puppeteer helpers).

### Puppeteer browser

The Puppeteer helpers require Node.js 22.12.0 or later. Puppeteer's install
scripts are disabled by workspace policy, so `pnpm install` does not download
its browser. After updating Puppeteer, install the matching Chrome binary
from `ts/`:

```powershell
pnpm --filter @typeagent/browser exec puppeteer browsers install chrome
```

When using an existing system Chrome installation instead, update that browser
separately. Updating Puppeteer does not patch system Chrome.

## Architecture

### Scoped graphs and Memory Hub navigation

Memory Hub Explore supports entity, topic and maintained hierarchy graphs with
document/event filters, bounded graph previews and exact evidence drilldown.
The entity and topic pages show filters, graph controls and the canvas without
coverage disclosures, collection/count paging rows, browse lists or routine
maintenance status messages. Loading, empty states and request failures remain
visible. Refresh, Global and Fit are Font Awesome icon buttons with accessible
labels and tooltips, grouped inside the upper-left corner of the graph canvas.
The graph response omits coverage, counts, limits and inventory paging
metadata; topic generation is retained for snapshot-safe evidence drilldown.
Graph preparation happens separately from reads; hosts
without the scoped capability report it explicitly. Retained originals and event
bodies remain subject to current eligibility and suppression checks.

Views use paginated cards and a separate detail reader, with build receipts in a
flyout. Grouped activity, Inbox navigation and responsive detail panels reuse
summary inventories rather than fetching every view's full evidence. These
navigation features do not depend on checkpoint or integrated-answer APIs.
Inventory pages contain up to 25 summaries per collection, not 25 globally.
Inbox has counted tabs for Question decisions, Views, and Sources & operations.
Its All overview shows at most two compact rows per category, with Questions
first; full explanations and existing actions open in a details side panel.
Review uses a file-lines icon button, and each All-overview section's View all
action uses a list icon button. Both retain descriptive accessible names and
tooltips. Views uses a bell for Latest build, retaining its spinner while a build
is running.
Counts describe loaded attention items/groups, with `+` when more may be
available, rather than claiming a complete cross-collection total. Switching
tabs or opening an explanation does not fetch another evidence inventory.
Activity and Inbox use summary conflict state where available; full conflict
evidence is reserved for selected details or older-service compatibility.

Explore, Inbox, Sources, Views, Questions and Activity share icon-and-underline
navigation styling. Active filters retain their pressed state; actual tab panels
retain their selected state. Tab strips scroll horizontally rather than wrapping
or widening the page on smaller screens. Views exposes its existing type filter
as tabs above search and build controls, preserving paginated inventory queries,
search text, keyboard focus and horizontal scroll position when it refreshes.
Supported Views tabs are ordered All, Knowledge Wiki, Project Brief, Timeline
and Troubleshooting Guide. Questions has its own left-navigation entry rather
than a duplicate Views filter tab. Collection-maintenance entry points use the
screwdriver-and-wrench icon.

Views and Questions place those tabs directly after the page title. Their lists,
search controls and bottom pagination live in Sources-style surface cards with
server-reported totals in the upper-right corner, not loaded-page counts.
Unavailable question inventories are marked unavailable or partial rather than
displayed as a complete zero. Knowledge preparation remains lazy and is placed
at the bottom of Questions. Explore Overview has no separate refresh button;
scope changes and the main refresh action retain their existing behavior.

Wiki and Project Brief readers distinguish synopsis and coverage caveats from
their main sections in a blue-tinted right-hand infobox, alongside version,
completeness and revision
metadata. Article text wraps beside the infobox on wide screens; at 800 px and
below the panel stacks above the article. Source disclosures, section navigation
and edit actions remain available. Project Brief goals, owners, status, milestones,
decisions, risks and context stay in the main reading flow; other view types retain
their layout.
Reader Back and Edit controls are icon-only with accessible names and tooltips.
The overflow control opens the shared icon-and-text action menu, including
conditional conflict review and generated-update unlocks. Escape dismisses the
menu; closing an action dialog returns focus to the overflow trigger.

Views shows a spinner and loading message inside the list card during type
changes, hiding stale results and paging until the new inventory settles.
Rapid type changes queue the latest filter rather than dropping it while another
read is in flight. Failed reads remain explicit and do not display a misleading
empty result.

### Schema-defined questions

The Questions landing page uses two columns of compact cards, stacking into one
column at 800 px and below. A card opens a dedicated question reader at a
corpus/view/slot deep link. Answer candidates and evidence stay in the main content,
while an option B sidecard groups coverage, review/admission state, view version
and evaluated-source metadata. The reader retains guarded edits, explicit errors,
retry, history and exact evidence. Back returns to the previous scoped inventory
with its filters and paging; direct links can load slots outside the current page
without scanning every collection.

The Memory hub's Questions workspace is a complete projection of versioned
schema-view slots, including proposed and rejected slots. The inspector reviews
candidates and exact source revisions, records schema-validated user assertions,
and edits versioned rubrics without rewriting source evidence. Question and
answer state, review, freshness and coverage are displayed separately.

Question decisions are ranked, grouped by view and capped at five groups. Dismissal
and one-day snooze use the existing fingerprint preferences; changed evidence
resurfaces decisions, and Questions can restore dismissed decisions. Source
mentions are not independent votes.

Assisted authoring requires explicit approval to generate a proposal and an
explicit maintenance scope; per-view generated slots still require approval.
Per-view discovery is opt-in, bounded and explicitly invoked. Corpus-level
discovery can separately admit informational contracts under the
`sourceObserved` policy. Neither operation authorizes tools.
`memoryGetViewPage` returns deterministic Markdown and a `memory-view:` URI;
Markdown links preserve exact revisions, slots and collection item keys when
opened in the browser. Optional service capabilities and operation errors are
reported explicitly, not interpreted as empty inventories. Question lists use
bounded summary pages; selecting a question separately loads its full evidence.
Questions loads knowledge preparation status, discovery policy controls,
bounded failed-discovery retries and captured readiness checkpoints. This
progress is fetched only when the Knowledge preparation disclosure is expanded,
not when loading question lists or Inbox attention. Existing
corpora remain off until enabled; new corpora default to source observed.
Policy admission is not human confirmation, and source indexing alone never
implies knowledge readiness. Integrated search answers retain original-source
citations and separately render maintained-View and user-assertion evidence.

Questions also shows acquisition progress and explicit run-once/cancel controls
for existing host-authorized requests. Its RPC projection excludes staged
content, authorized arguments and raw request errors. The workspace cannot admit
acquisition requests, enable periodic work or authorize tools; unsupported and
disabled hosts are reported explicitly. Ingestion receipts link to ordinary
activity and retained-source pages.

### PDF Understanding Worktree

The PDF viewer supports local open/drop, selected-page semantic inspection,
sanitized Markdown preview, Markdown/JSON export, and pause/cancel. Extraction
uses the viewer-owned PDF.js document without destroying it. Semantic results
are cached only in memory; persistent extraction checkpoints and block/crop
inspection controls are removed. Preview/export does not implicitly save bytes
to memory.

Corpus PDF import submits extracted Markdown through `memoryImportDocument` to
the shared memory service in `content` mode, with title, optional canonical URI
and tags. Memory owns source revisions and ingestion jobs. The browser agent
does not retain original PDF bytes, extraction artifacts, capture manifests or
location maps, and does not expose PDF-specific storage or capability RPC.
Removing this functionality does not delete previously saved user data.

The converter reuses pinned Papero extraction and Markdown/math algorithms in
`browserControlRpc/src/converters/pdfToMarkdown`. Tests live in the parent
package's `test/pdfToMarkdown`; regeneration and qualification tools live in
`ts/tools/scripts/converters/pdfToMarkdown`. The parent package owns dependencies
and compilation, with no nested converter package. Full-book upstream/adapted/
production Markdown parity is verified; general semantic correctness of tables,
math, figures/captions and difficult reading order is not. Local viewer opening allows 50 MiB. Performance
reports do not qualify browser memory, image rendering or annotation interaction.

Retained-PDF capture/status/read/query/open actions are removed. Imported
Markdown uses ordinary memory source content, search, job and forget operations.
See [PDF Markdown import boundaries](docs/pdf-markdown-import.md) for the
remaining WebSocket and native renderer routing boundaries.

### Memory imports and page capture

Browser history, bookmark, HTML-folder imports, and saved pages use the shared
model-driven `content` memory pipeline. No processing presets or metadata-only
indexing modes are exposed. Existing supported `maxCharsPerChunk` options still
tune chunk sizing within that pipeline. Unsupported pre-release import modes
are reported as errors instead of mapped or migrated. Browser metadata
enumeration is not indexing: imported URLs are fetched and their original
content is submitted to durable memory. Save-page capture and procedure
candidate discovery/review remain separate from processing-mode selection.

### Memory Hub

The **Memory** view is available at the browser agent's discovered view host
under `/memory/hub/`. The extension's Memory menu and the browser agent's
`memoryHub` view name open it. It uses the existing loopback/same-origin HTTP
gateway, typed domain allowlist and parent-process RPC; it does not create a
separate memory store.

The migration includes Inbox, Library, Runbooks for existing human how-tos,
Activity and corpus how-to Settings. Phase 2 adds corpus-neutral Search and
Ask, Explore, browser imports and durable Changes history. Standalone Memory
Center, Knowledge Library, Entity Graph and Topic Graph shells have been
retired. Source management is a reusable Hub component. Advanced entity/topic
graphs and reading analytics now live under `#/explore/web/analytics`,
`#/explore/web/entities/<selection>` and `#/explore/web/topics/<selection>`.
They remain fixed to **TypeAgent Browser Memory**, not the selected corpus.
Graph filters, layouts, exports, drilldown and original-site links are retained;
graph status/build/rebuild controls are in Settings.

Old logical names, custom-protocol links and HTTP filenames remain aliases,
including stale `/library/<old-page>.html` URLs. They redirect before static
files are served. HTTP redirects preserve the query and inherited browser
fragment; the Hub translates old sections/selections and removes its temporary
`legacyView` marker. Annotations, Automations and the PDF reader are unchanged.

Search retains List/Grid and adds Timeline/Domain grouping for actual web
evidence; mixed non-web results remain visible in List. Query topics/entities
come from at most 20 exact active returned-source revisions, never inferred
from snippets or substituted from another corpus. Historical-revision insights
and failed knowledge reads are explicitly unavailable. Browser-local view and
notification preferences reuse the existing storage key, preserve unknown
fields and protect unsaved edits. Optional completion notifications do not
suppress errors.

Inbox is derived from detected/draft candidates, stale procedures and
failed/partial ingestion jobs. The host drains every jobs page, so counts
are not limited to the first page. Dismiss/snooze preferences are local to
the browser and apply only to the exact item state/version. A changed item
needs attention again. Missing corpus operations are reported explicitly.
The Activity badge counts canonical failed jobs only, independently of
Inbox dismiss/snooze preferences; partial jobs still need Inbox attention.

The hub exposes narrowly typed domain methods:

- `memoryHubSnapshot`: complete corpus-scoped or all-memory Inbox and
  procedure summaries, with per-operation errors for incomplete results.
  Candidate/procedure service APIs currently return arrays; the migration
  view pages those derived lists locally.
- `memoryHubSources`: service-backed source pages across corpora, with
  query/type filters and scope-bound continuation tokens. Sources retain
  their corpus identity when opened or mutated from All memory. Counts
  exclude unavailable corpora and are accompanied by explicit errors.
- `memoryHubSearch`: source, saved/stale procedure and conversation retrieval
  with corpus/type/tag/date filters. Deterministic reciprocal-rank fusion
  merges ranked evidence without comparing unrelated raw scores. One optional
  model answer cites the merged evidence; unavailable synthesis retains
  evidence and reports its error. An honest no-answer is supported.
- `memoryHubEvidence`: exact retained source revision, procedure version or
  canonical conversation event/turn. Source previews are explicitly
  document-level when no original-text location resolver exists. Opaque
  `message:<ordinal>` locators are not original character offsets.
- `memoryHubExplore`: corpus-qualified source/entity/topic/procedure counts
  and bounded knowledge/provenance card previews, not a combined graph.
  Failed corpora are explicit; counts are
  not semantic entity deduplication across corpora. Conversation event graphs
  are unavailable in the current canonical corpus graph API.
- `memoryHubKnowledge`: full-scope entity, topic, relationship and contributing
  source browsing with server-side text filtering, name/mention sorting and
  bounded offset pages (maximum 100 items). Filtering precedes pagination.
  Browser-only requests resolve TypeAgent Browser Memory explicitly and reject
  a selected-corpus override; missing/ambiguous browser memory never becomes All
  memory. Source filtering uses retained source metadata, not just the preview.

- `memoryHubChanges`: service-owned committed replace/forget/suppress/restore
  receipts, retained for 90 days. These contain metadata and opaque hashed
  references, not source text, titles, URLs or navigation IDs. Forget purges
  older receipts for that source; clearing a corpus removes its history.
- `memoryHubCapturePages` and `memoryHubCapturePage`: explicit selection of an
  open page, followed by an object/document-bound browser snapshot. Capture
  does not select the active Hub tab or switch browser tabs. Chrome and
  Electron providers exclude private pages, reject stale documents and report
  omitted embedded frames. The gateway accepts a page handle and reviewed URL,
  never supplied HTML or an arbitrary navigation URL; the handler validates
  both against the snapshot before ingestion.

Explore has separate Overview, Entity graph, Topic graph and Reading analytics
views. Overview follows the selected corpus/All memory scope. The other three
views are explicitly fixed to TypeAgent Browser Memory. Entity and topic graphs
keep their separate Graphology endpoints (`getGlobalImportanceLayer` /
`getEntityNeighborhoodLayoutData` and `getTopicImportanceLayer`) and existing
Cytoscape visualizers, using server-computed preset positions. No entity/topic
node merging or client-generated ring layout is performed. Opening Overview
does not implicitly fetch browser analytics or graph layouts.
Graphology edges may omit IDs (Cytoscape assigns them); nodes still require IDs
and edges require valid endpoints. Graph zoom permits fitting the server's large
coordinate range into the embedded desktop and narrow Hub viewport.

Overview and Reading analytics share the same card browser: six preview cards
in a maximum-height section, then **View all**, filter/sort controls and
24-item pages. Preview grids are at most 20rem tall; browse grids are at most
30rem. Exact source links and entity/topic graph drilldown remain available.
Reading analytics keeps its browser-only scope and no longer displays the
Activity trends visits/bookmarks histogram. Its recent preview is not passed off
as the full collection. The view gateway bounds responses and DOM rendering;
the canonical memory API still reads the corpus graph as a whole on each
browse request, so this is not an indexed, streaming backend graph query.

Search dates mean source capture, procedure creation or conversation event
time, with unknown dates excluded when filtering. Document retrieval currently
considers at most 400 index candidates per corpus; date-filtered results explicitly warn
that eligible evidence can be omitted. Returned evidence counts are bounded
results, never full-corpus totals. Retrieval reads have 30-second deadlines;
procedure filtering shares a deadline rather than chaining unbounded reads.
Answer context is bounded to 20 excerpts of up to 800 characters and 32,000
characters overall, with a visible warning. Imported content is untrusted
evidence, not instructions.

The header query, scope and cached answer/results survive citation navigation
and Back within the Hub. Scope changes and explicit refresh invalidate
discovery caches. A missing named corpus remains unavailable: it never silently
expands to All memory.

Add reuses bookmark/history and agent-host HTML-folder import adapters with
their existing options, real progress and final results. Page capture and
those imports target **TypeAgent Browser Memory**, independently of the Hub
corpus selector; Markdown paste still requires a named corpus. Browser import
cancellation remains explicitly unavailable, and closing an import dialog
does not cancel its work. Capture cannot be cancelled once submitted.
The jobs link explicitly selects the fixed browser corpus. Adapter responses
do not contain individual import job IDs; the link is not presented as
import-specific.

Source correction, confirmation-token forget, knowledge suppress/restore,
job cancellation and version-checked procedure/settings edits call the
existing memory operations. Runbooks supports structured agent editions,
whole-version review, guarded catalog bindings, immutable skill drafts and
explicit updated-source synthesis jobs. Argument templates preserve declared
input references and require exact live host schema-fit proof; binding grants
no permission. Updated-source synthesis creates/reuses a draft job, never
overwrites the existing procedure or published skill.

MCP catalog references use the exact JSON tuple `[serverConfigId, nativeToolName]`.
Saved bindings keep the two native components separately; even a JSON-looking
tool name is opaque text, never an already encoded tuple. Native MCP identities
are nonempty, at most 4,096 characters, and cannot contain control characters.
Local step/input identifiers retain their stricter stable-identifier rules.

The visual pass checks all seven Hub pages at 390, 768, 1,024 and 1,440 pixels
using the built application, real local gateway and an isolated offline fixture.
Additional populated Search/analytics, graph details, Runbook editor, source
drawer and Add dialog states cover wrapping, 16-pixel native checkboxes,
header baselines and document overflow. Analytics source links belong to their
specific displayed rows, outside graph-navigation buttons. Search source types
retain native multiselect semantics inside an accessible disclosure; empty
Recent/result-view controls are hidden. Headless Chrome clicks and Add-dialog
Tab/Escape were exercised; native file choosers and release-wide accessibility
qualification remain separate gates.

Whole-corpus forget, retained-revision ingestion retry, dependent-skill forget
previews and PDF capture remain later capabilities. Original image inspection
is explicitly unreviewed, not a safe-pixel preview. Numeric model-quality and
live-vision acceptance are not implied by functional offline verification.

### Agent WebSocket Server

The browser agent exposes a WebSocket server (`AgentWebSocketServer`) on a
port assigned dynamically by the OS at bind time. The actual port is
published to the host's `PortRegistrar` under `(browser, default)` and
discovered by external clients via the discovery channel hosted at
`ws://localhost:8999/` (default). Both supported hosts publish this
channel: the standalone `agentServer` process and the standalone
Electron `shell` (which hosts an in-process discovery WS so the same
extension config works against either host). To pin the port for
debugging, set `BROWSER_WEBSOCKET_PORT=<n>` before launching the host.

Two types of clients connect to the browser agent:

- **Chrome extension** (`src/extension/serviceWorker/websocket.ts`) — connects from the browser's service worker using `chrome.runtime.id` as its client ID. Calls `discoverPort("browser", "default")` to look up the live port before connecting.
- **Inline browser** (`packages/shell/src/main/browserIpc.ts`) — connects from the Electron shell using `inlineBrowser` as its client ID.

#### Connection URL format

Every client embeds its identity in the WebSocket connection URL as query parameters:

```
ws://localhost:<port>?channel=browser&role=client&clientId=<id>&sessionId=<sessionId>
```

| Parameter   | Description                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `clientId`  | Unique identifier for this client (`inlineBrowser` for the shell, `chrome.runtime.id` for the extension) |
| `sessionId` | The TypeAgent session this client belongs to (see below)                                                 |

#### Session routing

`AgentWebSocketServer` is a **process-level singleton** shared across all TypeAgent sessions. To support multiple concurrent sessions without their traffic interfering with each other, each session registers its own handler set under a unique `sessionId` key:

- The shell and extension both use `sessionId = "default"` (single-session use case).
- Extension users running multiple independent TypeAgent sessions can configure a different `sessionId` in the extension settings (`sessionId` field, defaults to `"default"`).

When a browser agent session starts (`updateAgentContext(enable=true)`), it calls `agentWebSocketServer.registerSession(sessionId, handlers)` to bind its invoke handlers and connection callbacks. When the session closes, `unregisterSession(sessionId)` removes the handlers and closes any connected clients for that session.

The `sessionId` for each agent session is stored in `BrowserActionContext.sessionId`. It is set once at context initialization:

- `"default"` — when running with an inline browser control (Electron shell).
- A random UUID — when running without one (extension-only mode).

#### Client type detection

The server infers whether a connected client is an `extension` or `electron` client from its `clientId`: any client whose ID is `inlineBrowser` is treated as `electron`; all others are `extension`.

When both client types are connected for the same session, the active client is selected by `preferredClientType` (set to `"extension"` for extension-only sessions, `"electron"` for shell sessions). Browser control commands are routed only to the active client.

#### Channel multiplexing

Each client connection is multiplexed into two logical channels using `@typeagent/agent-rpc`:

- **`agentService`** — RPC from the client to invoke browser agent actions (e.g. `openWebPage`, `indexPage`). The RPC channel label is `agent:service:<sessionId>:<clientId>`.
- **`browserControl`** — RPC from the agent to control the browser (e.g. `clickOn`, `captureScreenshot`, `getHtmlFragments`). The RPC channel label is `browser:control:<sessionId>:<clientId>`.

Both channels share a single WebSocket connection per client. The `sessionId` prefix in each channel label keeps them unique across concurrent sessions.

#### Client storage model

Internally, the server stores connected clients in a nested `Map<sessionId, Map<clientId, BrowserClient>>`. This means the same `clientId` (e.g. `inlineBrowser`, or a shared extension ID) can exist simultaneously in multiple sessions without collision. Duplicate-connection detection and forced-disconnect logic are scoped to `(sessionId, clientId)` pairs, so a reconnect in one session never affects clients in other sessions.

## Internet lookup (`lookupAndAnswerInternet`)

The `browser.lookupAndAnswer.lookupAndAnswerInternet` action answers general
"look it up on the web" questions (stock prices, sports scores, news, etc.).
There are two ways to satisfy a query, selected by a single **global** setting
that the browser agent reads server-side in `lookup()`:

- **Browser** — drive a real browser (the shell's inline browser or a
  connected Chrome/Edge extension): run a search, read the results page text
  (`getPageTextContent()`), and synthesize an answer. Requires a connected
  browser.
- **Azure AI Search (Foundry IQ)** — call a knowledge base backed by a **web
  knowledge source**, which does the web search + fetch + LLM summarization
  server-side and returns a cited answer. Needs **no browser**, so it works in
  browser-less clients (vscode-shell, CLI, headless).

### Which path runs

The path is chosen by `azureAISearch.mode` (env `AZURE_AI_SEARCH_LOOKUP_MODE`):

| `mode`                  | Path                                               | Needs a browser? |
| ----------------------- | -------------------------------------------------- | ---------------- |
| `off` / unset (default) | Browser search → read page → generate answer       | Yes              |
| `api`                   | Azure AI Search REST `retrieve`                    | No               |
| `mcp`                   | Azure AI Search MCP `knowledge_base_retrieve` tool | No               |

The **code default is `off`** (browser); the shipped `config.sample.yaml` sets
`api` as the recommended value once you've provisioned a knowledge base.
`api`/`mcp` additionally require `azureAISearch.endpoint` and `knowledgeBase` —
if either is missing the agent falls back to the browser path. The switch is
**global** (one setting for the browser agent, shared by every client) and is
read at agent-server startup. Auth defaults to identity
(`DefaultAzureCredential`); see the `azureAISearch` section in
`config.sample.yaml`.

When the effective mode is the browser but **no browser is connected**, the
agent automatically falls back to the `api` path if Azure AI Search is
configured — so a browser-less client (e.g. vscode-shell without the extension)
still gets an answer.

```mermaid
flowchart TD
    A["lookupAndAnswerInternet"] --> B["browser agent lookup()"]
    B --> C{"mode = api or mcp?<br/>(and endpoint and knowledgeBase set)"}
    C -- "api" --> E["Azure AI Search REST retrieve"]
    C -- "mcp" --> F["Azure AI Search MCP<br/>knowledge_base_retrieve"]
    C -- "no (off / unset)" --> J{"browser connected?"}
    J -- "yes" --> D["Browser: search() → getPageTextContent()<br/>→ generateAnswer()"]
    J -- "no" --> K{"api configured?"}
    K -- "yes" --> E
    K -- "no" --> L["error: no browser available"]
    E --> G["Web knowledge source (Grounding with Bing)<br/>+ LLM summarization → cited answer"]
    F --> G
    D --> H["Answer"]
    G --> H
```

### Change the mode at runtime

`@browser lookup` switches the backend on the fly (no restart), overriding
`azureAISearch.mode` for the running agent-server:

- `@browser lookup status` — show the configured mode, any runtime override, and the effective path.
- `@browser lookup mode <off|api|mcp>` — set the backend (`off` = browser); the value tab-completes.

The override is in-memory only; it reverts to the configured `azureAISearch.mode`
when the agent-server restarts. Implemented in
`src/agent/lookup/lookupCommandHandlers.mts`.

To provision the Azure AI Search web knowledge source + knowledge base, run
`pnpm --filter browser-typeagent setup:aisearch` (see
`src/agent/lookup/aiSearchSetup.mts`). The runtime client is in
`src/agent/lookup/aiSearchLookup.mts`.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
