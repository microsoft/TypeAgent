# workflow-compiler (`wfc`)

Command-line compiler for the [workflow DSL](../dsl/). Takes a `.wf` source
file and emits the workflow IR JSON consumed by `workflow run` (from the
[workflow-cli](../cli/) package).

## Usage

```
wfc <file.wf> [options]

Options:
  -o, --out <file>     Write IR to <file>. Defaults to <input>.json next to
                       the input. Use "-" to write to stdout.
  --no-validate        Skip IR validation after emit (validation is on by default).
  --pretty             Pretty-print the JSON output (default).
  --compact            Emit minified JSON (no whitespace).
  -h, --help           Show help.
```

## Examples

Compile a workflow alongside the source:

```sh
wfc ../workflows/dsl/d1-standup-prep.wf
# wrote ../workflows/dsl/d1-standup-prep.json
```

Pipe the IR into `workflow run`:

```sh
wfc my.wf -o - | workflow run -
```

## Error format

Diagnostics are printed to stderr as:

```
<file>:<line>:<col> [<phase>] <message>
```

where `<phase>` is one of `lex`, `parse`, `typecheck`, `emit`, or `validate`.
The process exits with status 1 if any errors were reported.

## Relationship to the runner

`wfc` is build-time only. It depends on `workflow-dsl` (the compiler library)
and on `workflow-engine` solely to read the JSON Schemas of the built-in tasks
so user workflows can type-check against them. It does not import or run any
task implementations.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
