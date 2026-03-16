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
   (`commitMode`). Clients never split input on spaces or guess token
   boundaries.

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
                         │ dispatcher.getCommandCompletion(input)
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
  commitMode?: CommitMode;      // "explicit" | "eager"
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

| Category           | Condition                                   | Completion source              |
| ------------------ | ------------------------------------------- | ------------------------------ |
| 1 — Exact          | Rule fully matched, prefix fully consumed   | None (rule satisfied)          |
| 2 — Clean partial  | Prefix consumed, rule has remaining parts   | Next part of rule              |
| 3a — Dirty partial | Trailing text matches start of current part | Current part (prefix-filtered) |
| 3b — Dirty partial | Trailing text doesn't match                 | Offer current part             |

5. Multi-word string parts use `tryPartialStringMatch()` to offer one word
   at a time instead of the entire phrase.

**Metadata produced:**

- `matchedPrefixLength` — characters consumed; becomes `startIndex` upstream.
- `separatorMode` — per-candidate analysis of whether space/punctuation is
  needed at the boundary (Latin vs CJK, `[spacing=none]` rules).
- `closedSet` — `true` for pure keyword alternatives; `false` when
  property/wildcard completions are emitted (entity values are external).

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
  commitMode?: CommitMode;
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
**Entry point:** `getCommandCompletion(input, context)` → `CommandCompletionResult`

Orchestrates command resolution, parameter parsing, agent invocation, and
built-in completions.

**Pipeline:**

```
input
  → normalizeCommand() → resolveCommand()
  → ResolveCommandResult { descriptor, suffix, table, matched }
  → three-way branch:
      ├─ uncommitted command → sibling subcommands (separatorMode="none")
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

| Spec case | Condition                                    | Behavior                                             |
| --------- | -------------------------------------------- | ---------------------------------------------------- |
| 1         | `remainderLength > 0` (partial parse)        | Offer what follows longest valid prefix              |
| 3a-i      | Full parse, no trailing space, string param  | Editing free-form value → invoke agent, prefix-match |
| 3a-ii     | Full parse, no trailing space, flag name     | Uncommitted flag → offer flag alternatives           |
| 3b        | Full parse, trailing space (or fully quoted) | Offer completions for next parameter/flag            |

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
| A3   | Non-separator char typed when separator required | Invalidation | Re-fetch            |
| B4   | Unique match + eager commit mode                 | Navigation   | Re-fetch next level |
| B5   | Separator typed after exact match                | Navigation   | Re-fetch next level |
| C6   | No trie matches + open set                       | Discovery    | Re-fetch            |
| —    | Trie has matches                                 | —            | Reuse locally       |
| —    | No matches + closed set                          | —            | Reuse (menu hidden) |

**Key concepts:**

- **Anchor** (`this.anchor`): the prefix string at `startIndex` returned by
  the backend. Everything after the anchor is the `completionPrefix` used to
  filter the local trie.
- **Separator stripping**: when `separatorMode` requires a separator, the
  leading separator character in the raw prefix is stripped before trie lookup.
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

### `CommitMode`

Controls when a uniquely-satisfied completion triggers a re-fetch for the next
hierarchical level.

| Value        | Meaning                              | Use case                        |
| ------------ | ------------------------------------ | ------------------------------- |
| `"explicit"` | User must type delimiter to commit   | Parameter completions (default) |
| `"eager"`    | Re-fetch immediately on unique match | `@` command prefix              |

### `closedSet`

A boolean flowing through the entire pipeline:

- **`true`** — completions are exhaustive (finite enum, known subcommands).
  When the trie empties, the shell does not re-fetch.
- **`false`** — completions may be incomplete (entity values, open-ended
  text). When the trie empties, the shell re-fetches to discover more.

Merge rule: AND across sources (closed only if _all_ sources are closed).

---

## CLI integration

The CLI (`packages/cli/src/commands/interactive.ts`) follows the same
contract but with simpler plumbing:

1. Sends full input to `dispatcher.getCommandCompletion(line)` (no
   token-boundary heuristics).
2. Uses `result.startIndex` as the readline filter position.
3. Prepends a space separator when `separatorMode` is `"space"` or
   `"spacePunctuation"` to prevent fused display (e.g., `"playmusic"`).

---
