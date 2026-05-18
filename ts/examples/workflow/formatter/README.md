# workflow-formatter (`wff`)

Command-line pretty-printer for the [workflow DSL](../dsl/). Wraps the
`format()` function from `workflow-dsl` with a CLI patterned after `prettier`
and `rustfmt`.

## Usage

```
wff <files...> [options]

Modes (mutually exclusive):
  (default)            Rewrite each file in place (atomic via tmp + rename).
  -c, --check          Exit 1 if any file would be changed; print the list.
      --stdout         Print formatted output to stdout (single input or stdin).
      --diff           Print a unified diff per changed file; exit 1 if any.

Input:
  <files...>           One or more .wf source files. If no files are given and
                       stdin is not a TTY, source is read from stdin and the
                       formatted result is written to stdout.
  --stdin-filepath <p> Display name used in diagnostics for stdin input.

Formatting options:
  --indent <N>         Spaces per indent (default 4).
  --eol <lf|crlf|cr>   Line ending (default lf).
  --print-width <N>    Soft column limit (default 100). Accepts a non-negative
                       integer or 'infinity'.

Misc:
  -h, --help           Show help.
```

## Examples

Rewrite a workflow file in place:

```sh
wff my.wf
```

Check formatting in CI / pre-commit:

```sh
wff --check examples/workflow/dsl/examples/*.wf
```

Pipeline: lint -> format -> compile:

```sh
cat my.wf | wff --stdin-filepath my.wf | wfc - -o my.json
```

Show what would change:

```sh
wff --diff my.wf
```

## Error format

Diagnostics are printed to stderr as:

```
<file>:<line>:<col> [<phase>] <message>
```

where `<phase>` is `lex` or `parse`. If any input file fails to parse, that
file is left untouched and `wff` exits with status 1. The formatter never
writes a partially-formatted file.

## Exit codes

| Code | Meaning                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- |
| 0    | Success; in `--check` / `--diff` modes, all files already formatted.                         |
| 1    | `--check` / `--diff`: at least one file would be changed; or a parse/lex error in any input. |
| 2    | Argument / option error.                                                                     |

## Relationship to other workflow tools

| Tool                                      | Purpose                                | Depends on                                          |
| ----------------------------------------- | -------------------------------------- | --------------------------------------------------- |
| `wff` (this package)                      | `.wf` source -> formatted `.wf` source | `workflow-dsl`                                      |
| `wfc` ([workflow-compiler](../compiler/)) | `.wf` source -> IR JSON                | `workflow-dsl`, `workflow-engine`, `workflow-model` |
| `workflow` ([workflow-cli](../cli/))      | Run / validate IR JSON                 | `workflow-engine`, `workflow-model`                 |

`wff` is intentionally the smallest tool of the three: it only needs the
lexer, parser, and formatter from `workflow-dsl`, so it stays fast to invoke
from editors and pre-commit hooks.
