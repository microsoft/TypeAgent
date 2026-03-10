# Action Grammar Compiler

A CLI tool for compiling and formatting `.agr` (Action Grammar) files. It wraps the [action-grammar](../actionGrammar/README.md) library's parsing and serialization APIs behind an [oclif](https://oclif.io)-based command-line interface.

## Installation

The package provides two CLI entry points:

- **`agc`** — production binary
- **`agc-dev`** — development binary (with ts-node loader)

Both support a legacy invocation style: if the first argument isn't a recognized command name, the `compile` command is assumed automatically.

## Commands

### `compile`

Compiles an `.agr` grammar file into `.ag.json` format.

```bash
agc compile -i input.agr -o output.ag.json
```

| Flag       | Alias | Required | Description                    |
| ---------- | ----- | -------- | ------------------------------ |
| `--input`  | `-i`  | Yes      | Input `.agr` grammar file path |
| `--output` | `-o`  | Yes      | Output JSON file path          |

**Flow:**

1. Parses the `.agr` file via `loadGrammarRulesNoThrow()` from `action-grammar`
2. Reports any errors/warnings; exits with code 1 on parse failure
3. Serializes the parsed `Grammar` to JSON via `grammarToJson()`
4. Writes the `.ag.json` output, creating directories as needed

### `format`

Formats (pretty-prints) `.agr` grammar files — analogous to `prettier` but for the `.agr` DSL.

```bash
agc format -i input.agr -w        # Format in-place
agc format -i input.agr -c        # Check formatting (CI mode)
agc format -i input.agr -o out.agr # Write to different file
agc format -i input.agr            # Print to stdout
```

| Flag       | Alias | Required | Description                                             |
| ---------- | ----- | -------- | ------------------------------------------------------- |
| `--input`  | `-i`  | Yes      | Input `.agr` file                                       |
| `--write`  | `-w`  | No       | Overwrite input file in-place                           |
| `--output` | `-o`  | No       | Write formatted output to a different file              |
| `--check`  | `-c`  | No       | Exit non-zero if file isn't already formatted (CI mode) |

**Flow:**

1. Parses the `.agr` file via `parseGrammarRules()`
2. Re-serializes via `writeGrammarRules()` to produce canonical formatting
3. Writes or checks output based on the flags provided

## Architecture

```
.agr file
    │
    ▼
agc compile -i input.agr -o output.ag.json
    │
    ├─ loadGrammarRulesNoThrow()  ← action-grammar (parser)
    │       ↓
    │   Grammar object (in-memory AST)
    │       ↓
    ├─ grammarToJson()            ← action-grammar (serializer)
    │       ↓
    └─ .ag.json file (compiled grammar)

agc format -i input.agr -w
    │
    ├─ parseGrammarRules()        ← action-grammar (parser)
    │       ↓
    │   ParseResult (in-memory AST)
    │       ↓
    ├─ writeGrammarRules()        ← action-grammar (writer)
    │       ↓
    └─ Formatted .agr text
```

This package is a thin CLI wrapper — all parsing, compilation, and serialization logic lives in the [action-grammar](../actionGrammar/README.md) library.

## Exports

The package exports a `COMMANDS` object for oclif's explicit command registration:

```typescript
import { COMMANDS } from "action-grammar-compiler";
// { compile: Compile, format: Format }
```

This is a CLI-only package. For programmatic grammar APIs, use `action-grammar` directly.

## Building

```bash
npm run build
```

## Dependencies

| Dependency                   | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `action-grammar` (workspace) | Core grammar parsing, serialization, and formatting APIs |
| `@oclif/core`                | CLI framework (command parsing, flags, help)             |
| `@oclif/plugin-help`         | Auto-generated `--help` output                           |

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
