# Completion Architecture

## Overview

TypeAgent's completion system provides real-time, context-aware completions
as the user types `@`-commands, subcommands, flags, and parameter values.
The system spans five layers — from the grammar matcher at the bottom to
the shell/CLI UI at the top — connected by a structured metadata contract
that eliminates client-side heuristics.

### Design principles

1. **Backend-authoritative** — The dispatcher (and the grammar/cache layers
   beneath it) decides where completions start (`startIndex`), what separates
   them from the prefix (`separatorMode`), whether the list is exhaustive
   (`closedSet`), and when to advance to the next hierarchical level
   The host provides a `direction` signal ("forward" or "backward") to
   resolve structural ambiguity when the input is valid.
   Clients never split input on spaces or guess token boundaries — doing
   so breaks on multi-word completions, CJK scripts without whitespace
   delimiters, and quoted parameter values.

2. **Longest-match wins** — At every layer (grammar, construction cache,
   grammar store merge), only completions anchored at the longest matched
   prefix survive. Shorter matches are eagerly discarded.

3. **Progressive disclosure** — Multi-word phrases are offered one word at a
   time. Hierarchical commands (`@agent subcommand param`) re-fetch at each
   level boundary.

4. **Minimal re-fetch** — A client-side state machine categorizes every
   keystroke into one of six triggers and only contacts the backend when
   necessary. `closedSet` prevents futile re-fetches on finite enum
   parameters.

---

## Data flow

```
User keystroke
     │
     ▼
┌──────────────────────────────────────────────────────────────┐
│  Shell PartialCompletionSession  (or CLI getCompletionsData) │
│  State machine: IDLE → PENDING → ACTIVE                      │
│  Decides: reuse local trie  OR  re-fetch from backend        │
└────────────────────────┬─────────────────────────────────────┘
                         │ dispatcher.getCommandCompletion(input, direction)
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Dispatcher  getCommandCompletion()                          │
│  resolveCommand() → resolveCompletionTarget() →              │
│  getCommandParameterCompletion()                             │
│  Invokes agent.getCommandCompletion() when available         │
└────────────────────────┬─────────────────────────────────────┘
                         │ agent or cache.completion(prefix)
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Cache Layer                                                 │
│  constructionCache.completion() + grammarStore.completion()  │
│  mergeCompletionResults(): longest prefix, AND closedSet     │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Grammar Matcher  matchGrammarCompletion()                   │
│  Work-list over compiled rules, longest-match prioritization │
│  tryPartialStringMatch() for word-by-word progression        │
└──────────────────────────────────────────────────────────────┘
```

The return path carries `CommandCompletionResult`:

```typescript
{
  startIndex: number;           // where the resolved prefix ends
  completions: CompletionGroup[];
  separatorMode?: SeparatorMode;  // "space" | "spacePunctuation" | "optional" | "none"
  closedSet: boolean;           // true → list is exhaustive
  directionSensitive: boolean;  // true → opposite direction would produce different results
  openWildcard: boolean;        // true → wildcard boundary is ambiguous; shell should slide anchor
}
```

These fields are cross-cutting concepts that flow through every layer.
Brief definitions here; see [Key types](#key-types) for full semantics.

- **`startIndex` / `matchedPrefixLength`** — The character position where
  the backend's matched prefix ends. Everything before this position is
  "consumed" input; completions apply after it.
- **`separatorMode`** — Whether a separator character (space, punctuation)
  is required between the consumed prefix and the completion text. Ranges
  from `"space"` (strictest) to `"none"` (no separator needed).
- **`closedSet`** — `true` when the completion list is exhaustive (all
  valid values are present); `false` when additional values may exist
  (e.g., entity names the backend cannot enumerate).
- **`openWildcard`** — `true` when the `startIndex` position is ambiguous
  because it sits at a wildcard boundary that could shift with more
  typing. Controls anchor-sliding behavior in the shell.
- **`direction`** — A `"forward"` or `"backward"` signal from the host,
  indicating whether the user is advancing (appending characters) or
  reconsidering (backspacing). Resolves structural ambiguity at command
  and flag boundaries.
- **Anchor** — The prefix string up to `startIndex`. The shell uses it as
  a stable reference point: everything the user types after the anchor is
  matched against the local completion trie.

---

## End-to-end example

To ground the abstractions above, here is a concrete scenario tracing a
user interaction through every layer.

**Setup:** A player agent has the grammar rule
`play <song> by <artist>`, where `<song>` and `<artist>` are wildcards.

### Scenario 1 — Typing a new command

The user types `play Never` (free-form, no `@` prefix).

1. **Shell** (`PartialCompletionSession`): No active session → trigger A1
   → calls `dispatcher.getCommandCompletion("play Never", "forward")`.

2. **Dispatcher**: `normalizeCommand()` detects no `@` prefix and wraps
   the input as `system request play Never` — routing it through the
   system agent's `request` handler. `resolveCommand()` matches the
   `system` agent and `request` subcommand; the suffix `"play Never"`
   becomes the parameter value. `resolveCompletionTarget()` → case 2a-i
   (free-form string with implicit quotes). The request handler delegates
   to `requestCompletion()`, which calls `agentCache.completion()` with
   the original text `"play Never"`.

3. **Cache / Grammar**: The grammar matcher runs `"play Never"` against
   compiled rules from all enabled agents. The player agent's
   `play <song> by <artist>` rule matches: `"play "` consumed as keyword,
   `"Never"` absorbed by the `<song>` wildcard (category 3a — pending
   wildcard). For the `<song>` property slot, the dispatcher calls the
   player agent's `getActionCompletion()`, which queries its song library
   and returns entity values `["Never Gonna Give You Up", "Nevermind"]`.

4. **Dispatcher**: Assembles `CommandCompletionResult` with `startIndex=5`
   (after `"play "`), `closedSet=false` (entity values are not
   exhaustive), `openWildcard=false` (no keyword yet reached to create
   an ambiguous boundary).

5. **Shell**: Receives result. Sets anchor to `"play "` (the first 5
   characters). Completion prefix is `"Never"`. Populates trie with
   `["Never Gonna Give You Up", "Nevermind"]`. Both match the prefix →
   shows menu. `noMatchPolicy="refetch"` (closedSet=false,
   openWildcard=false).

6. **User types `mind`** → prefix becomes `"Nevermind"` → trie filters
   to one match → trigger B1 (unique match) → re-fetch for the next
   grammar part.

7. **Re-fetch** with `"play Nevermind"`: grammar now finalizes the
   `<song>` wildcard at end-of-input and offers keyword `"by"` as a
   completion (category 2). Returns `closedSet=true`,
   `openWildcard=true` (the wildcard boundary is ambiguous — the user
   may still be typing within the song name). Shell sets
   `noMatchPolicy="slide"`.

### Scenario 2 — Grammar categories in action

Using the same `play <song> by <artist>` rule, here is what category
the grammar matcher assigns at different input states:

| User input       | Category     | Why                                                                    |
| ---------------- | ------------ | ---------------------------------------------------------------------- |
| `play Never by ` | 1 — Exact    | Rule could be fully matched (`<artist>` is empty wc)                   |
| `play `          | 2 — Clean    | Prefix consumed; `<song>` wildcard is next                             |
| `play Never`     | 3a — Pending | `<song>` wildcard still consuming `"Never"`                            |
| `play Never b`   | 2 — Clean    | Wildcard absorbs `"Never b"`; backward detects `"b"` as partial `"by"` |
| `play Nev`       | 3a — Pending | Same — no keyword yet finalizes the wildcard                           |
| `pla`            | 3b — Dirty   | `"pla"` partially matches the keyword `"play"`                         |

---

## Layer details

### 1. Grammar Matcher

**Package:** `packages/actionGrammar`
**Entry point:** `matchGrammarCompletion(grammar, prefix, minPrefixLength)`

Computes the set of valid next-tokens for a partial input against compiled
grammar rules.

**Algorithm:**

1. Seed a work-list with one match state per top-level rule. Each state
   tracks the current position in both the rule and the input prefix.
2. Greedily advance each state through the prefix. Track the furthest
   character position any rule consumed (`maxPrefixLength`).
3. When `maxPrefixLength` advances, discard all shorter-prefix completions.
4. Categorize each state's outcome:

| Category           | Condition                                               | Example (`play <song> by <artist>`)     | Forward completion           | Backward completion                                |
| ------------------ | ------------------------------------------------------- | --------------------------------------- | ---------------------------- | -------------------------------------------------- |
| 1 — Exact          | Rule fully matched, prefix fully consumed               | `play Never by Nirvana`                 | None                         | Last matched word/wildcard                         |
| 2 — Clean partial  | Prefix consumed, rule has remaining parts               | `play ` (wildcard next)                 | Next part of rule            | Last matched part (or partial keyword — see below) |
| 3a — Pending wc    | Wildcard still consuming; no keyword yet finalizes it   | `play Never` (`<song>` still absorbing) | Wildcard property completion | Last matched part (if after wc)                    |
| 3b — Dirty partial | Input extends beyond what the current rule part matched | `pla` (`"pla"` ≈ partial `play`)        | Current part (prefix-filter) | Current part (prefix-filter)                       |

5. Multi-word string parts use `tryPartialStringMatch()` to offer one word
   at a time instead of the entire phrase.
6. **Partial keyword detection in wildcards** (Category 2 backward only):
   When a wildcard absorbs all remaining input and the next grammar part
   is a keyword, `findPartialKeywordInWildcard()` checks whether the
   wildcard text ends with a prefix of that keyword. For example, with
   `play <song> by <artist>` and input `"play Never b"`, the wildcard
   absorbs `"Never b"` but `"b"` is a prefix of `"by"`. Backward
   completion offers `"by"` at the partial keyword position (after
   `"Never "`), with `openWildcard=true`, instead of backing up to the
   wildcard start. This handles multi-word keywords as well: for
   `play <song> played by <artist>` and input `"play Never played b"`,
   the function recognizes `"played b"` as a full match of the first
   keyword word plus a partial match of the second, and offers `"by"`.
   The function honors `spacingMode` for inter-word separator matching.

**Metadata produced:**

- `matchedPrefixLength` — characters consumed; becomes `startIndex` upstream.
- `separatorMode`, `closedSet`, `openWildcard` — see [Key types](#key-types)
  for definitions. The grammar matcher is the originating source of these
  fields: `closedSet` is `true` when all completions are grammar keywords
  (no entity/wildcard values); `openWildcard` is `true` when the matched
  position sits at an ambiguous wildcard boundary (e.g., a wildcard
  finalized at end-of-input in the forward direction, or a keyword that
  had pinned a wildcard's end in the backward direction).

---

### 2. Cache Layer

**Package:** `packages/cache`
**Entry points:** `constructionCache.completion()`, `grammarStore.completion()`

Merges results from two sources:

| Source             | Description                                               |
| ------------------ | --------------------------------------------------------- |
| Construction cache | Matches against learned user utterance patterns           |
| Grammar store      | Tries DFA → NFA → simple grammar matcher (priority order) |

**Merge rules (`mergeCompletionResults`):**

- Keep only completions from the longer `matchedPrefixLength`.
- AND-merge `closedSet` (closed only if _both_ sources are closed).
- OR-merge `separatorMode` (strongest requirement wins;
  see [merge semantics](#closedset) and [`SeparatorMode`](#separatormode)).

When NFA grammar matching is enabled, only the grammar store is consulted.

---

### 3. Agent SDK

**Package:** `packages/agentSdk`
**Interface:** `AppAgentCommandInterface.getCommandCompletion()`

Agents implement this optional method to provide domain-specific completions
(e.g., song titles, calendar entries, email addresses).

**Return type: `CompletionGroups`**

```typescript
type CompletionGroups = {
  groups: CompletionGroup[];
  matchedPrefixLength?: number; // grammar override for startIndex
  separatorMode?: SeparatorMode;
  closedSet?: boolean;
};
```

Each `CompletionGroup` carries:

| Field         | Purpose                                                   |
| ------------- | --------------------------------------------------------- |
| `name`        | Group label                                               |
| `completions` | String values                                             |
| `needQuotes`  | Quote values containing spaces                            |
| `emojiChar`   | Optional icon                                             |
| `sorted`      | Whether already sorted                                    |
| `kind`        | `"literal"` (grammar tokens) or `"entity"` (agent values) |

**Helper:** `mergeSeparatorMode(a, b)` resolves conflicts by picking the
strongest requirement.

---

### 4. Dispatcher

**Package:** `packages/dispatcher`
**Entry point:** `getCommandCompletion(input, direction, context)` → `CommandCompletionResult`

The `direction` parameter (see [`CompletionDirection`](#completiondirection))
resolves structural ambiguity when the full input is valid — for example,
when a command name matches both a complete subcommand and a prefix of a
longer one. For free-form parameter values, the backend derives mid-token
status from the input's trailing whitespace instead.

Orchestrates command resolution, parameter parsing, agent invocation, and
built-in completions.

**Pipeline:**

```
input
  → normalizeCommand() → resolveCommand()
  → ResolveCommandResult { descriptor, suffix, table, matched }
  → three-way branch:
      ├─ reconsidering command → sibling subcommands (separatorMode="none")
      ├─ resolved descriptor → completeDescriptor()
      │    ├─ parseParams(suffix, partial=true) → ParseParamsResult
      │    ├─ resolveCompletionTarget() → CompletionTarget
      │    ├─ collectFlags() + agent.getCommandCompletion()
      │    ├─ computeClosedSet()
      │    └─ merge subcommand names if at default command boundary
      └─ unresolved table → offer subcommand names
  → CommandCompletionResult
```

**`resolveCompletionTarget`** — pure decision function. The two top-level
cases correspond to partial vs. full parse; sub-cases of 2 distinguish
whether the user is still editing or has committed the last token.

| Spec case | Condition                                         | Behavior                                             |
| --------- | ------------------------------------------------- | ---------------------------------------------------- |
| 1         | `remainderLength > 0` (partial parse)             | Offer what follows longest valid prefix              |
| 2a-i      | Full parse, no trailing whitespace, string param  | Editing free-form value → invoke agent, prefix-match |
| 2a-ii     | Full parse, direction="backward", flag name       | Reconsidering flag → offer flag alternatives         |
| 2b        | Full parse, direction="forward" (or fully quoted) | Offer completions for next parameter/flag            |

**`computeClosedSet`** — determines `closedSet` for the final result
(see [`closedSet`](#closedset) for the general contract):

- Agent was invoked → use agent's `closedSet` (agent is authoritative)
- Free-form text, no agent → `false`
- No remaining positional args, not partial value → `true`

---

### 5. Shell — Completion Session

**Package:** `packages/shell`
**Class:** `PartialCompletionSession`

A three-state machine (`IDLE`, `PENDING`, `ACTIVE`) that manages the
lifecycle of a completion interaction.

**State transitions:**

```
        ┌───────────────────┐
        │       IDLE        │ ← resetToIdle()
        └────────┬──────────┘
                 │ update() with input
                 ▼
        ┌───────────────────┐
        │     PENDING       │ ← awaiting backend response
        └────────┬──────────┘
                 │ result arrives
                 ▼
        ┌───────────────────┐
        │      ACTIVE       │ ← menu populated, filtering locally
        └────────┬──────────┘
                 │ reuseSession() decides:
                 ├─ reuse → filter trie locally
                 └─ re-fetch → back to PENDING
```

**Re-fetch decision tree (`reuseSession`):**

Each trigger has a code: the letter is the category
(A = invalidation, B = navigation, C = discovery) and the number is
contiguous within each category.

| Code | Trigger                                          | Category     | Action              |
| ---- | ------------------------------------------------ | ------------ | ------------------- |
| A1   | No active session                                | Invalidation | Re-fetch            |
| A2   | Input no longer extends anchor                   | Invalidation | Re-fetch            |
| A3   | Non-separator char typed when separator required | Invalidation | Re-fetch (or slide) |
| A4   | Direction changed on direction-sensitive result  | Invalidation | Re-fetch            |
| B1   | Unique match (always fires)                      | Navigation   | Re-fetch next level |
| B2   | Separator typed after exact match                | Navigation   | Re-fetch next level |
| C1   | No trie matches                                  | Discovery    | Per `noMatchPolicy` |
| —    | Trie has matches                                 | —            | Reuse locally       |

**Key concepts:**

- **Anchor** (`this.anchor`): the prefix string at `startIndex` returned by
  the backend. Everything after the anchor is the `completionPrefix` used to
  filter the local trie.
- **Separator stripping**: when `separatorMode` requires a separator, the
  leading separator character in the raw prefix is stripped before trie lookup.
- **`noMatchPolicy`**: computed once from the backend's descriptive fields
  (`closedSet`, `openWildcard`) when a result arrives (see `NoMatchPolicy`
  below). Drives the A3 and C1 decisions as a simple `switch` instead of
  checking two booleans independently.
- **Session preservation**: `hide()` cancels in-flight fetches but preserves
  anchor and menu state for quick re-activation on re-focus.

---

### 6. Shell — DOM Adapter

**Class:** `PartialCompletion`

Bridges the DOM text editor and the session state machine:

- Extracts current input (stripping ghost text from inline suggestions)
- Validates cursor is at end of input before offering completions
- Calculates menu pixel position via DOM Range API
- On user selection: computes replacement range from completion prefix,
  performs DOM text replacement, repositions cursor, triggers fresh completion

---

### 7. Shell — Search Menu

**Classes:** `SearchMenuBase` (abstract), `SearchMenu` (concrete)

Trie-backed prefix filtering:

- `setChoices(items)` — populates a ternary search tree, deduplicates by
  NFD-normalized, case-folded text
- `updatePrefix(prefix, position)` — queries trie; returns `true` on unique
  exact match; calls `onShow()`/`onHide()` template methods
- `hasExactMatch(text)` — exact trie membership test

`SearchMenuBase` is extracted to enable unit testing with `TestSearchMenu`
(real trie logic, jest-mocked lifecycle methods).

---

## Key types

### `SeparatorMode`

Controls what character is required between the matched prefix and completion
text.

| Value                | Meaning                             | Use case                         |
| -------------------- | ----------------------------------- | -------------------------------- |
| `"space"`            | Whitespace required                 | Commands, flags, agent names     |
| `"spacePunctuation"` | Whitespace or Unicode punctuation   | Latin-script grammar completions |
| `"optional"`         | Separator accepted but not required | CJK / mixed-script grammars      |
| `"none"`             | No separator                        | `[spacing=none]` grammars        |

### `CompletionDirection`

The host-provided signal that resolves structural ambiguity when the input
is fully valid. Instead of the backend telling the client when to advance,
the client tells the backend which direction to complete.

| Value        | Meaning               | When the host sends it                                |
| ------------ | --------------------- | ----------------------------------------------------- |
| `"forward"`  | User is moving ahead  | Appending characters, typed separator, menu selection |
| `"backward"` | User is reconsidering | Backspacing, deleting                                 |

Direction is only consulted at structural ambiguity points (command-level
and flag-level resolution). For free-form parameter values the backend
uses the input's trailing whitespace to decide whether the last token is
complete.

Trigger B1 (unique match) always fires a re-fetch regardless of direction,
since the session can determine locally that the completion is uniquely
satisfied.

Direction is advisory: an incorrect signal (e.g., `"forward"` during
backspace) may produce suboptimal completions but cannot crash or corrupt
state, since the backend is stateless per-request.

### `closedSet`

A boolean flowing through the backend pipeline (grammar → cache → dispatcher):

- **`true`** — completions are exhaustive (finite enum, known subcommands).
- **`false`** — completions may be incomplete (entity values, open-ended
  text).

Merge rule: AND across sources (closed only if _all_ sources are closed).

The shell does not store `closedSet` directly; it is folded into
`noMatchPolicy` (see below).

### `openWildcard`

A boolean flowing through the backend pipeline, signaling that the
`matchedPrefixLength` position is **ambiguous** — adjacent to a wildcard
whose extent is not fully determined.

A position is **definite** when it is structurally pinned by matched
grammar tokens: no amount of additional typing can change where it falls.
Examples: the start of a wildcard (pinned by the preceding keyword), or a
keyword matched without a preceding wildcard.

A position is **ambiguous** when it sits at the boundary of a wildcard
that could absorb more text, moving the boundary forward. This happens
in two cases:

- **Forward:** a keyword completion follows a wildcard that was finalized
  at end-of-input (the matcher treats EOI as a tentative wildcard
  boundary). The wildcard consumed everything up to EOI, but the user
  may still be typing within it.
- **Backward:** completion backs up to a keyword that had pinned the end
  of a preceding wildcard. Backing up un-pins that boundary — the
  wildcard could extend to absorb the keyword text.

Values:

- **`true`** — the position is ambiguous. The keyword following the
  wildcard (e.g. "by") is offered as a completion, and `closedSet`
  correctly describes that keyword set as exhaustive. However, the
  _position_ of that set is uncertain.

- **`false`** — the position is definite; no sliding wildcard boundary.

Merge rule: OR across sources (open wildcard if _any_ source has one).

The shell does not store `openWildcard` directly; it is folded into
`noMatchPolicy` (see below).

### `NoMatchPolicy` (shell-internal)

Computed once from `closedSet` and `openWildcard` when a backend result
arrives. Controls what the shell does when the local trie has no matches
for the user's typed prefix.

**Why derive a policy?** The backend returns _descriptive_ metadata —
`closedSet` says whether the completion list is exhaustive, `openWildcard`
says whether the anchor position is ambiguous. These are grammar-level
facts that don't depend on the shell's UI. The shell translates them into
a single actionable policy on arrival, keeping the decision points (A3
and C1) simple: each is a `switch` on one enum rather than reasoning
about two independent booleans.

**Why `openWildcard` wins over `closedSet`:** When a wildcard boundary is
ambiguous, `closedSet` correctly describes the _keyword_ set (e.g.
"by" is exhaustive), but the _position_ of that set is uncertain because
the wildcard extent could shift. Re-fetching would return the same
keywords at a shifted position (wasteful), and `"accept"` would leave the
user stuck (no menu, no re-fetch). Sliding is the only useful action, so
`openWildcard=true` maps to `"slide"` regardless of `closedSet`.

| Policy      | Derived from                            | Shell action at A3 / C1          |
| ----------- | --------------------------------------- | -------------------------------- |
| `"accept"`  | `closedSet=true`, `openWildcard=false`  | Reuse (menu hidden, no re-fetch) |
| `"refetch"` | `closedSet=false`, `openWildcard=false` | Re-fetch (backend may know more) |
| `"slide"`   | `openWildcard=true` (any `closedSet`)   | Slide anchor forward             |

This replaces independent checks on two booleans with a single `switch`:

- **A3** (non-separator after anchor): `"slide"` slides the anchor forward;
  `"accept"` / `"refetch"` trigger a re-fetch.
- **C1** (trie empty): `"slide"` slides the anchor forward; `"accept"`
  reuses silently; `"refetch"` re-fetches.

Anchor sliding preserves the trie and metadata so the menu re-appears at
the next whitespace boundary. Recovery is automatic: when the user eventually
types the keyword and it uniquely matches (trigger B1), the session
re-fetches for the next grammar part.

---

## CLI integration

The CLI (`packages/cli/src/commands/interactive.ts`) follows the same
contract but with simpler plumbing:

1. Sends full input and a `direction` (always `"forward"` for tab-completion,
   since readline has no equivalent of backspace-triggered recompletion)
   to `dispatcher.getCommandCompletion(line, direction)` (no
   token-boundary heuristics).
2. Uses `result.startIndex` as the readline filter position.
3. Prepends a space separator when `separatorMode` is `"space"` or
   `"spacePunctuation"` to prevent fused display (e.g., `"playmusic"`).

---
