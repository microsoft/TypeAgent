# 04 - Shared UI (`grammar-tools-ui`)

Status: **Design** - component specs below, UI tech pending ADR 0001.
Owner: TBD.
Depends on: ADR [0001 - shared UI tech](./decisions/0001-shared-ui-tech.md).
Blocks: 03 (debug panel), 05 (web app), 06 (shell panel).

Maps to PLAN: [Track D](./PLAN.md#track-d---shared-ui-parallel-after-adr-0001).
D.0 (scaffold + fixture backend) is a force multiplier - it lets D.1–D.5
proceed in parallel with Track A / B core work.

> Directory: `packages/grammarTools/ui`. Package name: `grammar-tools-ui`.

## TL;DR

Shared widget bundle (debug panel, completion preview, rule-trace table,
coverage view, diff view) hosted in any of: VS Code webview, Vite SPA,
shell BrowserWindow. Talks to `grammar-tools-core` through a
`GrammarBackend` abstraction so it does not care whether the backend is
in-process or behind RPC. A fixture backend lives alongside the
components so they can be developed and tested before real core lands.

## Scope

- **D.0** Scaffold the package with chosen UI tech and a fixture
  `GrammarBackend` exposing canned responses for every core service.
- Components (each independently shippable):
  - **D.1** `<completion-preview>` - input box, live results, highlight
    `matchedPrefixLength`.
  - **D.2** `<rule-trace>` - step list / table, slot env per step.
  - **D.3** `<grammar-picker>` - source selection (file / agent / live).
  - **D.4** `<coverage-view>` - per-rule heat list, drill into
    unmatched inputs. _Real data needs B.3._
  - **D.5** `<diff-view>` - side-by-side rule diff. _Real data needs
    B.4._
- A `<grammar-debug-panel>` host component composes D.1–D.3 (and
  optionally D.4 / D.5) into the standard debug layout.
- Build: Vite library mode producing an ESM bundle the hosts can load.
- `interface GrammarBackend` mirrors `grammar-tools-core` services 1:1.
  Hosts inject an implementation. Formal contract:
  [ADR 0005](./decisions/0005-shared-service-contract.md). The
  `traceMatch` return shape (one-shot vs streamed events) is an open
  sub-decision in ADR 0005 owned by Track D + B.2; pin it once the
  debug-panel UX is defined.

## Non-scope

- Editor surface (Monaco lives in chunk 05's web app; the VS Code
  extension uses VS Code's own editor).

## Resolved questions

- **UI tech: Lit.** See [ADR 0001](./decisions/0001-shared-ui-tech.md)
  (Accepted 2026-05-05). Components are custom elements using
  `@customElement()`, reactive properties via `@property()`, and
  `html` tagged templates.
- **Theming:** CSS custom properties following VS Code's `--vscode-*`
  convention. A `theme-defaults.css` fallback ships for browser/shell
  hosts. See [Theming strategy](#theming-strategy) below.
- **Bundle:** Single ESM bundle via Vite library mode, used by all
  three hosts. No per-host entrypoints needed (custom elements
  register once and work everywhere).

---

## Component designs

All components communicate with `grammar-tools-core` exclusively
through the `GrammarBackend` interface (ADR 0005). Components never
import `actionGrammar` directly. Data types referenced below
(`CompletionPreview`, `TraceEvent`, etc.) are the JSON-serializable
wire types defined in `grammar-tools-core` (chunk 01) and re-exported
by the UI package as props/attribute types.

### D.1 `<completion-preview>`

**Purpose.** Let the user type partial input and see, live, what the
grammar can complete it to. This is the primary "does my grammar work?"
tool.

**Layout.**

```
┌─────────────────────────────────────────────────┐
│ Input: [play songs by the beat_______________]  │  <- text input
│ Matched: 14 chars  |  Wildcard: none            │  <- status bar
├─────────────────────────────────────────────────┤
│  Group 1 (space)                                │  <- separator mode label
│    ▸ les                                        │
│    ▸ beatles                                    │  <- completion items
│    ▸ beach boys                                 │
│  Group 2 (optionalSpace)                        │
│    ▸ ,                                          │
│    ▸ ;                                          │
├─────────────────────────────────────────────────┤
│ Properties: artist (string)                     │  <- optional property bar
└─────────────────────────────────────────────────┘
```

**Props / attributes.**

| Name           | Type             | Required | Description                  |
| -------------- | ---------------- | -------- | ---------------------------- |
| `backend`      | `GrammarBackend` | yes      | Injected service handle      |
| `grammar`      | `LoadedGrammar`  | yes      | Currently loaded grammar     |
| `initialInput` | `string`         | no       | Pre-fill the input box       |
| `debounceMs`   | `number`         | no       | Input debounce (default 150) |

**Interactions.**

- On each keystroke (debounced), call
  `backend.previewCompletion(grammar, input)`.
- Display `matchedPrefixLength` in the status bar and visually
  underline/highlight the consumed portion of the input text.
- Group completions by `separatorMode`. Each group has a header
  showing its mode. Within a group, items are listed vertically.
- If `afterWildcard` is `"some"` or `"all"`, show a
  warning icon/badge on the status bar ("results may be ambiguous").
- If `directionSensitive` is true, show a toggle or note.
- Clicking a completion item appends it to the input (inserting the
  separator implied by the group's `separatorMode`) and re-queries.
- If `properties` is non-empty, show a property bar below completions
  listing matched property names.
- Empty state: "Type to see completions" when input is empty; "No
  completions" when the query returns an empty `groups` array.
- Error state: if `previewCompletion` rejects, show inline error
  text (not a modal).

**Keyboard.**

- Up/Down arrows navigate completion items.
- Enter on a selected item appends it (same as click).
- Escape clears selection without clearing input.

**Data flow.**

```
keystroke -> debounce -> backend.previewCompletion(grammar, input)
  -> CompletionPreview { groups, matchedPrefixLength, afterWildcard, ... }
  -> render groups + status
```

**Complexity: medium.** Live async updates, grouped list rendering,
input highlight logic.

---

### D.2 `<rule-trace>`

**Purpose.** Show the step-by-step match trace for a given input
against the grammar: which rules were entered, which parts attempted,
where it matched or failed, where it backtracked. This is the "why
didn't this match?" debugger.

**Layout.**

```
┌─────────────────────────────────────────────────────────────────┐
│ Input: [play songs by the beatles]     [Trace]                  │
├──────┬────────────┬──────────┬──────┬───────────────────────────┤
│ Seq  │ Event      │ Rule     │ Pos  │ Detail                    │
├──────┼────────────┼──────────┼──────┼───────────────────────────┤
│ 1    │ ▶ entered  │ Start    │ 0    │ depth 0                   │
│ 2    │ ◆ attempt  │ Start    │ 0    │ part[0] string "play"     │
│ 3    │ ✓ matched  │ Start    │ 4    │ -> 4 chars                │
│ 4    │ ◆ attempt  │ Start    │ 5    │ part[1] string "songs"    │
│ 5    │ ✓ matched  │ Start    │ 10   │ -> 5 chars                │
│ 6    │ ◆ attempt  │ Start    │ 11   │ part[2] rules <ArtistRef> │
│ 7    │ ▶ entered  │ ArtistRf │ 11   │ depth 1                   │
│ 8    │ ◆ attempt  │ ArtistRf │ 11   │ part[0] string "by"       │
│ 9    │ ✓ matched  │ ArtistRf │ 13   │ -> 2 chars                │
│ 10   │ ◆ attempt  │ ArtistRf │ 14   │ part[1] wildcard artist   │
│ 11   │ ✓ matched  │ ArtistRf │ 25   │ -> 11 chars               │
│  ... │            │          │      │  slots: {artist:"the..."}  │
│ 12   │ ◀ exited   │ ArtistRf │ 25   │ result: matched           │
│ 13   │ ◀ exited   │ Start    │ 25   │ result: matched           │
└──────┴────────────┴──────────┴──────┴───────────────────────────┘
```

**Props / attributes.**

| Name            | Type                            | Required | Description                                   |
| --------------- | ------------------------------- | -------- | --------------------------------------------- |
| `backend`       | `GrammarBackend`                | yes      | Injected service handle                       |
| `grammar`       | `LoadedGrammar`                 | yes      | Currently loaded grammar                      |
| `initialInput`  | `string`                        | no       | Pre-fill and auto-trace                       |
| `onSourceClick` | `(loc: SourceLocation) => void` | no       | Callback when user clicks a source-linked row |

**Interactions.**

- User types input and clicks "Trace" (or presses Enter).
- Calls `backend.traceMatch(grammar, input)`, which returns
  `TraceEvent[]` (one-shot array; streaming deferred per ADR 0005
  sub-decision).
- Renders events as a table. Each row is color-coded by event kind:
  - `ruleEntered` (blue ▶), `ruleExited` (blue ◀),
  - `partAttempted` (gray ◆), `partMatched` (green ✓),
  - `partFailed` (red ✗), `backtrack` (orange ↩).
- **Indentation by depth.** The Rule column indents by `depth` to
  show nesting visually (2 spaces per level).
- **Input highlighting.** As the user hovers a row, highlight the
  character range `[inputPos, endPos)` in the input display above
  the table. For `partMatched` events, `endPos` is the matched end;
  for others, show a cursor at `inputPos`.
- **Slot environment.** `partMatched` events with `slots` show an
  expandable sub-row listing `{ variable: value }` pairs.
- **Source linking.** If `grammar.debugInfo` is present, each rule
  name is a clickable link. Clicking fires `onSourceClick` with the
  `SourceLocation` for that rule. Hosts wire this to editor
  navigation (VS Code: `vscode.openTextDocument`; web app: Monaco
  `revealLine`).
- **Filtering.** Toggle buttons above the table to show/hide event
  kinds (e.g. hide all `partAttempted` to see only outcomes). Default:
  all visible.
- **Summary bar.** Below the table: "13 events, 2 rules entered,
  1 backtrack, result: matched" (or "result: no match").
- Empty state: "Enter input and click Trace".
- Error state: inline error text if `traceMatch` rejects.

**Keyboard.**

- Up/Down navigate rows.
- Enter toggles slot expansion on the selected row.
- Left/Right collapse/expand indented sub-trees (future enhancement;
  v1 is flat).

**Data flow.**

```
"Trace" click -> backend.traceMatch(grammar, input)
  -> TraceEvent[]
  -> render table rows + summary
hover row -> highlight input[inputPos..endPos]
click rule name -> onSourceClick(debugInfo.ruleLocations[ruleId])
```

**Complexity: medium-high.** Table with many columns, hover-driven
input highlighting, expandable rows, optional filtering.

---

### D.3 `<grammar-picker>`

**Purpose.** Let the user select which grammar to load: from a file
path, from an agent name, or from a live dispatcher snapshot.

**Layout.**

```
┌──────────────────────────────────────────┐
│ Source: (•) File  ( ) Agent  ( ) Live    │  <- radio group
├──────────────────────────────────────────┤
│ File mode:                               │
│   Path: [/path/to/grammar.agr___] [📂]  │  <- text input + browse
│                                  [Load]  │
├──────────────────────────────────────────┤
│ Agent mode:                              │
│   Agent: [ player        ▾ ]    [Load]   │  <- dropdown
├──────────────────────────────────────────┤
│ Live mode:                               │
│   Session: current              [Load]   │  <- auto-select
│   (requires running dispatcher)          │
└──────────────────────────────────────────┘
```

Only one mode panel is visible at a time (based on radio selection).

**Props / attributes.**

| Name            | Type                           | Required | Description                                  |
| --------------- | ------------------------------ | -------- | -------------------------------------------- |
| `backend`       | `GrammarBackend`               | yes      | Injected service handle                      |
| `agents`        | `string[]`                     | no       | Available agent names for dropdown           |
| `liveAvailable` | `boolean`                      | no       | Whether live mode is enabled (default false) |
| `onLoad`        | `(result: LoadResult) => void` | yes      | Fires with the load result                   |
| `onError`       | `(error: Error) => void`       | no       | Fires on load failure                        |

**Interactions.**

- **File mode:** text input for path. Browse button fires a
  host-provided file picker (the component emits a `browse` event;
  the host decides how to open a picker and sets the path back).
  Load calls `backend.loadGrammarFromFile(path)`.
- **Agent mode:** dropdown populated from `agents` prop. Load calls
  `backend.loadGrammarFromAgent(name)`.
- **Live mode:** disabled if `liveAvailable` is false. Load calls
  `backend.loadGrammarFromSnapshot(...)` (snapshot obtained by the
  host via dispatcher RPC).
- On successful load, fires `onLoad` with the `LoadResult`. The
  parent component stores the `LoadedGrammar` and passes it to
  D.1/D.2/D.4/D.5.
- On failed load (parse errors), fires `onLoad` with `{ ok: false }`.
  The parent can display diagnostics.
- Loading state: disable Load button, show spinner.

**Complexity: low.** Radio group, conditional panels, dropdown, text
input.

---

### D.4 `<coverage-view>`

**Purpose.** Show which rules and parts were exercised by a corpus of
inputs, and which were missed. Helps answer "does my test set cover my
grammar?"

**Layout.**

```
┌──────────────────────────────────────────────────────────────┐
│ Coverage: 8/12 rules (67%)  |  22/30 parts (73%)            │  <- summary
│ Corpus: 45 inputs  |  3 unmatched                           │
├─────────┬───────────────────────────┬───────┬────────────────┤
│ Hits    │ Rule                      │ Parts │ Location       │
├─────────┼───────────────────────────┼───────┼────────────────┤
│ ██ 12   │ Start                     │ 3/3   │ player.agr:1   │
│ ██  8   │ PlayAction                │ 4/5   │ player.agr:4   │
│ █   3   │ ArtistRef                 │ 2/2   │ player.agr:12  │
│ █   1   │ AlbumRef                  │ 2/3   │ player.agr:18  │
│ ░   0   │ ShuffleAction             │ 0/2   │ player.agr:25  │  <- red/dim
│ ░   0   │ QueueAction               │ 0/4   │ player.agr:30  │  <- red/dim
│ ░   0   │ SkipAction                │ 0/1   │ player.agr:38  │
│ ░   0   │ PauseAction               │ 0/1   │ player.agr:41  │
├─────────┴───────────────────────────┴───────┴────────────────┤
│ Unmatched inputs:                                            │
│   "play something random"       reason: no rule matched      │
│   "shuffle all songs by mood"   reason: no rule matched      │
│   "queue next"                  reason: partial match at 5   │
└──────────────────────────────────────────────────────────────┘
```

**Props / attributes.**

| Name            | Type                             | Required | Description                                |
| --------------- | -------------------------------- | -------- | ------------------------------------------ |
| `report`        | `CoverageReport`                 | yes      | Result from `backend.runCoverage`          |
| `onSourceClick` | `(loc: SourceLocation) => void`  | no       | Navigate to source                         |
| `sortBy`        | `"hits" \| "name" \| "location"` | no       | Initial sort (default `"hits"` descending) |

Note: the component does not call the backend directly. The parent
runs `backend.runCoverage(grammar, corpus)` and passes the result.
This keeps the corpus-input UI (file picker, paste area) out of
this component.

**Interactions.**

- **Summary bar** at top: total rules hit/total, total parts
  hit/total (as percentages), corpus size, unmatched count.
- **Rule table** sorted by hit count descending (default). Columns:
  - Hits: numeric + a tiny inline bar (heat indicator).
  - Rule: rule ID / name.
  - Parts: `hitParts/totalParts` for that rule.
  - Location: `file:line` link (clickable via `onSourceClick`).
- Zero-hit rules are visually distinct (dimmed text, red/orange bar
  background).
- **Expandable rows.** Clicking a rule row expands to show per-part
  coverage underneath, with part index, part kind, hit count, and
  source location.
- **Unmatched inputs section** at the bottom. Lists inputs that did
  not match any top-level rule, with the `reason` string if present.
- Column headers are clickable to re-sort.

**Keyboard.**

- Up/Down navigate rows.
- Enter expands/collapses the selected rule.

**Complexity: medium.** Sortable table, expandable rows, inline bars,
summary aggregation. No live updates (report is computed once and
passed in).

---

### D.5 `<diff-view>`

**Purpose.** Show what changed between two grammar versions at the rule
level: which rules were added, removed, or changed.

**Layout.**

```
┌──────────────────────────────────────────────────────────────┐
│ Diff: grammar-v1.agr  vs  grammar-v2.agr                    │
│ +2 added  -1 removed  ~3 changed                             │
├──────────────────────────────────────────────────────────────┤
│ + QueueAction           (new rule)                 v2:30     │  <- green
│ + RepeatAction          (new rule)                 v2:45     │  <- green
│ - LegacySkip            (removed)                  v1:38     │  <- red
│ ~ PlayAction            (changed)                            │  <- yellow
│   ┌─ before ────────────────┬─ after ───────────────────┐    │
│   │ <PlayAction> =          │ <PlayAction> =            │    │
│   │   play <song:wildcard>  │   play <song:wildcard>    │    │
│   │   -> { action: "play",  │   [by <artist:wildcard>]  │    │
│   │        song };          │   -> { action: "play",    │    │
│   │                         │        song, artist };    │    │
│   └─────────────────────────┴───────────────────────────┘    │
│ ~ ArtistRef             (changed)                            │
│   ...                                                        │
│ ~ ShuffleAction         (changed)                            │
│   ...                                                        │
└──────────────────────────────────────────────────────────────┘
```

**Props / attributes.**

| Name            | Type                            | Required | Description                                           |
| --------------- | ------------------------------- | -------- | ----------------------------------------------------- |
| `diff`          | `GrammarDiff`                   | yes      | Result from `backend.diffGrammars`                    |
| `labelA`        | `string`                        | no       | Display name for "before" (default "before")          |
| `labelB`        | `string`                        | no       | Display name for "after" (default "after")            |
| `onSourceClick` | `(loc: SourceLocation) => void` | no       | Navigate to source                                    |
| `expandAll`     | `boolean`                       | no       | Start with all changed rules expanded (default false) |

Like `<coverage-view>`, the component does not call the backend. The
parent runs `backend.diffGrammars(a, b)` and passes the result.

**Interactions.**

- **Summary bar** at top: counts of added/removed/changed rules.
- **Rule list** in three sections: added (green), removed (red),
  changed (yellow). Within each section, sorted by rule name.
- Added/removed rules show the rule ID, a label, and a source
  location link.
- **Changed rules are expandable.** Collapsed: one line with rule
  name. Expanded: side-by-side showing `before` and `after` text
  from the `GrammarDiff.changed` entry. The diff granularity is
  rule-level text (v1 does not do sub-rule structural diff per
  chunk 08).
- Side-by-side panes use monospace text. No inline character-level
  diff highlighting in v1 (stretch goal).
- Clicking a source location fires `onSourceClick`.

**Keyboard.**

- Up/Down navigate rule entries.
- Enter toggles expand/collapse on a changed rule.

**Complexity: medium.** List with three sections, expandable rows
containing side-by-side text panels. No character-level diff logic
in v1 keeps it simpler.

---

### D.6 `<grammar-debug-panel>` (composite)

**Purpose.** The standard host layout that composes D.1 through D.5
into a single panel. This is what the VS Code webview, web app sidebar,
and shell debug panel actually mount.

**Layout.**

```
┌─────────────────────────────────────────────────────────────┐
│ ┌─ grammar-picker (D.3) ──────────────────────────────────┐ │
│ │ Source: (•) File  ( ) Agent  ( ) Live   [player.agr] ▾  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ Tabs ──────────────────────────────────────────────────┐ │
│ │ [ Completions ]  [ Trace ]  [ Coverage ]  [ Diff ]     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ Tab content ───────────────────────────────────────────┐ │
│ │                                                         │ │
│ │  (whichever of D.1 / D.2 / D.4 / D.5 is selected)     │ │
│ │                                                         │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Props / attributes.**

| Name            | Type                            | Required | Description                           |
| --------------- | ------------------------------- | -------- | ------------------------------------- |
| `backend`       | `GrammarBackend`                | yes      | Injected service handle               |
| `agents`        | `string[]`                      | no       | For grammar-picker agent mode         |
| `liveAvailable` | `boolean`                       | no       | Enable live mode tab                  |
| `enabledTabs`   | `string[]`                      | no       | Which tabs to show (default all four) |
| `onSourceClick` | `(loc: SourceLocation) => void` | no       | Forwarded to child components         |

**Behavior.**

- Grammar-picker sits at the top. On successful load, the panel
  stores the `LoadedGrammar` and passes it to whichever tab is
  active.
- Tab bar with four tabs: Completions (D.1), Trace (D.2), Coverage
  (D.4), Diff (D.5). Hosts can hide tabs via `enabledTabs` (e.g.
  coverage and diff may not be ready initially).
- Switching tabs does not re-load the grammar. Input text in D.1
  and D.2 is preserved across tab switches.
- Coverage tab needs a corpus. The panel adds a small "Load corpus"
  sub-picker (textarea for pasting inputs, or a file path) above
  D.4. On "Run", it calls `backend.runCoverage` and passes the
  report to `<coverage-view>`.
- Diff tab needs two grammars. The panel shows two grammar-pickers
  (or re-uses the current grammar as "after" and asks for "before").
  On "Diff", it calls `backend.diffGrammars` and passes the result
  to `<diff-view>`.
- If `grammar.debugInfo` is absent, the Trace and Coverage tabs show
  a notice: "Debug info not available for this grammar source. Load
  from file or agent for full trace/coverage."

---

## Theming strategy

All components use CSS custom properties for colors, fonts, and
spacing. The property names follow the VS Code convention
(`--vscode-editor-foreground`, `--vscode-list-activeSelectionBackground`,
etc.) so they work out of the box in VS Code webviews where these
variables are already set.

For browser and shell hosts, the package ships a small
`theme-defaults.css` file that sets the same custom properties to
sensible light/dark defaults (based on `prefers-color-scheme`). Hosts
include this file as a fallback; VS Code webviews do not need it.

This approach is framework-agnostic and works with Lit (CSS custom
properties pierce shadow DOM), React, or vanilla DOM.

## Fixture backend

`src/fixture/fixtureBackend.ts` implements `GrammarBackend` with
canned responses for every method. Data is derived from the player
agent grammar test fixtures in `packages/actionGrammar/test-data/`.

The fixture backend is the default for the dev harness and for
snapshot tests. It ensures D.1-D.5 can be developed and tested before
any real core service lands.

## Verification

- Dev harness: `pnpm --filter grammar-tools-ui dev` opens a browser
  page with all components mounted against the fixture backend.
- Snapshot tests for component rendering with fixture backends.
- Manual check: load in VS Code webview host, verify theme tokens
  apply.
