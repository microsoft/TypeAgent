# Action Grammar

A grammar engine for [TypeAgent](../../README.md) that parses, compiles, and matches natural language input against grammar rules to produce structured JSON action objects. It converts user utterances like `"play Shape of You by Ed Sheeran"` into typed actions like `{ actionName: "play", parameters: { track: "Shape of You", artist: "Ed Sheeran" } }`.

Grammar rules are defined in **`.agr` files** — a custom DSL that supports literals, wildcards, alternation, optionals, repetition, rule references, imports, and entity declarations.

## Architecture

```
.agr file → parseGrammarRules() → GrammarParseResult (AST)
                                       ↓
                                 compileGrammar() → Grammar (in-memory)
                                       ↓
              ┌────────────────────────┴────────────────────────┐
              │ Recursive Backtracking                          │ NFA/DFA Pipeline
              │ matchGrammar()                                  │ compileGrammarToNFA()
              │                                                 │       ↓
              │                                                 │   matchNFA()
              │                                                 │       ↓
              │                                                 │ compileNFAToDFA()
              │                                                 │       ↓
              │                                                 │   matchDFA()
              └─────────────────────────────────────────────────┘
```

Two matching backends are available, each with different trade-offs:

- **Recursive backtracking matcher** (`matchGrammar()`) — Operates directly on the `Grammar` AST with backtracking for wildcards and nested rules. Simpler and more flexible for certain grammar patterns.
- **NFA/DFA pipeline** (`compileGrammarToNFA()` → `matchNFA()` / `matchDFA()`) — Compiles grammar to a token-based NFA with parallel execution threads, epsilon closures, and priority-based result selection; optionally further compiled to a deterministic DFA for faster matching.

## `.agr` Grammar Syntax

```agr
entity CalendarDate, Ordinal;                         // Entity declarations
import { Helper } from "./other.agr";                 // Grammar imports

<Start> = <PlaySong> | <SkipTrack>;                   // Start rule
<PlaySong> [spacing=optional] =                        // Spacing annotation
    play $(track:wildcard) by $(artist:wildcard)        // Wildcards with captures
    -> { actionName: "play",                            // Action value expression
         parameters: { track, artist } };
<SkipTrack> = (skip | next) (track | song)?            // Optionals, alternation
    -> { actionName: "skip" };
<Items> = $(item:string) (, $(item:string))*;          // Repetition (Kleene star)
```

## Exports

The package exposes three entry points:

### Main (`"."`)

Core grammar types, parsing, compilation, matching, serialization, entity system, NFA/DFA system, and dynamic loading:

| Category                | Key Exports                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Loading/Parsing**     | `loadGrammarRules()`, `loadGrammarRulesNoThrow()`, `parseGrammarRules()`                                                         |
| **Serialization**       | `grammarToJson()`, `grammarFromJson()`                                                                                           |
| **Recursive Matching**  | `matchGrammar()`, `matchGrammarCompletion()`                                                                                     |
| **NFA/DFA**             | `NFA`, `compileGrammarToNFA()`, `matchNFA()`, `matchNFAWithIndex()`, `buildFirstTokenIndex()`, `compileNFAToDFA()`, `matchDFA()` |
| **Writer**              | `writeGrammarRules()`                                                                                                            |
| **Entity System**       | `EntityRegistry`, `globalEntityRegistry`, `createValidator()`, `createConverter()`                                               |
| **Built-in Entities**   | `Ordinal`, `Cardinal`, `CalendarDate`, `CalendarTime`, `CalendarTimeRange`, `CalendarDayRange`                                   |
| **Phrase Set Matchers** | `globalPhraseSetRegistry`, `PhraseSetMatcher`                                                                                    |
| **Dynamic Loading**     | `DynamicGrammarLoader`, `DynamicGrammarCache`                                                                                    |
| **Environment**         | `Environment`, `SlotMap`, `SlotAssignment`, `ValueExpression`                                                                    |

### Rules (`"./rules"`)

Lightweight export for tooling — exposes parser AST types and the pretty-printer:

- `ValueNode`, `Expr`, `Rule`, `RuleDefinition`
- `writeGrammarRules()`

### Generation (`"./generation"`)

LLM-powered grammar generation from schemas and examples:

- `ClaudeGrammarGenerator` — Uses Claude to analyze request/action pairs and generate grammar rules
- `SchemaToGrammarGenerator` — Auto-generates `.agr` grammar from a full action schema (`.pas.json`)
- `ScenarioBasedGrammarGenerator` — Generates grammar using predefined scenario templates
- `loadSchemaInfo()`, `SchemaInfo`, `ActionInfo` — Schema reading utilities

## Key Source Files

| File                       | Purpose                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `grammarRuleParser.ts`     | Recursive descent parser for `.agr` files                                 |
| `grammarCompiler.ts`       | Compiles parsed rules into the in-memory `Grammar` representation         |
| `grammarTypes.ts`          | Types for in-memory and serialized grammar representations                |
| `grammarMatcher.ts`        | Recursive backtracking matcher and completion system                      |
| `nfaCompiler.ts`           | Compiles `Grammar` → token-based NFA with slot-based variable capture     |
| `nfaInterpreter.ts`        | Parallel NFA execution with priority ranking                              |
| `dfaCompiler.ts`           | NFA→DFA subset construction                                               |
| `dfaMatcher.ts`            | DFA-based matching and completion                                         |
| `entityRegistry.ts`        | Entity registry with validators and converters                            |
| `builtInEntities.ts`       | Built-in entity converters (dates, times, ordinals, cardinals)            |
| `builtInPhraseMatchers.ts` | Phrase set registry (Polite, Greeting, Acknowledgement, FillerWord)       |
| `environment.ts`           | Slot-based environment system for NFA/DFA variable capture                |
| `grammarStore.ts`          | Persists dynamically generated grammar rules with auto-save               |
| `grammarMerger.ts`         | Utilities for merging and combining grammars                              |
| `grammarMetadata.ts`       | Enriches grammars with checked-variable metadata from `.pas.json` schemas |
| `dynamicGrammarLoader.ts`  | Runtime rule loading, entity validation, NFA compilation                  |
| `agentGrammarRegistry.ts`  | Per-agent grammar management with dynamic rule addition                   |
| `grammarRuleWriter.ts`     | Pretty-prints grammar parse results back to `.agr` format                 |

## File Formats

| Format      | Description                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `.agr`      | Source grammar files — human-readable DSL with entities, imports, rules, wildcards, and value expressions |
| `.ag.json`  | Compiled grammar JSON (`GrammarJson`) for sharing/caching without re-parsing                              |
| `.pas.json` | Parsed Action Schema JSON (from `action-schema`) used for checked-variable enrichment                     |

## Building

```bash
# Build
npm run build

# Run unit tests
npm test

# Run integration tests (requires API keys)
npm run test:integration
```

## Dependencies

| Dependency                  | Purpose                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `action-schema` (workspace) | Reading `.pas.json` schema files for checked-variable enrichment                      |
| `debug`                     | Debug logging (`typeagent:grammar:*`, `typeagent:nfa:*`, `typeagent:actionGrammar:*`) |
| `regexp.escape`             | Safe regex escaping for the legacy matcher                                            |

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
