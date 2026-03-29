# Completion Architecture

> **Scope:** This document describes the cross-layer completion pipeline
> — how completions flow from the grammar matcher through the cache,
> dispatcher, agent SDK, shell, and CLI layers. It defines the metadata
> contract (`startIndex`, `separatorMode`, `closedSet`,
> `directionSensitive`, `openWildcard`), the shell state machine, and
> correctness invariants. For the grammar language, compilation
> pipeline, and grammar-level matching algorithms (categories, direction
> semantics, equivalence analysis), see `actionGrammar.md`.

## Overview

TypeAgent's completion system provides real-time, context-aware completions
as the user types `@`-commands, subcommands, flags, and parameter values.
The system spans four backend layers — grammar matcher, cache, agent SDK,
and dispatcher — plus a shell layer (with sub-components for session
management, DOM integration, and the search menu) and a CLI adapter.
These are connected by a structured metadata contract that eliminates
client-side heuristics.

For grammar concepts (`.agr` syntax, entities, compilation pipeline) and
the full grammar matching algorithm (including completion categories and
metadata production), see `actionGrammar.md`.

### Design principles

1. **Backend-authoritative** — The dispatcher (and the grammar/cache layers
   beneath it) decides where completions start (`startIndex`), what separates
   them from the prefix (`separatorMode`), whether the list is exhaustive
   (`closedSet`), and when to advance to the next hierarchical level.
   The host provides a `direction` signal ("forward" or "backward") to
   resolve structural ambiguity when the input is valid.
   Clients never split input on spaces or guess token boundaries — doing
   so breaks on multi-word completions, CJK scripts without whitespace
   delimiters, and quoted parameter values.

2. **Longest-match wins** — At every layer (grammar, construction cache,
   grammar store merge), only completions anchored at the longest matched
   prefix survive. Shorter matches are eagerly discarded.

3. **Progressive disclosure** — Multi-word phrases are offered one word at a
   time (e.g., for a grammar token `"played by"`, completion first offers
   `"played"`, then on the next fetch offers `"by"`). Hierarchical commands
   (`@agent subcommand param`) re-fetch at each level boundary.

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
- **Anchor** — The prefix string up to `startIndex`. See
  [Anchor](#anchor) in Key types for full semantics.

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
   exhaustive), `openWildcard=false` (the `startIndex` position is
   pinned by the keyword `"play "` — it cannot shift with more typing).

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
   completion (category 2). This time, unlike step 4, the completions
   are grammar keywords (not agent entity values), and the keyword
   position sits at an end-of-input wildcard boundary — so
   `closedSet=true` (keyword set is exhaustive) and `openWildcard=true`
   (the wildcard boundary is ambiguous — the user may still be typing
   within the song name). Shell sets `noMatchPolicy="slide"`.

### Scenario 2 — Grammar categories in action

Using the same `play <song> by <artist>` rule, here is what category
the grammar matcher assigns at different input states:

| User input       | Category     | Why                                                                                          |
| ---------------- | ------------ | -------------------------------------------------------------------------------------------- |
| `play Never by ` | 1 — Exact    | Rule could be fully matched (`<artist>` is empty wc)                                         |
| `play `          | 2 — Clean    | Prefix consumed; `<song>` wildcard is next                                                   |
| `play Never`     | 3a — Pending | `<song>` wildcard still consuming `"Never"`                                                  |
| `play Never b`   | 2 — Clean    | Partial keyword `"b"` → `"by"` via `findPartialKeywordInWildcard`; see `actionGrammar.md` §6 |
| `play Nev`       | 3a — Pending | Same — no keyword yet finalizes the wildcard                                                 |
| `pla`            | 3b — Dirty   | `"pla"` partially matches the keyword `"play"`                                               |

---

## Layer details

### 1. Grammar Matcher

**Package:** `packages/actionGrammar`
**Entry point:** `matchGrammarCompletion(grammar, prefix, minPrefixLength, direction)`

Computes the set of valid next-tokens for a partial input against compiled
grammar rules. The matcher categorizes each partial match into one of four
outcomes (exact, clean partial, pending wildcard, dirty partial) and
produces metadata that flows through the cache, dispatcher, and shell
layers. For the full algorithm — completion categories, per-direction
behavior, partial keyword detection, spacing annotation semantics, and
the Option A/B design trade-off (always back up vs. alternation-only
back up) — see `actionGrammar.md`.

**Metadata produced** (see [Key types](#key-types) for full definitions):

- `matchedPrefixLength` — characters consumed; becomes `startIndex` upstream
- `properties` — `GrammarCompletionProperty[]` carrying entity/wildcard
  property slot information for agent `getActionCompletion()` calls;
  `[]` for keyword-only completions
- `separatorMode` — determined by the rule's `[spacing=...]` annotation
- `closedSet` — `true` when all completions are grammar keywords
- `directionSensitive` — `true` when backward completion would differ
  (see [`directionSensitive`](#directionsensitive) below)
- `openWildcard` — `true` at ambiguous wildcard boundaries

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
  When one source has a defined `matchedPrefixLength` and the other does
  not, `undefined` is treated as `0` — defined wins unless both are `0`.
  When both are `undefined`, the merged result preserves `undefined`.
  **EOI guard:** when the longer result comes from a wildcard-at-EOI
  state (`openWildcard=true`, `matchedPrefixLength === prefixLength`)
  and the shorter result
  anchors inside the input (`matchedPrefixLength < prefixLength`),
  the shorter result is preferred. This prevents a grammar whose
  wildcard consumed to EOI from displacing a more-meaningful anchored
  result from another grammar. See `isEoiWildcard()` /
  `anchorsInsideInput()` in `constructionCache.ts`.
- AND-merge `closedSet` (closed only if _both_ sources are closed;
  `undefined` is treated as `false`).
- OR-merge `separatorMode` (strongest requirement wins;
  see [merge semantics](#closedset) and [`SeparatorMode`](#separatormode)).
- OR-merge `directionSensitive` (sensitive if _any_ source is sensitive).
- Merge `properties` arrays by concatenation.

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
built-in completions. The dispatcher may override `separatorMode` from the
grammar — for example, setting `"space"` for structured commands
(`@agent` prefixes, flags) or `"none"` when reconsidering a command name.

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

### 5. Shell

The shell layer comprises three sub-components: a completion session
(state machine), a DOM adapter (input extraction and menu positioning),
and a search menu (trie-backed filtering). Together they form the
client-side half of the completion system.

#### 5a. Completion Session

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

#### 5b. DOM Adapter

**Class:** `PartialCompletion`

Bridges the DOM text editor and the session state machine:

- Extracts current input (stripping ghost text from inline suggestions)
- Validates cursor is at end of input before offering completions
- Calculates menu pixel position via DOM Range API
- On user selection: computes replacement range from completion prefix,
  performs DOM text replacement, repositions cursor, triggers fresh completion

#### 5c. Search Menu

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

| Value                | Meaning                             | Use case                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"space"`            | Whitespace required                 | Commands, flags, agent names                                                                                                                                                                                                                                               |
| `"spacePunctuation"` | Whitespace or Unicode punctuation   | Latin-script grammar completions                                                                                                                                                                                                                                           |
| `"optional"`         | Separator accepted but not required | CJK / mixed-script grammars; also digit–Latin boundaries (digits are Unicode script "Common", not "Latin", so a transition like `"0"→"i"` is a script change that does not require a separator)                                                                            |
| `"none"`             | No separator                        | Grammar rules annotated with `[spacing=none]`. At the top level, no leading or trailing whitespace is consumed. For nested rules, the parent rule's spacing controls the boundaries around the child; the child's `"none"` only affects its own internal token boundaries. |

See `actionGrammar.md` Spacing modes for how the grammar matcher
determines `separatorMode` from spacing annotations, including the
"separator already consumed" override.

### `CompletionDirection`

The host-provided signal that resolves structural ambiguity when the input
is fully valid. Instead of the backend telling the client when to advance,
the client tells the backend which direction to complete.

| Value        | Meaning               | When the host sends it                                |
| ------------ | --------------------- | ----------------------------------------------------- |
| `"forward"`  | User is moving ahead  | Appending characters, typed separator, menu selection |
| `"backward"` | User is reconsidering | Backspacing, deleting                                 |

**UX motivation:** When the user is typing forward, they want to see
what comes _next_ — the next parameter slot, the next keyword, the next
subcommand. When they are backspacing, they want to _reconsider_ the
choice they just passed — re-examine a keyword they accepted, revisit a
flag they selected, or re-partition a wildcard boundary. The `direction`
parameter tells the backend which of these two intents to serve, so the
completion menu shows contextually appropriate suggestions for whichever
editing action the user is performing.

**Why the host must provide direction:** The completion backend is
stateless — each call to `getCommandCompletion()` receives only the
current input string, with no memory of previous inputs. Only the host
(shell or CLI) has access to input history and can compare the current
input to the previous input to determine whether the user is advancing
or backspacing. The shell makes this determination by checking whether
the new input is shorter than and a strict prefix of the old input
(`"backward"`); otherwise it is `"forward"`.

> **Design trade-off — why not infer direction in the backend?**
> The alternative would be a stateful backend that remembers the
> previous input per session. This would eliminate the `direction`
> parameter but at the cost of session state management, concurrency
> concerns (multiple tabs, undo/redo), and coupling the backend to
> input sequencing. The stateless design keeps the backend simple and
> idempotent — the same `(input, direction)` pair always produces the
> same result — while pushing the trivial "is this a backspace?"
> comparison to the host, which already has the information.

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

### `directionSensitive`

A boolean flowing through the backend pipeline (grammar → cache →
dispatcher), indicating that the result would differ if the opposite
`direction` (see [`CompletionDirection`](#completiondirection) above)
had been sent.

**Why it exists:** Re-fetching completions from the backend on every
keystroke is expensive. Most of the time, switching direction (e.g.,
the user backspaces after typing) does not change what completions are
valid — the input position is unambiguous and both directions would
return the same result. `directionSensitive` is an optimization signal
that tells the shell: "you only need to re-fetch when the user changes
direction if this flag is `true`." When it is `false`, the shell skips
the re-fetch entirely (trigger A4 does not fire), reusing the cached
result regardless of whether the user is now typing or backspacing.

**The rule:** The grammar matcher sets `directionSensitive=true`
whenever backward completion has something to reconsider — i.e., a
word, keyword, wildcard, or number was fully matched with no trailing
separator to commit it. Forward offers what comes _next_; backward
backs up to re-offer the last thing the user passed. If those two
results differ, `directionSensitive=true`.

This arises at three kinds of structural ambiguity: wildcard-keyword
boundary forks, multi-word keyword boundaries, and alternation-prefix
overlaps. See `actionGrammar.md` "Why direction matters" for detailed
examples and the Option A/B design trade-off.

**When `directionSensitive=false`:** Nothing was fully matched
(partial/dirty), or the position is at the caller's floor
(`P = minPrefixLength`). Exact matches with trailing whitespace
(empty completions) also return `false` because both directions
produce the same empty result.

The flag is correct under the cross-query invariant definition:
`directionSensitive=true` if and only if
`completion(input[0..P], "backward")` differs from the forward result.
For `openWildcard` positions, truncating to `input[0..P]` removes the
content that established the anchor, so backward on the truncated input
always diverges — even when both directions happen to agree on the
original (longer) input. See invariant #7.

**Decision tree** (evaluated once after all candidates are collected):

```
openWildcard        → true  (ambiguous boundary; backward can reconsider)
P = minPrefixLength → false (nothing matched beyond caller's floor)
otherwise           → true  (keyword boundary — backward can back up)
```

Exception: exact-match advancement (no completions, no properties,
trailing input is only whitespace/punctuation) forces `false` because
both directions produce an identical empty result.

See the "Forward/backward equivalence analysis" section in
`actionGrammar.md` for the full position-by-position analysis.

**Examples:** The table below shows `directionSensitive` for various
inputs. The general pattern: `true` when anything was matched beyond
the floor; `false` only when partial/dirty or exact match with no
remaining completions.

| Rule                   | Input          | `directionSensitive` | Why                                                                     |
| ---------------------- | -------------- | -------------------- | ----------------------------------------------------------------------- |
| `play <song> by <a>`   | `play`         | `true`               | `"play"` fully matched, backward can reconsider                         |
| `play <song> by <a>`   | `play `        | `true`               | Trailing space not consumed; P stays at `"play"` boundary               |
| `play <song> by <a>`   | `play Never`   | `true`               | `"Never"` in wildcard, keyword `"by"` next; no trailing space           |
| `play <song> by <a>`   | `play Never b` | `true`               | `openWildcard=true` — wildcard boundary ambiguous                       |
| `play <song> by <a>`   | `pla`          | `false`              | Only partial match (Category 3b) — nothing to back up to                |
| `play music`           | `play`         | `true`               | `"play"` fully matched, no trailing space                               |
| `play music`           | `play `        | `true`               | Trailing space not consumed; P stays at `"play"` boundary               |
| `play music`           | `play music `  | `false`              | Exact match + trailing space → no completions → exact-match advancement |
| `(play \| player) now` | `play`         | `true`               | Backward: `["play","player"]` at mpl=0; forward: `["now"]`              |
| `(play \| player) now` | `play `        | `true`               | Trailing space not consumed; P stays at `"play"` boundary               |

The dispatcher may additionally set `directionSensitive=true` at the
command level — for example, when a subcommand name is both a valid
complete command and a prefix of a longer one.

Merge rule: OR across sources (sensitive if _any_ source is sensitive).

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
that could absorb more text, moving the boundary forward — for example,
a keyword completion following a wildcard that was finalized at
end-of-input, or a backward completion backing up to a keyword that had
pinned the end of a wildcard. The ambiguity persists until further
context structurally resolves it (e.g., the user types enough after the
keyword that the wildcard-absorbing path can no longer match at the same
prefix length). See `actionGrammar.md` for the full grammar-level
analysis.

Values:

- **`true`** — the position is ambiguous. The keyword following the
  wildcard (e.g. "by") is offered as a completion, and `closedSet`
  correctly describes that keyword set as exhaustive. However, the
  _position_ of that set is uncertain.

- **`false`** — the position is definite; no sliding wildcard boundary.

Merge rule: OR across sources (open wildcard if _any_ source has one).

The shell does not store `openWildcard` directly; it is folded into
`noMatchPolicy` (see below).

### Anchor

The prefix string from the start of the input up to `startIndex`. The
shell captures this string when a backend result arrives and uses it as a
stable reference point for the lifetime of the completion session.

Everything the user types after the anchor is the **completion prefix** —
the string filtered against the local trie. For example, if the input is
`"play Never"` and `startIndex=5`, the anchor is `"play "` and the
completion prefix is `"Never"`.

The anchor serves three purposes:

1. **Trie filtering** — only the text after the anchor is matched against
   completion entries.
2. **Invalidation** — if the user edits text within the anchor (trigger A2),
   the session is invalidated and a re-fetch is required.
3. **Sliding** — when `noMatchPolicy="slide"`, the anchor advances to
   the full current input on each keystroke, preserving the trie and
   metadata. The menu is hidden during sliding. When the user eventually
   types a separator character, the raw prefix after the (now-advanced)
   anchor is just the separator itself; stripping it yields an empty
   completion prefix, which matches **all** entries in the preserved
   trie — so the full completion list reappears without a re-fetch.
   If the user then types the keyword (e.g., `"by"`), it uniquely
   matches in the trie, triggering B1 (unique match) which re-fetches
   for the next grammar part.

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

## Invariants

The completion metadata fields must satisfy several invariants across the
pipeline. Violations produce user-visible bugs — wrong completions, stale
menus, or mispositioned insertions.

**Quick reference — symptom → invariants to check:**

| Symptom                                  | Check                |
| ---------------------------------------- | -------------------- |
| Wrong or missing completions             | #2, #3, #8, #10, #12 |
| Completions at wrong position            | #1, #3, #10, #11     |
| Stale menu after backspace               | #4–#6                |
| Inconsistent menu (forward vs. backward) | #7, #8               |
| Unnecessary re-fetches (perf)            | #4–#6, #14           |
| Wrong separator behavior                 | #9, #13              |
| Menu disappears at wildcard boundary     | #10, #15             |

### Per-result invariants (grammar matcher layer)

Automatically checked by the `withInvariantChecks` wrapper in
`packages/actionGrammar/test/testUtils.ts` (grammar variant only).

**#1 — `matchedPrefixLength` bounds.**
`matchedPrefixLength` ∈ [`minPrefixLength`, `prefix.length`].
_Impact:_ Completions inserted at wrong position in the input.

**#2 — `closedSet` ↔ `properties` consistency** (grammar matcher layer
only — see `actionGrammar.md` [properties](#metadata-produced) for scope).
`closedSet=false` ↔ `properties` is non-empty.
_Impact:_ False `true` → shell uses "accept" policy and never re-fetches —
user misses entity completions. False `false` → unnecessary re-fetches
(perf cost, no visible bug).

**#3 — Truncated-forward idempotency.**
When `matchedPrefixLength < prefix.length`:
`result === completion(input[0..matchedPrefixLength], "forward")`.
Stripping unconsumed trailing input and re-running forward must produce
the same completions. For backward results this is guarded on forward
actually reaching the same position (otherwise a known forward gap would
cause a false failure).
_Impact:_ Trailing garbage in the input silently changes which completions
are offered — the result depends on content the grammar claims it did not
consume.

### Cross-direction invariants

Invariants #4–#8 are automatically checked by `assertCrossDirectionInvariants`
in `withInvariantChecks` (grammar variant only).

All automatically-checked invariants (per-result, cross-direction, and
truncated-forward) use the same numbering as this document:

| #   | Assertion function                | Summary                                                 |
| --- | --------------------------------- | ------------------------------------------------------- |
| #1  | `assertSingleResultInvariants`    | `matchedPrefixLength` bounds                            |
| #2  | `assertSingleResultInvariants`    | `closedSet` ↔ `properties` consistency                 |
| #3  | `assertTruncatedForwardInvariant` | truncated-forward idempotency                           |
| #4  | `assertCrossDirectionInvariants`  | equal `matchedPrefixLength` → identical results         |
| #5  | `assertCrossDirectionInvariants`  | !fwd.directionSensitive → backward on truncated = fwd   |
| #6  | `assertCrossDirectionInvariants`  | !bwd.directionSensitive → forward on truncated = bwd    |
| #7  | `assertCrossDirectionInvariants`  | fwd.directionSensitive → backward of truncated backs up |
| #8  | `assertCrossDirectionInvariants`  | bwd.directionSensitive → forward reaches bwd position   |

**#4 — Equal consumption → identical results.**
`forward.matchedPrefixLength === backward.matchedPrefixLength` →
`forward` deep-equals `backward`.
_Impact:_ False negative → stale menu after backspace.

**#5 — Forward not direction-sensitive → backward on truncated agrees.**
`!forward.directionSensitive` →
`forward === completion(input[0..fwd.matchedPrefixLength], "backward")`.
_Impact:_ False negative → stale menu; false positive → unnecessary
re-fetch.

**#6 — Backward not direction-sensitive → forward on truncated agrees.**
`!backward.directionSensitive` →
`backward === completion(input[0..bwd.matchedPrefixLength], "forward")`.
_Impact:_ Same as #5.

**#7 — Forward direction-sensitive → backward backs up.**
`forward.directionSensitive` →
`completion(input[0..fwd.matchedPrefixLength], "backward").matchedPrefixLength < fwd.matchedPrefixLength`.
_Impact:_ Backspacing shows different completions than forward-typing to
the same position — the menu is inconsistent depending on how the user
arrived at that input.

**#8 — Backward direction-sensitive → forward reaches backward's position.**
When `fwd.matchedPrefixLength ≠ bwd.matchedPrefixLength` and `backward.directionSensitive`:
`completion(input[0..bwd.matchedPrefixLength], "forward").matchedPrefixLength ≥ bwd.matchedPrefixLength`.
Confirms that backward's backed-up position is reachable from forward.
_Impact:_ User sees only one completion branch when backspacing at a fork —
other valid alternatives are silently lost.

Note: invariants #5–#8 previously skipped `openWildcard` cases because
truncating to an ambiguous wildcard boundary removed the content that
established the anchor. With `openWildcard → directionSensitive=true`,
#5/#6 never fire for openWildcard (the guard is `!directionSensitive`),
and #7/#8 validate correctly (backward on truncated does back up).

### Field-specific invariants

**#9 — `separatorMode` = `"none"` for `[spacing=none]` rules.**
_Impact:_ Tokens incorrectly separated in a grammar designed for direct
adjacency.

**#10 — `openWildcard` correctness.**
`true` only at ambiguous wildcard boundaries (Category 2 forward after
wildcard finalized at EOI, or backward at keyword after captured wildcard).
_Impact:_ False `true` → anchor slides when it shouldn't — completions
appear at wrong position. False `false` → menu disappears at wildcard
boundary instead of sliding.

### Merge invariants (cache / dispatcher layers)

**#11 — `matchedPrefixLength`: longest wins.**
Keep longest across sources; discard shorter.
_Impact:_ Completions anchored at wrong position when multiple
grammars/agents contribute.

**#12 — `closedSet`: AND-merge.**
Closed only if ALL sources are closed.
_Impact:_ Premature "accept" when one source is open — user misses
completions from that source.

**#13 — `separatorMode`: strongest requirement wins.**
`"space"` > `"spacePunctuation"` > `"optional"` > `"none"`.
_Impact:_ Fused display if a weak mode wins over a strong one, or
unnecessary separation if the reverse.

**#14 — `directionSensitive`: OR-merge.**
Sensitive if ANY source is sensitive.
_Impact:_ Skipped re-fetch when one source's results differ by direction.

**#15 — `openWildcard`: OR-merge.**
Open if ANY source has ambiguous boundary.
_Impact:_ Anchor doesn't slide when one source's position is ambiguous —
menu disappears.

### Known gaps

- **Category 2 forward for number-variable next-parts:** When the prefix
  is exhausted at a `VarNumberPart`, the forward path does not call
  `updateMaxPrefixLength` or collect a property completion. This causes
  `forward("set volume")` to report `matchedPrefixLength=0` instead of
  `10` for grammar `set volume $(n:number) percent`. The backward path
  handles this correctly. The two-pass invariant check skips this case
  (when `forwardAtP.matchedPrefixLength < P`).

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

Because `direction` is always `"forward"`, the CLI cannot trigger
backward-specific completions (e.g., reconsidering a flag name). In
practice this is a minor limitation: readline tab-completion is
inherently forward-looking, and users backspace-and-retype rather than
expecting the completion menu to adapt to deletions.

---

## Edge cases

- **Empty input:** The dispatcher returns the top-level command list
  (agent names and built-in commands) with `closedSet=true`.
- **No grammar match:** When no rule matches the input at all, the
  grammar matcher returns an empty completion set with
  `matchedPrefixLength=0`. The cache and dispatcher propagate this
  upward; the shell receives an empty menu and takes no action.
- **Concurrent requests:** The shell's `PENDING` state cancels any
  in-flight fetch when a new fetch is triggered (e.g., rapid typing).
  Only the most recent request's result is applied. The backend is
  stateless, so stale responses are harmlessly discarded.

---
