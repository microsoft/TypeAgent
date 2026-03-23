# Completion Architecture

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

| User input       | Category     | Why                                                                                                                                                                                                                                                                                                       |
| ---------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `play Never by ` | 1 — Exact    | Rule could be fully matched (`<artist>` is empty wc)                                                                                                                                                                                                                                                      |
| `play `          | 2 — Clean    | Prefix consumed; `<song>` wildcard is next                                                                                                                                                                                                                                                                |
| `play Never`     | 3a — Pending | `<song>` wildcard still consuming `"Never"`                                                                                                                                                                                                                                                               |
| `play Never b`   | 2 — Clean    | Backward direction only: wildcard absorbs `"Never b"`, then `findPartialKeywordInWildcard()` detects `"b"` as a prefix of keyword `"by"` and offers it as a completion at the partial keyword position (after `"Never "`). In the forward direction this would be category 3a (wildcard still consuming). |
| `play Nev`       | 3a — Pending | Same — no keyword yet finalizes the wildcard                                                                                                                                                                                                                                                              |
| `pla`            | 3b — Dirty   | `"pla"` partially matches the keyword `"play"`                                                                                                                                                                                                                                                            |

---

## Layer details

### 1. Grammar Matcher

**Package:** `packages/actionGrammar`
**Entry point:** `matchGrammarCompletion(grammar, prefix, minPrefixLength)`

Computes the set of valid next-tokens for a partial input against compiled
grammar rules. The matcher categorizes each partial match into one of four
outcomes (exact, clean partial, pending wildcard, dirty partial) and
produces metadata that flows through the cache, dispatcher, and shell
layers. For the full algorithm — completion categories, per-direction
behavior, partial keyword detection, spacing annotation semantics, and
the Option A design trade-off — see `actionGrammar.md`.

**Metadata produced** (see [Key types](#key-types) for full definitions):

- `matchedPrefixLength` — characters consumed; becomes `startIndex` upstream
- `properties` — `GrammarCompletionProperty[]` carrying entity/wildcard
  property slot information for agent `getActionCompletion()` calls;
  `[]` for keyword-only completions
- `separatorMode` — determined by the rule's `[spacing=...]` annotation
- `closedSet` — `true` when all completions are grammar keywords
- `directionSensitive` — `true` when backward completion would differ
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

### `directionSensitive`

A boolean flowing through the backend pipeline (grammar → cache →
dispatcher), indicating that the result would differ if the opposite
`direction` had been sent.

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

This arises at wildcard-keyword boundary forks, multi-word keyword
boundaries, and alternation-prefix overlaps. See `actionGrammar.md`
"Why direction matters" for detailed examples and the Option A/B
design trade-off.

**When `directionSensitive=false`:**

- **Nothing was fully matched** — only a partial match exists (e.g.,
  `"pla"` against `play music`). No completed part to back up to.
- **Trailing separator commits** — a space or punctuation after a
  matched part pins the position. The user has moved past the
  boundary (e.g., `"play "` with trailing space).
- **Category 3b (dirty partial)** — trailing text didn't match any
  part. Both directions produce the same alternative set.

Examples with rule `play <song> by <artist>`:

| Input         | `directionSensitive` | Why                                                             |
| ------------- | -------------------- | --------------------------------------------------------------- |
| `play`        | `true`               | `"play"` fully matched, backward can reconsider                 |
| `play `       | `false`              | Trailing space commits                                          |
| `play music`  | `true`               | `"music"` in wildcard, keyword `"by"` next; no trailing space   |
| `play music ` | `false`              | Trailing space commits                                          |
| `pla`         | `false`              | Only partial match (cat 3b) — nothing to back up to             |
| `play r`      | `false`              | Category 3b (dirty partial) — direction does not affect the set |

Examples with keyword-only rules:

| Rule                   | Input    | `directionSensitive` | Why                                                        |
| ---------------------- | -------- | -------------------- | ---------------------------------------------------------- |
| `play music`           | `play`   | `true`               | `"play"` fully matched, no trailing space                  |
| `play music`           | `play `  | `false`              | Trailing space commits                                     |
| `play music`           | `pla`    | `false`              | Only partial match — nothing to back up to                 |
| `(play \| player) now` | `play`   | `true`               | Backward: `["play","player"]` at mpl=0; forward: `["now"]` |
| `(play \| player) now` | `play `  | `false`              | Trailing space commits                                     |
| `(play \| player) now` | `player` | `true`               | `"player"` fully matched, no trailing space                |

Exception: in `[spacing=none]` mode, whitespace is not a separator,
so `directionSensitive` is always `true` when any word has been fully
matched — trailing spaces do not commit.

The dispatcher may additionally set `directionSensitive=true` at the
command level — for example, when a subcommand name is both a valid
complete command and a prefix of a longer one.

Merge rule: OR across sources (sensitive if _any_ source is sensitive).

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
that could absorb more text, moving the boundary forward — for example,
a keyword completion following a wildcard that was finalized at
end-of-input, or a backward completion backing up to a keyword that had
pinned the end of a wildcard. The ambiguity persists until further
context structurally resolves it. See `actionGrammar.md` for the full
grammar-level analysis.

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
