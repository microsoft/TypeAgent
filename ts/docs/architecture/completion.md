# Command Completion Architecture

## Overview

TypeAgent's command completion system provides real-time, context-aware
completions as the user types `@`-commands, subcommands, flags, and parameter
values. The system spans five layers — from the grammar matcher at the bottom
to the shell/CLI UI at the top — connected by a structured metadata contract
that eliminates client-side heuristics.

### Design principles

1. **Backend-authoritative** — The dispatcher (and the grammar/cache layers
   beneath it) decides where completions start (`startIndex`), what separates
   them from the prefix (`separatorMode`), whether the list is exhaustive
   (`closedSet`), and when to advance to the next hierarchical level
   The host provides a `direction` signal ("forward" or "backward") to
   resolve structural ambiguity when the input is valid.
   Clients never split input on spaces or guess token boundaries.

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

---

## Layer details

### 1. Grammar Matcher

**Package:** `packages/actionGrammar`
**Entry point:** `matchGrammarCompletion(grammar, prefix, minPrefixLength)`

Computes the set of valid next-tokens for a partial input against compiled
grammar rules.

**Algorithm:**

1. Seed a work-list with one `MatchState` per top-level rule.
2. Greedily advance each state through the prefix. Track
   `maxPrefixLength` — the furthest character position any rule consumed.
3. When `maxPrefixLength` advances, discard all shorter-prefix completions.
4. Categorize each state's outcome:

| Category           | Condition                                   | Forward completion source      | Backward completion source     |
| ------------------ | ------------------------------------------- | ------------------------------ | ------------------------------ |
| 1 — Exact          | Rule fully matched, prefix fully consumed   | None                           | Last matched word/wildcard     |
| 2 — Clean partial  | Prefix consumed, rule has remaining parts   | Next part of rule              | Last matched part              |
| 3a — Dirty partial | Trailing text matches start of current part | Current part (prefix-filtered) | Current part (prefix-filtered) |
| 3b — Dirty partial | Trailing text doesn't match                 | Current part                   | Last matched part              |

5. Multi-word string parts use `tryPartialStringMatch()` to offer one word
   at a time instead of the entire phrase.

**Metadata produced:**

- `matchedPrefixLength` — characters consumed; becomes `startIndex` upstream.
- `separatorMode` — per-candidate analysis of whether space/punctuation is
  needed at the boundary (Latin vs CJK, `[spacing=none]` rules).
- `closedSet` — `true` for pure keyword alternatives; `false` when
  property/wildcard completions are emitted (entity values are external).
- `openWildcard` — `true` when a keyword completion is offered after a
  wildcard that was finalized at end-of-input (Category 2 where the
  preceding wildcard consumed the entire remaining input). Signals that
  the wildcard boundary is ambiguous.

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
- AND-merge `closedSet`: result is closed only if both sources are closed.
- OR-merge `separatorMode`: strongest separator requirement wins
  (`space > spacePunctuation > optional > none`).

When `_useNFAGrammar` is enabled, only the grammar store is consulted.

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

The `direction` parameter is a `CompletionDirection` (`"forward" | "backward"`) provided
by the host. It resolves structural ambiguity when the full input is valid —
for example, when a typed command name matches both a complete subcommand and
a prefix of a longer one, direction tells the backend whether to proceed
forward (show what follows) or reconsider backward (show alternatives).
For free-form parameter values, the backend derives mid-token status from
the input's trailing whitespace instead.

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

**`resolveCompletionTarget`** — pure decision function:

| Spec case | Condition                                         | Behavior                                             |
| --------- | ------------------------------------------------- | ---------------------------------------------------- |
| 1         | `remainderLength > 0` (partial parse)             | Offer what follows longest valid prefix              |
| 3a-i      | Full parse, no trailing whitespace, string param  | Editing free-form value → invoke agent, prefix-match |
| 3a-ii     | Full parse, direction="backward", flag name       | Reconsidering flag → offer flag alternatives         |
| 3b        | Full parse, direction="forward" (or fully quoted) | Offer completions for next parameter/flag            |

**`computeClosedSet`** heuristic:

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

| Code | Trigger                                          | Category     | Action              |
| ---- | ------------------------------------------------ | ------------ | ------------------- |
| A1   | No active session                                | Invalidation | Re-fetch            |
| A2   | Input no longer extends anchor                   | Invalidation | Re-fetch            |
| A3   | Non-separator char typed when separator required | Invalidation | Re-fetch (or slide) |
| A7   | Direction changed on direction-sensitive result  | Invalidation | Re-fetch            |
| B4   | Unique match (always fires)                      | Navigation   | Re-fetch next level |
| B5   | Separator typed after exact match                | Navigation   | Re-fetch next level |
| C6   | No trie matches                                  | Discovery    | Per `noMatchPolicy` |
| —    | Trie has matches                                 | —            | Reuse locally       |

**Key concepts:**

- **Anchor** (`this.anchor`): the prefix string at `startIndex` returned by
  the backend. Everything after the anchor is the `completionPrefix` used to
  filter the local trie.
- **Separator stripping**: when `separatorMode` requires a separator, the
  leading separator character in the raw prefix is stripped before trie lookup.
- **`noMatchPolicy`**: computed once from the backend's descriptive fields
  (`closedSet`, `openWildcard`) when a result arrives (see `NoMatchPolicy`
  below). Drives the A3 and C6 decisions as a simple `switch` instead of
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

Trigger B4 (unique match) always fires a re-fetch regardless of direction,
since the session can determine locally that the completion is uniquely
satisfied.

### `closedSet`

A boolean flowing through the backend pipeline (grammar → cache → dispatcher):

- **`true`** — completions are exhaustive (finite enum, known subcommands).
- **`false`** — completions may be incomplete (entity values, open-ended
  text).

Merge rule: AND across sources (closed only if _all_ sources are closed).

The shell does not store `closedSet` directly; it is folded into
`noMatchPolicy` (see below).

### `openWildcard`

A boolean flowing through the backend pipeline, signaling that the completions
are offered at a position where a wildcard was finalized at end-of-input.

- **`true`** — the wildcard's extent is ambiguous (the user may still be
  typing within it). The keyword following the wildcard (e.g. "by") is
  offered as a completion, and `closedSet` correctly describes that keyword
  set as exhaustive. However, the _position_ of that set is uncertain.

- **`false`** — no sliding wildcard boundary.

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
and C6) simple: each is a `switch` on one enum rather than reasoning
about two independent booleans.

**Why `openWildcard` wins over `closedSet`:** When a wildcard is finalized
at end-of-input, `closedSet` correctly describes the _keyword_ set (e.g.
"by" is exhaustive), but the _position_ of that set is uncertain because
the wildcard extent is ambiguous. Re-fetching would return the same
keywords at a shifted position (wasteful), and `"accept"` would leave the
user stuck (no menu, no re-fetch). Sliding is the only useful action, so
`openWildcard=true` maps to `"slide"` regardless of `closedSet`.

| Policy      | Derived from                            | Shell action at A3 / C6          |
| ----------- | --------------------------------------- | -------------------------------- |
| `"accept"`  | `closedSet=true`, `openWildcard=false`  | Reuse (menu hidden, no re-fetch) |
| `"refetch"` | `closedSet=false`, `openWildcard=false` | Re-fetch (backend may know more) |
| `"slide"`   | `openWildcard=true` (any `closedSet`)   | Slide anchor forward             |

This replaces independent checks on two booleans with a single `switch`:

- **A3** (non-separator after anchor): `"slide"` slides the anchor forward;
  `"accept"` / `"refetch"` trigger a re-fetch.
- **C6** (trie empty): `"slide"` slides the anchor forward; `"accept"`
  reuses silently; `"refetch"` re-fetches.

Anchor sliding preserves the trie and metadata so the menu re-appears at
the next word boundary. Recovery is automatic: when the user eventually
types the keyword and it uniquely matches (trigger B4), the session
re-fetches for the next grammar part.

---

## CLI integration

The CLI (`packages/cli/src/commands/interactive.ts`) follows the same
contract but with simpler plumbing:

1. Sends full input and a `direction` (always `"forward"` for tab-completion)
   to `dispatcher.getCommandCompletion(line, direction)` (no
   token-boundary heuristics).
2. Uses `result.startIndex` as the readline filter position.
3. Prepends a space separator when `separatorMode` is `"space"` or
   `"spacePunctuation"` to prevent fused display (e.g., `"playmusic"`).

---
