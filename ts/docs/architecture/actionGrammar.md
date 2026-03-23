# Action Grammar — Architecture & Design

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
entity CalendarDate, Ordinal;              // Entity type declarations
import { helper } from "./other.agr";      // Named import
import * from "./global.agr";             // Wildcard import
```

Entity declarations register typed validators (see [Entities](#entities)
below). Imports pull rules from other `.agr` files:

- **Named imports** (`import { helper } from "./other.agr"`) bring in
  specific named rules from the target file.
- **Wildcard imports** (`import * from "./global.agr"`) import all rules
  and entity declarations from the target file into the current scope.
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
A grammar declares which entity types it uses (`entity CalendarDate;`),
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

- **Entity declarations**: `entity CalendarDate, Ordinal;`
- **Imports**: `import { helper } from "./other.agr";` and wildcard imports
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
  imports: ImportStatement[]       // File imports
  entities: string[]               // Entity declarations
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
6. Produces the flat `Grammar` structure ready for matching

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

`matchGrammarCompletion(grammar, prefix, minPrefixLength)` runs a partial
match against an incomplete input prefix and returns the set of valid
next-tokens, enabling real-time autocompletion.

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

**Why direction matters — reconsidering the last matched part:**

The `direction` parameter (`"forward"` or `"backward"`) is provided by
the host (shell or CLI) to tell the grammar matcher whether to advance
to the next grammar part or back up to the last matched part. The host
determines direction by comparing the current input to the previous
input (see `completion.md` [`CompletionDirection`] for the full pipeline
contract and the design trade-off of host-provided vs. backend-inferred
direction).

The grammar matcher uses `direction` to resolve structural ambiguity at
match boundaries. The core rule is simple:

> **`directionSensitive=true` when backward has something to
> reconsider** — a word, keyword, wildcard, or number was fully
> matched with no trailing separator to commit it.

Forward completion offers what comes _next_ in the grammar. Backward
completion _backs up_ to the last successfully matched part and
re-offers it, letting the user reconsider their choice.

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
> An alternative design (Option B) would track whether each match state
> originated from a multi-alternative `RulesPart` and only back up in
> Category 3a when that alternation flag is set. This would preserve
> the previous `directionSensitive=false` for plain keyword-before-
> wildcard cases like `play <song>` (input `"play"`). We chose the
> simpler Option A — always back up when the prefix is fully consumed
> — for three reasons:
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
- **Trailing separator commits:** A trailing space (or punctuation)
  after a keyword "commits" the match position — the user has moved
  past the boundary. Both directions agree on the committed position.
  For example, `"play "` (with space) offers `"music"` for both
  directions. Exception: in `[spacing=none]` mode, whitespace is not a
  separator, so `directionSensitive` is always `true` when any word has
  been fully matched — trailing spaces do not commit.

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
- `directionSensitive` is `true` when backward completion has something
  to reconsider — a word, keyword, wildcard, or number was fully matched
  with no trailing separator to commit it. See "Why direction matters"
  above for examples. It is `false` when nothing was fully matched
  (Category 3b partial) or when a trailing separator commits the
  position.
  For exact matches (Category 1),
  it is `true` when the rule contains a wildcard, a number variable,
  a sub-rule variable capture, or a multi-part keyword — any part
  that backward completion could reconsider.
- `openWildcard` is `true` when the matched position sits at an ambiguous
  wildcard boundary (e.g., a wildcard finalized at end-of-input in the
  forward direction, or a keyword that had pinned a wildcard's end in the
  backward direction). `openWildcard` remains `true` even after the user
  types the full keyword text (e.g., `"play hello by"` and
  `"play hello by "`) because the grammar matcher always forks two parse
  paths at a wildcard-keyword boundary: one where the keyword is consumed,
  and one where the wildcard absorbs the keyword text. Both paths produce
  completions at the same prefix length, so neither can eliminate the
  other. `openWildcard` only becomes `false` when the ambiguity is
  structurally resolved by further context (e.g., the user types enough
  after the keyword that the wildcard-absorbing path can no longer produce
  a match at the same prefix length).

See `completion.md` for full definitions of how these metadata fields
flow through the cache, dispatcher, and shell layers.

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
