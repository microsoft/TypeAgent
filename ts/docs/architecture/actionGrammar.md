# Action Grammar — Architecture & Design

> **Scope:** This document is the implementation reference for the
> `actionGrammar` package — the grammar language (`.agr` syntax,
> entities, spacing modes, value expressions), the compilation pipeline,
> and the matching algorithms (full matching and completion matching).
> For the cross-layer completion pipeline (cache → dispatcher → shell →
> CLI), metadata contracts, and correctness invariants, see
> `completion.md`.

## Overview

The `action-grammar` package is TypeAgent's natural language understanding
engine. It compiles declarative grammar rule files (`.agr`) into efficient
matching automata that convert free-form user requests into structured,
typed action objects — without invoking an LLM at match time.

```
"play Yesterday by the Beatles"
        ↓  grammar match
{ actionName: "play", parameters: { track: "Yesterday", artist: "the Beatles" } }
```

The package sits between raw user input and the dispatcher, providing the
first — and fastest — route to action resolution. When a grammar match
succeeds, it eliminates the latency and cost of an LLM call entirely.

### Key concepts

| Term                | Meaning                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Typed action**    | A structured object (`{ actionName, parameters }`) representing a user intent, validated against an agent's TypeScript action schema.                                           |
| **ActionResult**    | The return value from an agent's `executeAction()` handler after processing a typed action.                                                                                     |
| **Grammar matcher** | The system that matches user input against compiled grammar rules to produce typed actions. Accessed through the cache layer (`GrammarStoreImpl` in the `agent-cache` package). |

---

## Grammar concepts

### The `.agr` language

Grammars are written in `.agr` files — a purpose-built syntax resembling
BNF with extensions for wildcards, entities, spacing modes, and value
expressions. Agents never write matching code; they declare patterns.

#### Declarations

```agr
import { CalendarDate, Ordinal };          // Entity imports (no source — runtime-registered)
import { helper } from "./other.agr";      // Named import
import * from "./global.agr";             // Wildcard import
```

Imports serve two roles:

- **Entity imports** (`import { CalendarDate, Ordinal }`) declare entity
  types that are registered at runtime (see [Entities](#entities) below).
  No `from` clause is used — these names are resolved against the global
  entity registry at compile time.
- **Named imports** (`import { helper } from "./other.agr"`) bring in
  specific named rules from the target file.
- **Wildcard imports** (`import * from "./global.agr"`) import all rules
  and entity imports from the target file into the current scope.
  Name conflicts between wildcard-imported rules and locally defined
  rules are detected and reported as errors during compilation.

#### Rule definitions

A rule has a name, optional annotation, and one or more alternatives
separated by `|`:

```agr
<RuleName> [spacing=mode] = alternative1 | alternative2 ;

// Example:
<PlaySong> =
    play $(track:wildcard) by $(artist:wildcard)
    -> { actionName: "play", parameters: { track, artist } }
  | put on $(track:wildcard)
    -> { actionName: "play", parameters: { track } };
```

#### Expression types

| Syntax              | Meaning                                |
| ------------------- | -------------------------------------- |
| `word`              | Literal token (case-insensitive match) |
| `$(var:wildcard)`   | Capture any tokens as string           |
| `$(var:number)`     | Capture numeric token                  |
| `$(var:EntityType)` | Capture with entity validation         |
| `$(var:<RuleName>)` | Capture via sub-rule match             |
| `<RuleName>`        | Reference another rule (no capture)    |
| `( expr )`          | Grouping                               |
| `expr?`             | Optional (zero or one)                 |
| `expr*`             | Zero or more                           |
| `expr+`             | One or more                            |
| `alt1 \| alt2`      | Alternation                            |

#### Value expressions

The `->` operator maps a matched rule to a structured action object.
Captured variables are referenced by name:

```agr
<AddEvent> =
    (add | create | schedule) $(title:wildcard)
        on $(date:CalendarDate) at $(time:CalendarTime)
    -> {
        actionName: "addEvent",
        parameters: {
            title,
            date,
            time
        }
    };
```

#### Spacing modes

Rules can annotate how tokens are separated, which matters for CJK
languages and punctuation-adjacent matching:

| Mode       | Behavior                                          |
| ---------- | ------------------------------------------------- |
| `required` | At least one whitespace separator between tokens  |
| `optional` | Zero or more separators between tokens            |
| `none`     | No separators (tokens must be adjacent)           |
| `auto`     | Smart: Latin/Cyrillic require space; CJK does not |

At matching time, the annotation sets a `CompiledSpacingMode` that is
evaluated against the adjacent characters to produce a `separatorMode`
(used by the completion pipeline — see
[Completion matching](#completion-matching-matchgrammarcompletion) and
`completion.md`):

| Annotation           | `CompiledSpacingMode` | Resulting `separatorMode`                                                                                                                                             |
| -------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(none / default)_   | `auto`                | `"spacePunctuation"` if both adjacent characters are word-boundary scripts (Latin, Cyrillic, etc.); `"optional"` if either is CJK or another non-word-boundary script |
| `[spacing=required]` | `"required"`          | Always `"spacePunctuation"`                                                                                                                                           |
| `[spacing=optional]` | `"optional"`          | Always `"optional"`                                                                                                                                                   |
| `[spacing=none]`     | `"none"`              | Always `"none"` — no separator consumed or required                                                                                                                   |

**Note:** The table above describes the _baseline_ `separatorMode`
from the spacing annotation. When the consumed prefix already ends with
whitespace (i.e., the separator is already present in `matchedPrefixLength`),
the grammar matcher overrides to `"optional"` because no additional
separator is needed. Digits are Unicode script "Common" (not a
word-boundary script), so `auto` spacing at a digit–Latin boundary
(e.g., `$(n:number)` followed by a Latin keyword) also produces
`"optional"`.

### Entities

Entities are typed validators and converters for captured wildcards.
A grammar declares which entity types it uses (`import { CalendarDate };`),
and wildcards reference them with `$(var:EntityType)`.

#### Built-in entities

| Entity              | Matches                                   | Converts to         |
| ------------------- | ----------------------------------------- | ------------------- |
| `Ordinal`           | "first", "second", …, "twentieth"         | `number` (1, 2, …)  |
| `Cardinal`          | "one", "two", numeric strings, multi-word | `number`            |
| `CalendarDate`      | Relative/absolute date expressions        | Date object / ISO   |
| `CalendarTime`      | "3pm", "half past 2", etc.                | Time representation |
| `CalendarTimeRange` | Multi-token time ranges                   | Time range          |
| `CalendarDayRange`  | Multi-token day ranges                    | Day range           |
| `Percentage`        | Percentage expressions                    | `number`            |

Custom entities can be registered at runtime via the `EntityRegistry`.

---

## How grammars are used in TypeAgent

### Dispatcher integration

The dispatcher maintains a grammar per registered agent. Grammar
matching is not invoked directly by the dispatcher — it is delegated
through the **cache layer** (`GrammarStoreImpl` in the `agent-cache`
package). On each user request:

1. The dispatcher calls `matchRequest()`, which delegates to
   `AgentCache.match()`, which routes to `GrammarStoreImpl.match()`
2. `GrammarStoreImpl` iterates over agent grammars and runs the
   matching backend (selected by session config)
3. If a high-confidence match is found, the action is dispatched directly
   — no LLM call needed
4. If no grammar match, the request falls through to LLM-based translation
5. After LLM confirmation, a new grammar rule may be generated and added
   dynamically

### Dynamic grammar loading

Grammars can be augmented at runtime — typically after the user confirms
an LLM-generated action:

```
User request → LLM generates action → User confirms
                                          ↓
                               Grammar rule generated
                                          ↓
                     ┌────────────────────┼──────────────────────┐
                     │                    │                      │
              Syntax validated      Matcher recompiled    Persisted to
              (parse + compile)     (hot reload)          grammar store
```

**`GrammarStore`** — Persistent storage of dynamically generated grammar
rules. The file path is configurable (typically under `~/.typeagent/`).
Each stored rule includes a stable ID, the source `.agr` text, the
originating user request, the target action name, schema name, and a
timestamp. Rules are organized by schema name. Supports add, delete
(by index or by ID), and schema-scoped retrieval.

**`DynamicGrammarLoader`** — Validates grammar text (parse + compile),
checks entity references, detects symbol conflicts, and recompiles the
matcher. On failure, returns structured error information including:
parse errors (syntax problems in the `.agr` text), unresolved references
(rule or entity names that don't exist), and symbol conflicts (names
that collide with existing rules).

**`AgentGrammar`** — Per-agent wrapper that manages a base grammar
(from `.agr` files) plus dynamically added rules. Supports `resetToBase()`
to revert to the original base grammar and `addGeneratedRules()` to
extend. **`AgentGrammarRegistry`** manages the collection of per-agent
`AgentGrammar` instances and provides `resetAllToBase()` to reset all
agents at once.

### Grammar generation

The `generation/` subsystem uses LLMs to automatically create grammar
rules from action schemas or confirmed user interactions.

**Three generation strategies:**

1. **`ClaudeGrammarGenerator`** — Analyzes individual request/action pairs.
   Given a natural language request and its confirmed action, Claude
   extracts linguistic patterns, parameter mappings, and alternative
   phrasings. Produces `GrammarAnalysis` with rule patterns.

2. **`SchemaToGrammarGenerator`** — Batch generation from action schemas.
   Reads `.pas.json` (Parameter Action Schema) files — JSON
   representations of an agent's TypeScript action types, containing
   action names, parameter types, and descriptions extracted from the
   agent's schema `.ts` file. From these schemas, the generator
   produces example natural language requests for each action and
   synthesizes complete `.agr` grammar text with test cases.

3. **`ScenarioBasedGrammarGenerator`** — Uses pre-defined scenario templates
   (music player, calendar, lists) to generate grammar rules for common
   action patterns without LLM calls.

**Coverage optimization:** `GrammarWarmer` tracks hit-rate metrics —
which rules match, which miss, and which user requests fall through to
LLM — and uses this data to prioritize generation of new rules.

### Completion integration

The grammar matcher provides completion support via
`matchGrammarCompletion()` (see
[Completion matching](#completion-matching-matchgrammarcompletion)
below). The layers above the grammar matcher — cache merging, dispatcher
orchestration, agent SDK, the shell state machine, and CLI integration —
are documented in `completion.md`.

---

## Internal architecture

### Design principles

1. **Declarative grammar representation** — Grammars are compiled from
   `.agr` source into an in-memory `Grammar` structure that is
   independent of any particular matching backend.

2. **Entity-aware validation** — Typed wildcards (`CalendarDate`, `Ordinal`,
   etc.) can validate captured values against registered entity converters.

3. **Follow the ECMA-262 specification** — Value expressions follow
   JavaScript semantics as defined in ECMA-262 wherever applicable,
   including operator precedence, associativity, short-circuit
   evaluation rules, and numeric literal grammar.

### Core data model

#### Grammar types (in-memory representation)

```
Grammar
├── rules: GrammarRule[]                    # Top-level alternatives
└── entities?: string[]                     # Referenced entity types

GrammarRule
├── parts: GrammarPart[]                    # Ordered sequence
├── value?: CompiledValueNode               # Action value expression
└── spacingMode?: "required"|"optional"|"none"|undefined  # undefined = auto

GrammarPart (discriminated union)
├── StringPart      { type:"string",    value: string[] }
├── VarStringPart   { type:"wildcard",  variable, typeName, optional }
├── VarNumberPart   { type:"number",    variable, optional }
├── RulesPart       { type:"rules",     rules[], optional, repeat, variable }
```

#### Value expressions

Value nodes form a tree that is evaluated against captured variables at
match time to produce the final action object:

```
CompiledValueNode
├── literal   → constant value
├── variable  → variable reference (resolved by name)
├── object    → { key: CompiledValueNode, … }
└── array     → [ CompiledValueNode, … ]
```

### Processing pipeline

```
                      .agr file (text)
                            │
               ┌────────────▼─────────────┐
               │    grammarRuleParser     │  Recursive descent parser
               │    parseGrammarRules()   │  Produces GrammarParseResult AST
               └────────────┬─────────────┘  (with comment preservation)
                            │
               ┌────────────▼─────────────┐
               │    grammarCompiler       │  Resolves imports, validates
               │    compileGrammar()      │  references, builds Grammar
               └────────────┬─────────────┘
                            │
               ┌────────────▼─────────────┐
               │    Matching backend      │  matchGrammar() or other
               │    (Grammar → match)     │  backend
               └────────────┬─────────────┘
                            │
                     Matched action object
                     { actionName, parameters }
```

#### Parsing (`.agr` → AST)

The parser in `grammarRuleParser.ts` implements a hand-written recursive
descent parser for the `.agr` grammar syntax. It handles:

- **Entity imports**: `import { CalendarDate, Ordinal };` (no source clause)
- **Sourced imports**: `import { helper } from "./other.agr";` and wildcard imports
- **Rule definitions**: `<RuleName> [annotation] = alternatives ;`
- **Expressions**: string literals, wildcards (`$(var:type)`), rule
  references (`<Rule>`), grouping with `( )`, quantifiers (`?`, `*`, `+`)
- **Value mappings**: `-> { actionName: "play", parameters: { track } }`
- **Comments**: Preserved in the AST for round-trip formatting

The output `GrammarParseResult` (referred to as the "AST" in the
pipeline diagram above) captures the full source structure:

```typescript
GrammarParseResult {
  definitions: RuleDefinition[]   // Named rules with alternatives
  imports: ImportStatement[]       // All imports: entity imports (no source) and sourced imports
}
```

#### Compilation (AST → Grammar)

`grammarCompiler.ts` walks the parsed AST to build the in-memory `Grammar`:

1. Resolves import statements by loading and recursively compiling
   referenced `.agr` files via the `FileLoader` interface — an
   abstraction over file system access that allows the compiler to
   load `.agr` source text by path, supporting both disk-based and
   in-memory file resolution
2. Validates that all rule references (`<RuleName>`) resolve to defined
   rules (within the file or imports)
3. Validates entity references against the global entity registry
4. Compiles value expressions into `CompiledValueNode` trees
5. Resolves spacing mode annotations
6. Type-checks value expressions in two passes (see
   [Validation architecture](#validation-architecture) below)
7. Produces the flat `Grammar` structure ready for matching

### Matching backend

#### Full matching (`matchGrammar`)

`grammarMatcher.ts` provides a direct interpreter over the `Grammar`:

**Algorithm:**

1. Operate directly on the raw request string (no pre-tokenization —
   uses character-by-character regex matching with Unicode-aware
   separator detection: `[\s\p{P}]+`)
2. For each top-level rule alternative, attempt recursive matching
3. At each rule part:
   - **String**: match literal tokens (case-insensitive)
   - **Wildcard**: greedily consume characters, backtrack on failure;
     typed wildcards record the type name but do not validate at match
     time
   - **Rules**: recursively match nested alternatives
4. Backtrack on failure; try next alternative
5. Collect all successful matches (no priority ranking — returns all
   matches to the caller)

**Value construction:** Uses its own `createValue()` function to build
action objects from the captured value tree.

**Trade-offs:** Simple and flexible for complex nesting; character-level
matching handles spacing modes naturally. Backtracking can be expensive
on ambiguous grammars with long inputs. No built-in priority ranking.

#### Completion matching (`matchGrammarCompletion`)

`grammarCompletion.ts` provides `matchGrammarCompletion(grammar, prefix,
minPrefixLength, direction)` which runs a partial match against an
incomplete input prefix and returns the set of valid next-tokens,
enabling real-time autocompletion.

`minPrefixLength` controls the minimum number of characters that must be
matched before completions are offered. When set to a value greater than
zero, rules that consume fewer prefix characters than the threshold are
skipped, preventing overly broad matches on very short inputs.

**Algorithm:**

1. Seed a work-list with one match state per top-level rule. Each state
   tracks the current position in both the rule and the input prefix.
2. Greedily advance each state through the prefix. Track the furthest
   character position any rule consumed (`maxPrefixLength`).
3. When `maxPrefixLength` advances, discard all shorter-prefix completions.
4. Categorize each state's outcome:

| Category           | Condition                                               | Example (`play <song> by <artist>`)     | Forward completion                              | Backward completion                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------- | --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Exact          | Rule fully matched, prefix fully consumed               | `play Never by Nirvana`                 | None                                            | Last matched word/wildcard                                                                                                                                                                        |
| 2 — Clean partial  | Prefix consumed, rule has remaining parts               | `play ` (wildcard next)                 | Next part of rule                               | Previous keyword/wildcard at its start position; or if a partial keyword is detected inside a preceding wildcard (see step 6 below), the partial keyword at its position within the wildcard text |
| 3a — Pending wc    | Wildcard still consuming; no keyword yet finalizes it   | `play Never` (`<song>` still absorbing) | Wildcard property completion                    | Last matched part (if after wc)                                                                                                                                                                   |
| 3b — Dirty partial | Input extends beyond what the current rule part matched | `pla` (`"pla"` ≈ partial `play`)        | Current part (all alternatives; caller filters) | Current part (all alternatives; caller filters)                                                                                                                                                   |

5. Multi-word string parts use `tryPartialStringMatch()` to offer one word
   at a time instead of the entire phrase.

**Note on Category 3b filtering:** In category 3b, the grammar matcher
reports **all** valid completions at the longest matched prefix length
without filtering by the trailing text. For example, with alternatives
`music | movies` and input `"play mx"`, both `"music"` and `"movies"`
are reported at `matchedPrefixLength=4`. The **caller** (shell trie or
CLI) is responsible for filtering the completions against the remaining
text `"mx"`. This applies equally to forward and backward directions.

6. **Partial keyword detection in wildcards** (Category 2, both directions):
   When a wildcard absorbs all remaining input and the next grammar part
   is a keyword, Phase A defers the state (via `WildcardEoiDescriptor`)
   to Phase B1, which calls `findPartialKeywordInWildcard()` to check
   whether the wildcard text ends with a prefix of that keyword. For
   example, with `play <song> by <artist>` and input `"play Never b"`,
   the wildcard absorbs `"Never b"` but `"b"` is a prefix of `"by"`.
   Phase B1 finds the partial keyword and (for backward) collects
   `"by"` at the partial keyword position (after `"Never "`), with
   `afterWildcard="all"`, instead of using the fallback wildcard-start
   candidate from Phase A. For forward, Phase B1 records the partial
   keyword anchor and Phase B2 uses it to emit the completion. This
   handles multi-word keywords as well: for
   `play <song> played by <artist>` and input `"play Never played b"`,
   the function recognizes `"played b"` as a full match of the first
   keyword word plus a partial match of the second, and offers `"by"`.
   The function honors `spacingMode` for inter-word separator matching.

**Why direction matters — reconsidering the last matched part:**

The `direction` parameter (`"forward"` or `"backward"`) is provided by
the host (shell or CLI) to tell the grammar matcher whether to advance
to the next grammar part or back up to the last matched part. The host
determines direction by comparing the current input to the previous
input (see `completion.md` [`CompletionDirection`] for the full pipeline
contract and the design trade-off of host-provided vs. backend-inferred
direction).

The grammar matcher uses `direction` to resolve structural ambiguity at
match boundaries. `directionSensitive` is `true` when
`completion(input[0..P], "backward")` would produce a different result
than `completion(input[0..P], "forward")` — where P is the returned
`matchedPrefixLength`, not the full input length. The caller uses this
to decide whether a direction change
requires a re-fetch: the `partialCompletionSession` re-fetches only
when the user is still at the `matchedPrefixLength` position
(`input === anchor`); once the user types past it, the cached
completions remain usable via trie filtering regardless of direction.
The core rule is simple:

> **`directionSensitive=true` when backward has something to
> reconsider** — a word, keyword, wildcard, or number was fully
> matched. Trailing whitespace does not change this: the grammar
> matcher does not advance P past trailing separators, so the
> matched position remains uncommitted and backward can always
> reconsider.

Forward completion offers what comes _next_ in the grammar. Backward
completion _backs up_ to the last successfully matched part and
re-offers it, letting the user reconsider their choice.

> **Design principle — closest to cursor.** When backward has several
> candidate backup positions (e.g., wildcard start vs. partial keyword
> inside the wildcard), it should prefer the one **nearest the cursor**
> (highest `matchedPrefixLength`). This keeps the user's context:
> `findPartialKeywordInWildcard` embodies this by choosing a partial-
> keyword position over the wildcard start.

**Single-pass backward with range candidates.** The grammar matcher
processes every alternative rule via a work list. For **forward**, this
naturally collects completions from _all_ rules that survive to the
winning prefix length. For **backward**, each rule independently backs
up to its own last matched part — producing completions from only the
_winning_ rule(s), which can miss sibling alternatives.

To make backward non-lossy, the matcher uses **range candidates** —
a single-pass approach that defers sibling-rule resolution to Phase B
(the post-loop conversion step):

1. **Phase A (main loop):** For each state, `collectBackwardCandidate`
   determines the backed-up position _P_ via `tryPartialStringMatch`
   or property completion. When a Category 2 state has a wildcard
   preceding a non-string next part (wildcard/number), a
   `RangeCandidate` is saved directly. When the next part is a string,
   a lightweight `WildcardEoiDescriptor` is saved for Phase B1 instead
   of running `findPartialKeywordInWildcard` inline. This applies to
   both directions under the same condition.
2. **Phase B1 (anchor resolution):** Runs
   `findPartialKeywordInWildcard` on deferred `wildcardEoiDescriptors`.
   For backward, a partial keyword found strictly inside the prefix
   has its position stripped of trailing separators (stripping stops
   at `maxPrefixLength` to avoid discarding previously matched
   content), then collected as a fixed candidate (which may
   advance `maxPrefixLength`, clearing weaker fallback candidates from
   Phase A); otherwise a range candidate is created for Phase B2. For
   forward, the best partial keyword anchor is recorded in
   `forwardPartialKeyword`; states without a partial keyword are
   deferred to `forwardEoiCandidates` for Phase B2.
3. **Phase B2 (materialization):** Converts surviving candidates into
   the final `completions[]` and `properties[]` arrays. Range
   candidates are evaluated: each checks whether `maxPrefixLength`
   falls inside its valid range (`[wildcardStart+1, prefix.length]`)
   and whether the wildcard text at that split is well-formed (via
   `getWildcardStr`). If so, `tryPartialStringMatch` runs forward at
   `maxPrefixLength` to produce sibling completions — the same result
   a dedicated forward pass starting at `maxPrefixLength` would produce,
   but without a second full traversal of the grammar. For forward EOI candidates,
   the anchor is stripped of trailing separators so that P lands before
   the flex-space (consistent with keyword→keyword behavior). When a
   partial keyword consumed to EOI (position = prefix.length), the
   keyword content may end with separator characters (e.g. comma in
   `"hello,"`), so stripping is skipped to avoid removing keyword
   content. Phase B2 also handles exact-match advancement and global
   deduplication.

**Correctness invariant — two-pass equivalence.** Let _P_ =
`completion(input, backward).matchedPrefixLength`. The range-candidate
resolution in Phase B2 must produce the same completions as
`completion(input[0..P], forward)` — i.e., a single backward pass with
range candidates produces the same result as running backward to find _P_
and then re-running forward at _P_ to collect sibling completions.
This invariant is verified by the "two-pass backward invariant" tests.

Range candidates are **skipped** when:

- `afterWildcard="all"` **and** `partialKeywordBackup=false` — the
  backed-up position is at an ambiguous wildcard boundary with no
  partial keyword to pin it. Forward evaluation at the shorter input
  would re-parse with fresh greedy wildcards that absorb different
  text, producing an incorrect structural interpretation. (When
  `partialKeywordBackup=true`, the keyword fragment pins the position
  even though the wildcard boundary is open, so range candidates are
  still processed.)

This rule naturally handles three kinds of ambiguity:

**1. Wildcard-keyword boundary fork.** Consider
`play <song> by <artist>` with input `"play Never by"`:

- **Forward** treats `"by"` as the keyword (the wildcard `<song>`
  captured `"Never"`) and offers completions for `<artist>`.
- **Backward** backs up to the keyword `"by"` at `matchedPrefixLength`
  after `"Never "`, re-offering `"by"` — letting the user extend the
  wildcard (perhaps the song is _Never by Myself_).

**2. Multi-word keyword boundary.** Consider `play music` with input
`"play"`:

- **Forward** offers `"music"` (the next word).
- **Backward** backs up to `"play"` and re-offers it, since the user
  may be reconsidering their input.

**3. Alternation-prefix overlap.** Consider `(play | player) now` with
input `"play"`:

- **Forward** chooses the `"play"` branch (it matched fully), advances
  to the parent, and offers `"now"` at `matchedPrefixLength=4`.
- **Backward** backs up to the matched `"play"` and re-offers it at
  `matchedPrefixLength=0`. Meanwhile, the sibling `"player"` branch
  independently offers `"player"` at `matchedPrefixLength=0` (via
  Category 3b). Both survive because they share the same prefix
  length. The user sees `["play", "player"]` — the alternation
  re-opens.

> **Design note — why always back up (Option A).**
> Option A (always back up when the prefix is fully consumed) makes
> `directionSensitive=true` even for cases where backward reconsidering
> is harmless — e.g., `play <song>` with input `"play"`, where backward
> simply re-offers `"play"` and the user sees the same completion. This
> causes one redundant re-fetch when the user backspaces at that
> position.
>
> An alternative design (Option B) would avoid this by tracking whether
> each match state originated from a multi-alternative `RulesPart` and
> only back up in Category 3a when that alternation flag is set. This
> would preserve `directionSensitive=false` for plain keyword-before-
> wildcard cases. We chose Option A for three reasons:
>
> 1. **Consistency.** Categories 1 and 2 already use the same broad
>    "has a part to reconsider" check (fully consumed prefix with a
>    prior matched part). Having Category 3a use a narrower condition
>    was an unnecessary special case.
> 2. **Correctness.** The extra re-fetch for `play <song>` input
>    `"play"` is harmless — backward simply re-offers `"play"` and
>    the user sees the same wildcard property completion. The cost is
>    one redundant backend call when the user backspaces at that
>    specific position.
> 3. **Simplicity.** Option B required threading a `fromAlternation`
>    flag through match-state expansion, nested-rule finalization, and
>    repeat iterations — new bookkeeping with no user-visible benefit
>    beyond avoiding that one redundant call.

**When direction does _not_ matter (`directionSensitive=false`):**

- **Nothing was fully matched** (e.g., `"pla"` against `play music`):
  There is no completed part to back up to. Both directions produce
  the same partial match (Category 3b) offering `"play"`.

**When both directions agree on the original input despite
`directionSensitive=true`:**

- **Exact match with trailing whitespace** (e.g., `"play music "`
  against `play music`): All grammar parts are satisfied and the
  trailing input is only whitespace/punctuation. Category 1 strips
  the trailing separator via `effectivePrefixEnd` and backs up to the
  last keyword — both directions produce the same backed-up result
  (completions `["music"]` at `matchedPrefixLength=4`,
  `directionSensitive=true`). The flag is `true` because
  `completion("play", "backward")` differs from
  `completion("play", "forward")` — backward re-offers `"play"` at
  P=0, while forward offers `"music"` at P=4. The cross-query is on
  `input[0..P]` = `"play"`, not on the original `"play music "`.

  `"play "` against `play music` behaves the same way:
  `matchedPrefixLength=4` (not 5) and `directionSensitive=true`.
  See "Design choice — trailing separators are not consumed" below
  for the rationale.

### Forward/backward equivalence analysis

Given `input` and `matchPrefixLength` P, does
`completion(input[0..P], "forward")` produce the same result as
`completion(input[0..P], "backward")`?

The answer depends on **where P lands** in the grammar structure, the
**separator mode**, and whether there is a **trailing separator** after
the last matched item.

> **Note — why "committed" rows are hypothetical:** The grammar
> matcher never advances P past a trailing separator (see "Design
> choice — trailing separators are not consumed" below), so P always
> lands at an uncommitted position — `input[0..P]` never ends with a
> separator after the last matched item. The committed rows in the
> tables below cannot occur in practice. They are included to confirm
> that _if_ a caller manually truncated at a committed position, the
> directions would agree — validating that the matcher can safely skip
> trailing separators without introducing incorrect `directionSensitive`
> flags.

**Terminology:**

- **Committed:** a separator character follows the last matched
  word/wildcard in `input[0..P]`
  (i.e. `nextNonSeparatorIndex(input[0..P], endIndex) > endIndex`).
- **Uncommitted:** the last matched item runs to end-of-string with no
  trailing separator.

#### P at a keyword boundary (between parts)

| Mode / Trailing sep                                | Fwd = Bwd? | Why                                                     |
| -------------------------------------------------- | ---------- | ------------------------------------------------------- |
| `required`/`auto` — committed (hypothetical)       | **Yes**    | Separator would commit; nothing to reconsider           |
| `required`/`auto` — uncommitted (EOI)              | **No**     | Backward re-offers keyword; forward offers next part    |
| `optional`/`auto` (CJK) — committed (hypothetical) | **Yes**    | Separator would commit                                  |
| `optional`/`auto` (CJK) — uncommitted              | **No**     | Backward backs up; forward advances                     |
| `none`                                             | **No**     | `couldBackUp` always true when `spacingMode === "none"` |

#### P inside a multi-word keyword (between words of one keyword)

| Mode / Trailing sep                          | Fwd = Bwd? | Why                                 |
| -------------------------------------------- | ---------- | ----------------------------------- |
| `required`/`auto` — committed (hypothetical) | **Yes**    | Separator would commit word K       |
| `required`/`auto` — uncommitted (EOI)        | **No**     | Backward backs up to `prevEndIndex` |
| `optional` — committed (hypothetical)        | **Yes**    | Separator would commit              |
| `optional` — uncommitted                     | **No**     | Backward reconsiders word K         |
| `none`                                       | **No**     | `couldBackUp` always true           |

#### P at a wildcard-keyword boundary (wildcard finalized at EOI, next part is string)

Wildcard boundaries are always ambiguous — the wildcard could absorb
more text, moving the boundary forward. The grammar matcher sets
`afterWildcard="all"` and `directionSensitive=true` unconditionally for
these positions. The table below explains _why_ the directions always
differ at these boundaries.

| Mode / Partial keyword?                          | Fwd = Bwd? | Why                                                                              |
| ------------------------------------------------ | ---------- | -------------------------------------------------------------------------------- |
| non-`none` — no partial keyword                  | **No**     | Forward defers to Phase B2; backward backs up to wildcard start                  |
| non-`none` — partial at Q < P                    | **No**     | Both find partial at Q (via Phase B1), but backward can also back up — ambiguous |
| non-`none` — partial at Q = P (full word at EOI) | **No**     | Forward uses it; backward rejects (Q < `state.index` required)                   |
| `none` — any                                     | **No**     | `couldBackUp` always true                                                        |

#### P inside a wildcard (no keyword boundary reached)

| What follows P?                             | Fwd = Bwd? | Why                                                              |
| ------------------------------------------- | ---------- | ---------------------------------------------------------------- |
| Non-separator text (Cat 3a)                 | **No**     | Forward: property completion; backward: backs up to last keyword |
| Separator / nothing (wildcard just started) | **No**\*   | Backward reconsiders preceding keyword                           |

\* When `lastMatchedPartInfo` exists.

#### P = 0 (nothing matched)

| Scenario                       | Fwd = Bwd? | Why                                                      |
| ------------------------------ | ---------- | -------------------------------------------------------- |
| Partial first keyword (Cat 3b) | **Yes**    | `couldBackUp = false`; backward falls through to forward |

#### P = input.length, all parts matched (Category 1: exact match)

| Scenario            | Fwd = Bwd? | Why                                                         |
| ------------------- | ---------- | ----------------------------------------------------------- |
| All parts satisfied | **Yes**    | Both use `tryCollectBackwardCandidate` — direction-agnostic |

#### Decision tree

The `directionSensitive` flag is computed by the following decision tree,
evaluated once after all candidates are collected using the final
`maxPrefixLength` (P).

```
P = 0?
  └─ Yes → SAME (nothing matched; backward has nothing to reconsider)

P > 0?
  └─ DIFFERENT (something was matched — backward can back up)
```

`minPrefixLength` is not consulted: it is a caller-supplied lower
bound for the search, not a property of the result.

**Key insight:** Once any keyword or wildcard is fully matched (P > 0),
backward can always reconsider that match — regardless of trailing
whitespace. There are no exceptions: even exact matches with trailing
whitespace back up to the last keyword via Category 1
`effectivePrefixEnd` stripping.

**Design choice — trailing separators are not consumed.** The grammar
matcher never advances `matchedPrefixLength` past a trailing separator
in the general case (i.e., when completions or properties exist). For
example, `"play "` against `play music` yields `matchedPrefixLength=4`,
not 5.

Rationale:

1. **Separator mode fidelity.** When P stops before the trailing space,
   `separatorMode` accurately reflects the grammar's spacing annotation
   (e.g., `"spacePunctuation"` for Latin auto-spacing). If P advanced
   past the space, the separator is already present and `separatorMode`
   collapses to `"optional"` — losing the information about what kind of
   separator the grammar expects. The shell needs the un-collapsed mode
   to decide whether a non-space punctuation character should trigger a
   re-fetch.

2. **directionSensitive correctness.** With P before the space, backward
   completion can back up and re-offer the last keyword (the user pressed
   backspace into the space). This is the correct behavior: the trailing
   space is an uncommitted separator — the user can still reconsider.
   Advancing P past the space would force `directionSensitive=false`,
   telling the shell that backspace changes nothing, which would suppress
   the re-offer.

3. **Simpler invariants.** Without trailing-separator advancement,
   P always lands at a keyword boundary where backward can back up —
   no need to distinguish committed vs. uncommitted positions.
   `directionSensitive` reduces to `P > 0`, which is easy to verify.

**Design choice — afterWildcard → always true:** Even when both
directions happen to find the same partial keyword at the same position
(e.g. "play Never b" where both find "b"→"by" at position 10, after
stripping the separator before "b"), the
wildcard boundary is ambiguous. Truncating to `input[0..P]` removes
the content that established the anchor, so
`completion(input[0..P], "backward")` always diverges — confirming
that the position is genuinely direction-sensitive under the cross-query
definition (invariant #7 in `completion.md`). Since P > 0 whenever
`afterWildcard="all"`, the simplified decision tree (`P > 0 → true`)
already covers this case.

**Metadata produced:**

- `matchedPrefixLength` — characters consumed; becomes `startIndex`
  upstream in the completion pipeline.
- `properties` — an array of `GrammarCompletionProperty` entries, each
  carrying a partially-constructed action value and the names of wildcard
  property slots that need entity completions from the agent. The cache and
  dispatcher translate these into agent `getActionCompletion()` calls to
  populate the completion list with domain-specific values (e.g., song
  titles, contact names). When the grammar offers only keyword completions
  (no wildcards), `properties` is empty.

- `separatorMode` — determined by the grammar rule's `[spacing=...]`
  annotation (see [Spacing modes](#spacing-modes) above). Special cases:
  - When `matchedPrefixLength=0` (nothing consumed), `separatorMode` is
    always `"optional"` (or `"none"` for `[spacing=none]` rules) because
    there is no preceding character to require a separator against.
  - When the consumed prefix already ends with whitespace (e.g.,
    `"play "`), `separatorMode` is `"optional"` because the separator is
    already present — no additional separator is needed.
  - For `auto` spacing, `"spacePunctuation"` is produced only when both
    the last consumed character and the first completion character are
    word-boundary scripts (Latin, Cyrillic, etc.) and no separator has
    been consumed; digit–Latin transitions (e.g., `"50"` → `"percent"`)
    produce `"optional"` because digits are Unicode script "Common", not
    a word-boundary script.
- `closedSet` is `true` when all completions are grammar keywords
  (no entity/wildcard values).
- `directionSensitive` — `true` when `completion(input[0..P], backward)`
  would differ from `completion(input[0..P], forward)`, where P =
  `matchedPrefixLength`. True whenever `P > 0` (something was matched
  that backward can back up to). False only when nothing was matched
  (`P = 0`). See "Why direction matters", "Forward/backward equivalence
  analysis", and the decision tree earlier in this document for the
  full rationale.
- `afterWildcard` is `true` when the matched position sits at an ambiguous
  wildcard boundary — see `completion.md` [`afterWildcard`] for the full
  definition (definite vs. ambiguous positions, persistence semantics,
  merge rule).

See `completion.md` for full definitions of how these metadata fields
flow through the cache, dispatcher, and shell layers, and
`completion.md` § Invariants for the full catalog of correctness
invariants, their user-visible impact, and which tests verify them.

### Entity registry

`entityRegistry.ts` provides a global registry (`globalEntityRegistry`)
for typed entity validators and converters:

```typescript
interface EntityValidator {
  validate(token: string): boolean;
}

interface EntityConverter<T> {
  validate(token: string): boolean;
  convert(token: string): T | undefined;
}
```

The registry maps entity type names to their validator/converter
implementations. During grammar compilation, entity references are
validated against this registry. At action construction time,
`convert()` produces the typed runtime value.

### Variable capture

The backtracking matcher uses a linked-list tree of `MatchedValueEntry`
nodes that accumulates captured values during recursive descent. Each
entry links to its predecessor via a `prev` pointer, forming an
immutable chain that naturally supports backtracking — when a branch
fails, the matcher simply discards the chain without needing to undo
writes.

### Serialization

#### JSON format (`.ag.json`)

`grammarSerializer.ts` / `grammarDeserializer.ts` convert between the
in-memory `Grammar` and a JSON representation used for caching and
transport. Rules are de-duplicated via index references to avoid
redundant inline copies of shared sub-rules.

#### Round-trip formatting

`grammarRuleWriter.ts` converts the parse AST back to `.agr` text format
with intelligent line-breaking. It preserves comments from the original
parse, supports compact (single-line) and expanded (multi-line) layouts,
and respects a configurable line-length limit. This enables tooling
workflows where grammars are programmatically modified and re-serialized.

---

## Value Expression Type System

Grammar value expressions (the `-> expression` part of a rule) are
type-checked at compile time. Every expression node has a statically-known
type — there is no `any` escape hatch. This section documents the design
principles and restrictions.

Enable expressions via `enableExpressions: true` in
`LoadGrammarRulesOptions` when your grammar rules need computed values
(arithmetic, conditionals, method calls) in the `->` position.

### Validation Architecture

Type checking runs in two passes, implemented in
`grammarValueTypeValidator.ts` and orchestrated by the compiler in
`grammarCompiler.ts`:

**Pass 1 — Expression-internal consistency** (`validateExprTypes`):
Infers the result type of the expression, validates operator constraints
(e.g. `+` requires matching operand types), and detects unknown
variables, properties, and methods. This pass runs unconditionally —
it only needs variable types derived from grammar parts, not resolved
schema types. Uses a type cache so that child types inferred during
the validation walk are not re-derived.

**Pass 2 — Conformance against declared type** (`validateValueType`):
Checks that the expression's inferred type (from pass 1) is assignable
to the declared output type annotation (e.g. `<Rule> : PlayAction`).
This pass only runs when a `SchemaLoader` resolved the declared types,
so grammars compiled without schema information still get pass 1
coverage.

The compiler collects **leaf values** — the value expressions that
actually produce the rule's output — via `collectLeafValues`, which
uses the shared `classifyRuleValue()` function to categorize each
grammar rule:

| Kind          | Condition                      | Leaf source                                                      |
| ------------- | ------------------------------ | ---------------------------------------------------------------- |
| `explicit`    | Explicit `-> { ... }`          | The compiled value node                                          |
| `variable`    | Single variable, no value      | Variable part (type checked directly via `validateVariableType`) |
| `passthrough` | No variables, single RulesPart | Recurse into sub-rule                                            |
| `none`        | Multi-variable, no value       | Skipped (already warned)                                         |

The `variable` kind ensures that single-variable implicit rules like
`"play" $(x:<Song>)` have their variable's type validated against the
declared output type, rather than silently accepting any capture.
`classifyRuleValue` is also used by `deriveAlternativeType` for type
inference, so both paths share the same classification logic.

### Implicit Value Behavior

When a grammar rule has no explicit `-> value` expression, the compiler
and matcher use `classifyRuleValue()` to determine how the rule produces
its output. The implicit value depends on the rule's structure:

**Single-variable implicit** (`variable` kind): A rule with exactly one
variable part and no explicit value expression passes the variable's
captured value through as the rule's output. For example,
`"play" $(x:<Song>)` produces the value captured by `x`.

**Single-part passthrough** (`passthrough` kind): A rule with no
variable parts and a single `RulesPart` (bare rule reference or nested
group) passes the referenced rule's value through. For example,
`<Greeting> = <Hello> | <Hi>` produces whichever sub-rule matched.

**String literal default** (`default` kind): A rule with no variable
parts and a single string literal or phrase-set part produces the
matched text as a string. For example, `"hello"` produces `"hello"`.

**No value** (`none` kind): Rules with multiple variable parts but no
explicit value expression produce no value — the compiler warns about
this because the output is ambiguous.

### Design Principles

1. **Strict Conformance** — the purpose of type checking is to ensure
   that values produced by the grammar conform to the types declared in
   the schema. If an inferred type is deemed assignable to an expected
   type, then every possible runtime value of the inferred type must be
   a valid value of the expected type. Widening directions that are sound
   are permitted (e.g. `string-union` → `string`, `true`/`false` →
   `boolean`), while unsound widenings are rejected (e.g. bare `string`
   → `string-union`, bare `boolean` → `true`/`false`). When the grammar
   needs a value that conforms to a narrow type (such as a string enum),
   it must use a sub-rule or literal that produces a matching value — a
   bare wildcard capture is not sufficient.
2. **Statically-Typed Expressions** — every node has a known compile-time
   type. Union types (e.g. `string | number` from `??`) are valid
   statically-known types.
3. **No Implicit Coercion** — operators require explicitly compatible types.
   JavaScript's implicit type coercion rules are rejected.
4. **Operators Do One Thing** — `+` is add or concat (not both at once),
   `&&`/`||` are boolean logic, `!` is boolean negation, ternary test must
   be boolean. `typeof` provides runtime type discrimination.
5. **Honest Types for Optional Captures** — `$(x:type)?` produces
   `T | undefined`, reflecting runtime behavior.
6. **Purpose-Built Operators for Nullability** — `??` and `?.` handle
   `T | undefined` from optional captures.
7. **Closed Method Surface** — every whitelisted method has a known return
   type; unusable methods (callbacks, iterators) are excluded.
8. **Errors Suggest Alternatives** — every restriction error tells the user
   what to do instead.

### Expression Type Restriction Table

| Operator              | Required Operand Types                            | Result Type                                   | Error on Violation                                                                                                        |
| --------------------- | ------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `+` (addition)        | `number`, `number`                                | `number`                                      | "Operator '+' requires both operands to be number or both to be string. Use a template literal for string interpolation." |
| `+` (concat)          | `string`, `string`                                | `string`                                      | _(same)_                                                                                                                  |
| `-` `*` `/` `%`       | `number`, `number`                                | `number`                                      | "Operator '{op}' requires both operands to be number."                                                                    |
| `<` `>` `<=` `>=`     | same: both `number` or both `string`              | `boolean`                                     | "Operator '{op}' requires both operands to be the same type (both number or both string)."                                |
| `===` `!==`           | any, any                                          | `boolean`                                     | _(no restriction)_                                                                                                        |
| `&&` `\|\|`           | `boolean`, `boolean`                              | `boolean`                                     | "Operators '&&'/'\|\|' require boolean operands. Use ternary for conditional values."                                     |
| `??`                  | `T \| undefined`, any                             | strip `undefined` from left, union with right | _(no restriction — may produce union types)_                                                                              |
| unary `-`             | `number`                                          | `number`                                      | "Unary '-' requires a number operand."                                                                                    |
| `!`                   | `boolean`                                         | `boolean`                                     | "Operator '!' requires a boolean operand. Use === or !== for equality checks."                                            |
| `typeof`              | any                                               | `string`                                      | _(no restriction)_                                                                                                        |
| ternary `? :` test    | `boolean`                                         | union of both branch types                    | "Ternary '?' test must be a boolean expression."                                                                          |
| `${expr}` interp.     | `string`, `number`, or `boolean` (no `undefined`) | `string`                                      | "Template interpolation does not accept {type}. Use ?? to provide a default first."                                       |
| `?.` (optional chain) | `T \| undefined`                                  | `PropType \| undefined`                       | _(no restriction)_                                                                                                        |

### Optional Captures

`$(x:type)?` produces type `T | undefined` at compile time:

```
$(name:string)?            → type: string | undefined
name ?? "default"          → type: string (undefined stripped)
name?.length               → type: number | undefined
name + " suffix"           → ERROR: operand includes undefined, use ??
`${name}`                  → ERROR: template does not accept undefined
typeof name                → type: string (typeof accepts any type)
name === "hello"           → valid (=== accepts undefined-containing types)
```

### Examples

**Valid:**

```
n * 2                          → number
name + " suffix"               → string (both operands string)
(x > 0) && (y < 10)           → boolean
opt ?? "fallback"              → string (undefined stripped)
opt?.length                    → number | undefined
```

**Invalid (with fix):**

```
"count: " + n                  → ERROR: use `count: ${n}` instead
!x  (non-boolean)              → ERROR: use x !== undefined
x ? a : b  (non-boolean test)  → ERROR: use x > 0 ? a : b
```
