# Structured Agent Output — Top-Level Plan

Status: Draft. This document is the single source of truth for the
"agents supply structured output that clients render richly" effort.
Progress tracking lives in [STATUS.md](./STATUS.md).

## Motivation

Agents that produce list- or record-shaped results today **fetch
structured data and then throw the structure away**. The clearest
example is the `github-cli` agent: `prList` runs
`gh pr list --json number,title,state,url,createdAt,headRefName,isDraft`,
`JSON.parse`s the result, and then flattens it back into a single
markdown bullet string in `formatListResults()`:

```
- [#2644 Add benchmarks…](https://…) — DRAFT dev/georgeng/benchmark_contextselector
- [#2629 Fix NFA compilation…](https://…) — OPEN  dev/georgeng/fix_nfa_with_subrules
```

In a narrow chat column this renders as a cramped, hard-to-scan list:
the status (`DRAFT`/`OPEN`) is inline plain text and the branch name
wraps into the title. The agent *had* clean typed fields (number,
title, state, url, branch, isDraft, createdAt) and discarded all of
them.

The structure is lost for **every** downstream consumer, not just the
UI:

- **Rich UIs** (Electron shell, VS Code) could render a real table with
  a clickable id column and a colored status badge — but only receive a
  markdown string.
- **Programmatic consumers** ("or otherwise" clients — MCP / Claude
  Code, the copilot plugin, the `taskflow` script API) have to
  *re-parse* the flattened text. `taskFlowScriptApi.mts` already does
  exactly this: `extractText(result)` followed by `tryParseJson(text)`.

This effort gives agents a first-class way to emit **structured output**
— a typed, semantic representation of the result — that each client
renders (or consumes) at the highest fidelity it supports, while
unknowing clients fall back automatically.

## TL;DR

Add a first-class **structured content** type to the agent SDK: an
ordered **document of typed blocks** (heading, text/markdown, **table**,
list, card, key-value, **image**, code, divider) plus an optional
machine-readable **`rawData`** payload. It is added to the existing
`DisplayContent` union so it rides the current display plumbing with no
new transport. Rich clients (`chat-ui`, shared by the Electron shell +
VS Code webview + Chrome extension; and the VS Code chat participant)
render blocks natively; every other client falls back to an
SDK-derived markdown/text representation. Tables are **interactive by
default** (client may sort/filter unless the agent marks them
`readonly`). `github-cli`'s PR/issue lists are the first adopter.

This is deliberately **A + C together**:

- **A — semantic view-model**: typed presentation blocks a generic
  renderer can turn into rich UI for *all* agents.
- **C — hybrid**: the view-model travels alongside optional raw data, so
  programmatic clients get typed objects and UIs get rich rendering,
  with the existing `displayContent` text as the universal fallback.

## Goals

- One structured representation, authored once by an agent, consumed by
  many clients at different fidelities (rich table → markdown table →
  plain text).
- Fix the `github-cli` list rendering as the first concrete adopter.
- Make **media a first-class block**, not smuggled `<img>` HTML.
- Let a single result **bundle** a table + prose + media in one payload
  (one history entry, one memory row, one MCP payload).
- Carry **machine-readable `rawData`** so non-UI clients stop
  re-parsing flattened text.
- Let the agent declare **interactivity affordances** (sortable /
  filterable / readonly) on the structure itself.
- No new transport: reuse the existing `DisplayContent` /
  `appendDisplay` / `DisplayLog` / replay / RPC path.

## Non-goals (v1)

- Charts / graphs / arbitrary custom widgets — continue to use the
  existing `iframe` display type as an escape hatch.
- Row-click-triggers-action interactivity (selecting a PR row to merge
  it). The type model reserves fields for it (`cell.href`, a future
  `block.action`) but no client wires it up in v1.
- Rich tables in the CLI — the CLI gets the text fallback.
- JSON Schema *validation* of `rawData` (the field is carried, not
  enforced).
- Migrating other list-shaped agents (`list`, `calendar`, `email`,
  `search`). They can adopt the same primitives later; `github-cli` is
  the reference adopter.

## Background — how display works today

- **`DisplayContent`** (`packages/agentSdk/src/display.ts`) is
  `MessageContent | TypedDisplayContent`, where
  `MessageContent = string | string[] | string[][]`. Note `string[][]`
  is already a rudimentary **table**.
- **`TypedDisplayContent`** carries `type: "markdown" | "html" | "iframe"
  | "text"`, an optional `kind`, `speak`, and **`alternates`** — a list
  of alternate representations of the *same* content that clients pick
  from via `getContentForType()`
  (`packages/agentSdk/src/helpers/displayHelpers.ts`). This is the seed
  of the "each client picks the best format" idea we generalize.
- **`ActionResultSuccess.displayContent`** (`packages/agentSdk/src/action.ts`)
  is exactly **one** `DisplayContent`. `entities` / `resultEntity` exist
  but are for memory / follow-up resolution, **not** display.
- **Renderers**:
  - `packages/chat-ui/src/setContent.ts` — the shared rich HTML renderer
    for the **Electron shell**, the **vscode-shell webview**, and the
    **Chrome extension** (all import `chat-ui`). Already renders
    `string[][]` as `<table class="table-message">`. Its `processContent`
    `switch` **throws on an unknown `type`** — important for the safety
    net below.
  - `packages/vscode-chat/src/displayRender.ts` — the **VS Code chat
    participant** (the Copilot chat stream). Markdown / text only; has
    `tableToMarkdown` / `tableToHtml`. Cannot be interactive.
  - `packages/cli/src/enhancedConsole.ts` — CLI/terminal.
  - `packages/commandExecutor/src/commandServer.ts` — the MCP server for
    Claude Code. Flattens content to plain text; does **not** use MCP
    `structuredContent` / `outputSchema` today (greenfield).
  - `packages/copilot-plugin/src/shared/message-formatter.ts` — HTML →
    plain text.
- **Transport / persistence**: agents call
  `actionIO.appendDisplay(content, mode)` /`setDisplay(content)`; the
  dispatcher's `emitActionResult()`
  (`packages/dispatcher/dispatcher/src/execute/actionHandlers.ts`)
  forwards `result.displayContent`. Each call becomes a **separate**
  `DisplayLog` entry (`packages/dispatcher/dispatcher/src/displayLog.ts`)
  → separate `IAgentMessage` → separate history/replay record. The RPC
  layer (`packages/agentRpc/src/types.ts`) carries `DisplayContent` as
  JSON. Because everything is JSON, a new `DisplayContent` variant
  persists and replays for free.

### Why not just N `appendDisplay` calls?

An agent can already *visually* stack a table then an image by making
two `appendDisplay(..., "block")` calls (the `chat` agent does this).
But those are **N independent records** — N history entries, N memory
rows, no single machine-readable payload, and ordering across async
appends can race. Bundling heterogeneous typed blocks into **one**
`displayContent` is a primary reason to model structured output as a
*document of blocks*. `appendDisplay` remains for the genuinely
streaming case (transient status → then the bundled result).

## Design

### The block-document model

Structured content is an ordered array of typed **blocks**. A result
that is "just a table" is a one-block document; a result that mixes a
heading, a table, a note, and a thumbnail is a four-block document.

```typescript
// packages/agentSdk/src/display.ts (additions)

export type BadgeTone =
    | "neutral" | "info" | "success" | "warning" | "error";

export type TableCellType =
    | "text" | "link" | "badge" | "number" | "date" | "code";

export interface TableColumn {
    id: string;
    header: string;
    type?: TableCellType;            // default "text"
    align?: "left" | "right" | "center";
    sortable?: boolean;              // per-column override of table.sortable
}

export type TableCell =
    | string
    | number
    | {
          text: string;
          href?: string;             // link target (type "link", or any cell)
          badge?: BadgeTone;         // badge tone (type "badge")
          tooltip?: string;
      };

export interface TableBlock {
    kind: "table";
    columns: TableColumn[];
    rows: TableCell[][];
    caption?: string;
    // Affordances — interactive by default.
    sortable?: boolean;              // default: true
    filterable?: boolean;            // default: false
    readonly?: boolean;              // lock order + content exactly as sent
}

export interface HeadingBlock { kind: "heading"; text: string; level?: 1 | 2 | 3; }
export interface TextBlock { kind: "text"; text: MessageContent; format?: "text" | "markdown"; }
export interface ListItem { text: string; href?: string; subtitle?: string; badges?: BadgeTone[]; }
export interface ListBlock { kind: "list"; ordered?: boolean; items: ListItem[]; }
export interface KeyValuePair { label: string; value: TableCell; }
export interface KeyValueBlock { kind: "keyValue"; pairs: KeyValuePair[]; }
export interface CardBlock { kind: "card"; title?: string; subtitle?: string; fields?: KeyValuePair[]; href?: string; }
export interface ImageBlock { kind: "image"; src: string; alt?: string; caption?: string; width?: number; height?: number; }
export interface CodeBlock { kind: "code"; code: string; language?: string; }
export interface DividerBlock { kind: "divider"; }

export type StructuredBlock =
    | HeadingBlock | TextBlock | TableBlock | ListBlock
    | KeyValueBlock | CardBlock | ImageBlock | CodeBlock | DividerBlock;

export interface StructuredContent {
    type: "structured";
    blocks: StructuredBlock[];
    rawData?: unknown;               // machine-readable payload (C)
    dataSchema?: unknown;            // optional JSON Schema for rawData
    kind?: DisplayMessageKind;
    speak?: boolean;
    // SDK auto-derives a markdown/text alternate so unknowing clients degrade.
    alternates?: Array<{ type: DisplayType; content: MessageContent }>;
}

export type DisplayContent =
    | MessageContent
    | TypedDisplayContent
    | StructuredContent;             // <- new
```

### Affordances — interactive by default

Tables are `sortable` by default; a client that can sort *may* offer it.
The agent opts **out** with `readonly: true` when order or content is
semantically meaningful (e.g. a ranked "top 5"), or refines with
per-column `sortable`. `readonly` is a hard instruction: the client
must preserve rows exactly as sent. (We rejected `readonly`-by-default
as too restrictive.) Interactivity is a client capability — the VS Code
chat participant renders a static table regardless, which is exactly why
affordances are **declarative hints** the client honors when able.

### Machine-readable `rawData`

`rawData` carries the agent's real domain objects (for `github-cli`, the
`JSON.parse(output)` array it already has). `dataSchema` optionally
describes it. This is the "or otherwise" channel: MCP forwards it as
`structuredContent`; `taskflow` can read it directly.

**Source-of-truth guidance**: provide a `fromRecords(objects,
columnSpec)` SDK helper that builds a `TableBlock` *and* stashes the
objects as `rawData` in one call, so an adopter can't let the table and
the data drift.

### Fallback derivation

The SDK derives a markdown (and plain-text) representation from `blocks`
and attaches it as an `alternate`. Any client that doesn't understand
`type: "structured"` calls the existing `getContentForType(content,
"markdown" | "text")` and renders the derived string. `historyText`
(memory) and TTS use the same derivation.

### Plumbing decision — extend `DisplayContent`

Add `StructuredContent` to the `DisplayContent` union rather than adding
a sibling field to `ActionResult`. Rationale: it rides
`emitActionResult` → `actionIO.appendDisplay(displayContent, "block")`
→ `DisplayLog` → RPC → replay with **zero** new transport, mirroring how
`alternates` already work. The cost is that renderers currently `switch`
on `type` and throw on unknown — so a one-time safety pass (Phase 2)
must teach every renderer to recognize `"structured"` and fall back
before rich rendering lands.

## Client topology

| Renderer | Clients it powers | v1 role |
| --- | --- | --- |
| `chat-ui` `setContent.ts` | Electron shell, vscode-shell webview, Chrome extension | Rich block rendering + interactivity |
| `vscode-chat` `displayRender.ts` | VS Code Copilot chat participant | Static markdown blocks (tables, images, cards) |
| `cli` `enhancedConsole.ts` | CLI / interactiveApp | Text fallback |
| `commandExecutor` `commandServer.ts` | MCP / Claude Code | Text fallback (+ `rawData` → `structuredContent`, Phase 6) |
| `copilot-plugin` `message-formatter.ts` | Copilot plugin | Text fallback |

Implementing rich rendering in `chat-ui` covers three clients at once.

## Phased plan

### Phase 1 — SDK foundation *(blocks everything)*

- Add the types above to `packages/agentSdk/src/display.ts`.
- Add builder helpers + fallback derivation in
  `packages/agentSdk/src/helpers/displayHelpers.ts` and
  `helpers/actionHelpers.ts`: `createStructuredResult(blocks, { rawData })`,
  `createTable(...)`, `fromRecords(objects, columnSpec)`,
  `structuredToMarkdown(blocks)` / `structuredToText(blocks)`,
  `getStructuredFallback(content)`.
- Export new types/helpers from `packages/agentSdk/src/index.ts`.
- Unit tests for derivation (blocks → markdown/text) and builders.

### Phase 2 — Renderer safety net *(after 1; parallel per client)*

Teach each renderer to detect `type: "structured"` and render the
derived fallback (no throw, no regression):
`packages/chat-ui/src/setContent.ts`,
`packages/vscode-chat/src/displayRender.ts`,
`packages/cli/src/enhancedConsole.ts`,
`packages/commandExecutor/src/commandServer.ts`,
`packages/copilot-plugin/src/shared/message-formatter.ts`.

### Phase 3 — Rich rendering *(after 1; 3a/3b parallel)*

- **3a** `packages/chat-ui/src/setContent.ts`: render blocks → HTML
  (typed table with link/badge/date cells, image block, card / list /
  keyValue). Styles in `packages/chat-ui/styles/chat.css`, extending the
  existing `.table-message` and adding badge / cell / image classes.
  Covers shell + vscode-shell webview + extension.
- **3b** `packages/vscode-chat/src/displayRender.ts`: render blocks →
  markdown (reuse `tableToMarkdown`, markdown images, card sections).
  Static.

### Phase 4 — Interactivity *(after 3a)*

Client-side sort / filter on `TableBlock` in `chat-ui`, honoring
`readonly` / `sortable` / `filterable`. chat-ui clients only.

### Phase 5 — First adopter: `github-cli` *(after 1; visually validated by 3)*

Rewrite `formatListResults` and the list/view actions in
`packages/agents/github-cli/src/github-cliActionHandler.ts` — `prList`,
`issueList`, `myPullRequests`, `searchRepos`, `dependabotAlerts`,
contributors, and `repoView` (→ keyValue) — to emit `StructuredContent`
+ `rawData` via `fromRecords`. The SDK-derived markdown fallback must
match or beat today's output. Update the handler unit tests.

Example — the `prList` table: an `#id` **link** column → `url`, a
**text** title column, a **badge** state column (`DRAFT`/`OPEN` colored
by tone), a **code** branch column; `sortable: true`.

**Status: complete.** All display-producing paths now emit
`StructuredContent`:

- List actions (`prList`, `issueList`, `myAssignedIssues`, `searchRepos`)
  → `buildStructuredListResult` (heading + interactive table).
- `repoView` → `buildStructuredRepoView` (heading + `keyValue`).
- Dependabot alerts → `buildStructuredDependabotResult` (badge severity
  table).
- Contributors → `buildStructuredContributorsResult` (ranked table).
- Single `prView` / `issueView` → `buildStructuredPrView` /
  `buildStructuredIssueView` (heading + `keyValue` metadata + optional
  body text block).
- Focused field answers (stars / forks / language / watchers /
  description) → `buildStructuredField` (heading + single `keyValue`
  pair + natural-language summary; `rawData` carries `{ repo, field,
  value }`).

Remaining markdown/text paths are intentional: mutation/create success
messages, `statusPrint`, and the raw-output fallback carry no structured
data. `githubCliStructuredResults.spec.ts` covers all builders.

### Phase 6 — Programmatic "or otherwise" *(after 1 + 5)*

- `packages/commandExecutor/src/commandServer.ts` forwards `rawData` as
  MCP `structuredContent` (and optionally `outputSchema` from
  `dataSchema`).
- Optionally update `packages/agents/taskflow/src/script/taskFlowScriptApi.mts`
  to read `rawData` directly, dropping the `extractText` + `tryParseJson`
  workaround.

### Phase 7 — Broader agent rollout *(after 5; per-agent, parallelizable)*

`github-cli` is the reference adopter, but every list-, table-, or
record-shaped agent result throws away structure today. Convert the rest
in the order below. The order is driven by (a) how naturally the output
maps to blocks, (b) user-facing value, and (c) conversion cost. Each
agent follows the `github-cli` template: emit `StructuredContent` via
`createStructuredContent` / `createTable` / `fromRecords` with `rawData`,
keep the derived markdown/text fallback at parity, and update the
handler's unit tests.

Agents already committed to custom HTML/iframe or a WebSocket/RPC bridge
(`image`, `video`, `settings`, `chat`, `code`, `visualStudio`,
`browser`, `markdown`, `montage`, `turtle`, `player`, `playerLocal`) are
**out of scope** for v1 — they render their own UI and don't flow through
the block-document fallback path. Short status/confirmation agents
(`timer`, `windowsClock`, `greeting`, `desktop`, `vampire`,
`androidMobile`, `powershell`, `utility`, `studio`) are **low value** and
deferred until a clear need appears.

**Wave A — high fit (clear list/table/record output):**

| # | Agent | Shape today | Target blocks |
| --- | --- | --- | --- |
| 1 | `list` | markdown bullet lists | `heading` + `list` |
| 2 | `calendar` | HTML event views (`appendDisplay`) | `heading` + `table` (agenda) + `card`/`keyValue` (event detail) |
| 3 | `email` | HTML message lists + threads | `heading` + `table` (inbox/list) + `keyValue` (message detail) |
| 4 | `weather` | text forecast | `keyValue` (current) + `table` (multi-day forecast) |
| 5 | `ipconfig` | markdown key/values | `heading` + `keyValue` (per-adapter sections) |

**Wave B — medium fit (structured data mixed with text):**

| # | Agent | Shape today | Target blocks |
| --- | --- | --- | --- |
| 6 | `discord` | text channel/message lists | `heading` + `list`/`table` |
| 7 | `taskflow` | text task listings | `table` (name / description / usage) |
| 8 | `onboarding` | markdown wizard status | `heading` + `keyValue` (phase status) |
| 9 | `screencapture` | image + markdown metadata | `image` + `heading`/`keyValue` |
| 10 | `osNotifications` | streamed notification log | `list`/`card` (event stream) |

**Out of scope (v1):** `image`, `video`, `settings`, `chat`, `code`,
`visualStudio`, `browser`, `markdown`, `montage`, `turtle`, `player`,
`playerLocal` (custom UI / RPC bridge).

**Deferred (low value):** `timer`, `windowsClock`, `greeting`,
`desktop`, `vampire`, `androidMobile`, `powershell`, `utility`, `studio`
(short text/status confirmations).

## Verification

- `pnpm --filter agent-sdk test` + `pnpm run build agent-sdk` —
  derivation + builder unit tests.
- `pnpm run build chat-ui` + chat-ui renderer tests; shell Playwright
  (`packages/shell/test`) asserts a real `<table>` renders from a
  structured result.
- `vscode-chat` `displayRender` tests for table / image / card markdown.
- `pnpm --filter github-cli test`; **manual**: run
  `gh pr list --state open` in the Electron shell and in VS Code and
  confirm a clean typed table.
- Pipe a structured result through the CLI / MCP and confirm a readable
  text table (fallback path).

## Decisions (locked)

- **Shape**: A + C in one go — semantic view-model **and** raw data,
  with derived text as the universal fallback.
- **Model**: composite **block document** so one result can bundle a
  table + prose + media atomically.
- **Affordances**: interactive by default; `readonly` is opt-in.
- **Media**: first-class `image` block (URL or dataURI).
- **Plumbing**: extend the `DisplayContent` union — no new `ActionResult`
  field, no new transport.
- **Priority clients**: Electron shell + VS Code (both the webview and
  the chat participant). CLI / MCP / copilot get the fallback in v1.

## Further considerations / open questions

1. **`rawData` source-of-truth** — resolved in favor of a `fromRecords`
   helper that emits the table and stashes `rawData` together, but agents
   may still author blocks and `rawData` separately when needed.
2. **Image source policy** — URL or dataURI; the agent is responsible for
   rehydrating file paths (as the `chat` agent does today). DOMPurify in
   `setContent.ts` already permits `img` + data URIs.
3. **Forward-compat for interactivity** — include `cell.href` and reserve
   a `block.action` field now so v2 row-actions don't require a schema
   break.
4. **Naming** — `StructuredContent` / `type: "structured"` vs
   `RichContent` / `"rich"`. Current lean: `structured`.

## Key files

| Area | Path |
| --- | --- |
| SDK display types | `packages/agentSdk/src/display.ts` |
| SDK action result | `packages/agentSdk/src/action.ts` |
| SDK display helpers | `packages/agentSdk/src/helpers/displayHelpers.ts` |
| SDK action helpers | `packages/agentSdk/src/helpers/actionHelpers.ts` |
| SDK exports | `packages/agentSdk/src/index.ts` |
| Rich renderer (shell/webview/ext) | `packages/chat-ui/src/setContent.ts` |
| Rich renderer styles | `packages/chat-ui/styles/chat.css` |
| VS Code chat participant renderer | `packages/vscode-chat/src/displayRender.ts` |
| CLI renderer | `packages/cli/src/enhancedConsole.ts` |
| MCP server | `packages/commandExecutor/src/commandServer.ts` |
| Copilot formatter | `packages/copilot-plugin/src/shared/message-formatter.ts` |
| Dispatcher emit | `packages/dispatcher/dispatcher/src/execute/actionHandlers.ts` |
| Display log | `packages/dispatcher/dispatcher/src/displayLog.ts` |
| RPC transport | `packages/agentRpc/src/types.ts` |
| First adopter | `packages/agents/github-cli/src/github-cliActionHandler.ts` |
| Taskflow consumer | `packages/agents/taskflow/src/script/taskFlowScriptApi.mts` |
