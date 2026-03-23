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
  annotation (see [Spacing modes](#spacing-modes) above).
  The dispatcher may override to `"space"` for structured commands
  (e.g., `@agent` prefixes, flags). When `matchedPrefixLength=0`
  (nothing consumed), `separatorMode` is always `"optional"` (or
  `"none"` for `[spacing=none]` rules) because there is no preceding
  character to require a separator against.
- `closedSet` is `true` when all completions are grammar keywords
  (no entity/wildcard values).
- `directionSensitive` is `true` when the matched state has a fully
  matched word without a trailing separator — meaning backward
  completion would produce different results (see `completion.md`
  for how downstream layers use this field).
- `openWildcard` is `true` when the matched position sits at an ambiguous
  wildcard boundary (e.g., a wildcard finalized at end-of-input in the
  forward direction, or a keyword that had pinned a wildcard's end in the
  backward direction).

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

---

## Value Expression Type System

Grammar value expressions (the `-> expression` part of a rule) are
type-checked at compile time. Every expression node has a statically-known
type — there is no `any` escape hatch. This section documents the design
principles and restrictions.

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

### Design Principles

1. **Statically-Typed Expressions** — every node has a known compile-time
   type. Union types (e.g. `string | number` from `??`) are valid
   statically-known types.
2. **No Implicit Coercion** — operators require explicitly compatible types.
   JavaScript's implicit type coercion rules are rejected.
3. **Operators Do One Thing** — `+` is add or concat (not both at once),
   `&&`/`||` are boolean logic, `!` is boolean negation, ternary test must
   be boolean. `typeof` provides runtime type discrimination.
4. **Honest Types for Optional Captures** — `$(x:type)?` produces
   `T | undefined`, reflecting runtime behavior.
5. **Purpose-Built Operators for Nullability** — `??` and `?.` handle
   `T | undefined` from optional captures.
6. **Closed Method Surface** — every whitelisted method has a known return
   type; unusable methods (callbacks, iterators) are excluded.
7. **Errors Suggest Alternatives** — every restriction error tells the user
   what to do instead.

### Expression Type Restriction Table

| Operator              | Required Operand Types                            | Result Type                                   | Error on Violation                                                                                                        |
| --------------------- | ------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --- | ---------------------------------------------------------------- |
| `+` (addition)        | `number`, `number`                                | `number`                                      | "Operator '+' requires both operands to be number or both to be string. Use a template literal for string interpolation." |
| `+` (concat)          | `string`, `string`                                | `string`                                      | _(same)_                                                                                                                  |
| `-` `*` `/` `%`       | `number`, `number`                                | `number`                                      | "Operator '{op}' requires both operands to be number."                                                                    |
| `<` `>` `<=` `>=`     | same: both `number` or both `string`              | `boolean`                                     | "Operator '{op}' requires both operands to be the same type (both number or both string)."                                |
| `===` `!==`           | any, any                                          | `boolean`                                     | _(no restriction)_                                                                                                        |
| `&&` `\|\|`           | `boolean`, `boolean`                              | `boolean`                                     | "Operators '&&'/'                                                                                                         |     | ' require boolean operands. Use ternary for conditional values." |
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
