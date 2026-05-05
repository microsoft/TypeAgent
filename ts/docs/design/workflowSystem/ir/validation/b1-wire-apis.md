# B1: Wire APIs and tools from VS Code

Status: Open. Pre-v1.

Source: [`~/doc/workflow/wider-scope.md`](~/doc/workflow/wider-scope.md) §1.B1.

## 1. Scenario

A developer is iterating on a small "summarize a public web page" tool.
The workflow:

1. Fetches the URL via HTTP.
2. Extracts the main text from the HTML.
3. Sends it to an LLM with a summarization prompt.
4. Writes the summary to a file under `~/notes/`.

Concrete shape:

- **Workflow input:** `{ url: string, notesDir: string }`.
- **Workflow output:** `{ path: string, summary: string }`.
- **Behavior:** strictly sequential; each step consumes the previous step's
  output. If the LLM call fails, retry once with a smaller chunk; if it
  fails again, propagate. The file write has no recovery.

Why this scenario complements A4:

- **Linear, no fan-out.** Tests whether the "simple pipeline" case feels
  proportional in v1, or whether the verbosity tax that hurt A4 also
  ruins the simplest possible workflow.
- **Bounded retry.** Tests the §3.8 "recovery routes back to a loop"
  pattern noted in `decisions/0001`'s neighbors and called out
  explicitly in §3.8: _"if a recovery needs to retry the work that
  originally failed, it does so via `next: "@iterate"` in a loop body
  ... not by attaching another `onError` to itself."_ No scenario
  exercises this yet.
- **Side-effecting tail.** The file write produces a value the consumer
  cares about (the path) but its primary purpose is its side effect.
  Tests whether the §3.2.2 "control-flow edge with no DDG counterpart"
  case is observably different from the data-driven case.

## 2. Task inventory

| Task id            | Input                                 | Output                              |
| ------------------ | ------------------------------------- | ----------------------------------- |
| `http.get`         | `{ url: string }`                     | `{ status: integer, body: string }` |
| `html.extractMain` | `{ html: string }`                    | `{ text: string }`                  |
| `text.chunk`       | `{ text: string, maxChars: integer }` | `{ chunks: string[] }`              |
| `llm.summarize`    | `{ text: string, style: string }`     | `{ summary: string }`               |
| `path.join`        | `{ base: string, name: string }`      | `{ path: string }`                  |
| `file.write`       | `{ path: string, content: string }`   | `{ path: string, bytes: integer }`  |

## 3. IR

```jsonc
{
  "kind": "workflow",
  "name": "summarizeUrl",
  "version": "1",

  "inputSchema": {
    "type": "object",
    "required": ["url", "notesDir"],
    "properties": {
      "url": { "type": "string", "format": "uri" },
      "notesDir": { "type": "string" },
    },
  },

  "outputSchema": {
    "type": "object",
    "required": ["path", "summary"],
    "properties": {
      "path": { "type": "string" },
      "summary": { "type": "string" },
    },
  },

  "constants": {
    "summaryStyle": { "schema": { "type": "string" }, "value": "concise" },
    "fullChunkSize": { "schema": { "type": "integer" }, "value": 8000 },
    "smallChunkSize": { "schema": { "type": "integer" }, "value": 2000 },
    "noteName": { "schema": { "type": "string" }, "value": "summary.md" },
    "zero": { "schema": { "type": "integer" }, "value": 0 },
    "one": { "schema": { "type": "integer" }, "value": 1 },
    "retryLabel": { "schema": { "type": "string" }, "value": "retry" },
    "giveUpLabel": { "schema": { "type": "string" }, "value": "giveUp" },
  },

  "nodes": {
    "fetch": {
      "kind": "task",
      "task": "http.get",
      "inputSchema": {
        "type": "object",
        "required": ["url"],
        "properties": { "url": { "type": "string" } },
      },
      "outputSchema": {
        "type": "object",
        "required": ["status", "body"],
        "properties": {
          "status": { "type": "integer" },
          "body": { "type": "string" },
        },
      },
      "inputs": {
        "url": { "$from": "input", "name": "url" },
      },
      "next": "extract",
      "bind": "fetched",
    },

    "extract": {
      "kind": "task",
      "task": "html.extractMain",
      "inputSchema": {
        "type": "object",
        "required": ["html"],
        "properties": { "html": { "type": "string" } },
      },
      "outputSchema": {
        "type": "object",
        "required": ["text"],
        "properties": { "text": { "type": "string" } },
      },
      "inputs": {
        "html": { "$from": "scope", "name": "fetched", "path": ["body"] },
      },
      "next": "summarizeLoop",
      "bind": "extracted",
    },

    /* The summarize-with-retry pattern: a loop bounded at 2 iterations,
       chunk size shrinks per attempt. Per §3.8 this is the v1 way to
       express bounded retry; no recursive recovery exists. */

    "summarizeLoop": {
      "kind": "loop",
      "inputs": {
        "text": { "$from": "scope", "name": "extracted", "path": ["text"] },
      },
      "inputSchema": {
        "type": "object",
        "required": ["text"],
        "properties": { "text": { "type": "string" } },
      },
      "state": {
        "attempt": {
          "schema": { "type": "integer" },
          "initial": { "$from": "constant", "name": "zero" },
        },
        "chunkSize": {
          "schema": { "type": "integer" },
          "initial": { "$from": "constant", "name": "fullChunkSize" },
        },
      },
      "body": {
        "entry": "chunk",
        "nodes": {
          "chunk": {
            "kind": "task",
            "task": "text.chunk",
            "inputSchema": {
              "type": "object",
              "required": ["text", "maxChars"],
              "properties": {
                "text": { "type": "string" },
                "maxChars": { "type": "integer" },
              },
            },
            "outputSchema": {
              "type": "object",
              "required": ["chunks"],
              "properties": {
                "chunks": { "type": "array", "items": { "type": "string" } },
              },
            },
            "inputs": {
              "text": { "$from": "input", "name": "text" },
              "maxChars": { "$from": "state", "name": "chunkSize" },
            },
            "next": "summarize",
            "bind": "chunked",
          },

          "summarize": {
            "kind": "task",
            "task": "llm.summarize",
            "inputSchema": {
              "type": "object",
              "required": ["text", "style"],
              "properties": {
                "text": { "type": "string" },
                "style": { "type": "string" },
              },
            },
            "outputSchema": {
              "type": "object",
              "required": ["summary"],
              "properties": { "summary": { "type": "string" } },
            },
            "inputs": {
              /* Path projection with integer index: chunks[0] gives the
                 first chunk. This is the v1 way to index into an array
                 without a separate list.elementAt task. */
              "text": {
                "$from": "scope",
                "name": "chunked",
                "path": ["chunks", 0],
              },
              "style": { "$from": "constant", "name": "summaryStyle" },
            },
            "next": "@exit",
            "onError": "decideRetry",
            "bind": "summary",
          },

          /* Decide whether to @iterate (retry with smaller chunk) or @exit
             (give up and propagate). attempt=0 means we have one retry left.
             Per decision 0008, discriminants must be strings, so we use
             int.lessThan + bool.toLabel to produce a string selector. */

          "decideRetry": {
            "kind": "task",
            "task": "int.lessThan",
            "inputSchema": {
              "type": "object",
              "required": ["a", "b"],
              "properties": {
                "a": { "type": "integer" },
                "b": { "type": "integer" },
              },
            },
            "outputSchema": {
              "type": "object",
              "required": ["result"],
              "properties": { "result": { "type": "boolean" } },
            },
            "inputs": {
              "a": { "$from": "state", "name": "attempt" },
              "b": { "$from": "constant", "name": "one" },
            },
            "next": "retryLabel",
            "bind": "compared",
          },

          "retryLabel": {
            "kind": "task",
            "task": "bool.toLabel",
            "inputSchema": {
              "type": "object",
              "required": ["value", "ifTrue", "ifFalse"],
              "properties": {
                "value": { "type": "boolean" },
                "ifTrue": { "type": "string" },
                "ifFalse": { "type": "string" },
              },
            },
            "outputSchema": {
              "type": "object",
              "required": ["label"],
              "properties": { "label": { "type": "string" } },
            },
            "inputs": {
              "value": {
                "$from": "scope",
                "name": "compared",
                "path": ["result"],
              },
              "ifTrue": { "$from": "constant", "name": "retryLabel" },
              "ifFalse": { "$from": "constant", "name": "giveUpLabel" },
            },
            "next": "branchRetry",
            "bind": "shouldRetry",
          },

          "branchRetry": {
            "kind": "branch",
            "selector": {
              "$from": "scope",
              "name": "shouldRetry",
              "path": ["label"],
            },
            "selectorSchema": {
              "type": "string",
              "enum": ["retry", "giveUp"],
            },
            "cases": {
              "retry": "bumpAttempt",
              "giveUp": "@exit",
            },
            "default": "@exit",
          },

          /* Increment attempt counter before @iterate. Per decision
             0006 this uses the int.add stdlib task. */

          "bumpAttempt": {
            "kind": "task",
            "task": "int.add",
            "inputSchema": {
              "type": "object",
              "required": ["a", "b"],
              "properties": {
                "a": { "type": "integer" },
                "b": { "type": "integer" },
              },
            },
            "outputSchema": {
              "type": "object",
              "required": ["result"],
              "properties": { "result": { "type": "integer" } },
            },
            "inputs": {
              "a": { "$from": "state", "name": "attempt" },
              "b": { "$from": "constant", "name": "one" },
            },
            "next": "@iterate",
            "bind": "stepped",
          },
        },
      },

      "iterateState": {
        "attempt": { "$from": "scope", "name": "stepped", "path": ["result"] },
        /* shrink to small chunk size on the second attempt */
        "chunkSize": { "$from": "constant", "name": "smallChunkSize" },
      },

      /* Per decision 0009, the loop's output resolves in the full body
         scope at @exit. Body bindings ARE visible, so the summary
         bound on the happy path is directly accessible. No need to
         promote it to state. */

      "output": { "$from": "scope", "name": "summary", "path": ["summary"] },
      "outputSchema": {
        "type": "object",
        "required": ["summary"],
        "properties": { "summary": { "type": "string" } },
      },
      "maxIterations": 2,
      "next": "joinPath",
      "bind": "summarized",
    },

    "joinPath": {
      "kind": "task",
      "task": "path.join",
      "inputSchema": {
        "type": "object",
        "required": ["base", "name"],
        "properties": {
          "base": { "type": "string" },
          "name": { "type": "string" },
        },
      },
      "outputSchema": {
        "type": "object",
        "required": ["path"],
        "properties": { "path": { "type": "string" } },
      },
      "inputs": {
        "base": { "$from": "input", "name": "notesDir" },
        "name": { "$from": "constant", "name": "noteName" },
      },
      "next": "write",
      "bind": "joined",
    },

    "write": {
      "kind": "task",
      "task": "file.write",
      "inputSchema": {
        "type": "object",
        "required": ["path", "content"],
        "properties": {
          "path": { "type": "string" },
          "content": { "type": "string" },
        },
      },
      "outputSchema": {
        "type": "object",
        "required": ["path", "bytes"],
        "properties": {
          "path": { "type": "string" },
          "bytes": { "type": "integer" },
        },
      },
      "inputs": {
        "path": { "$from": "scope", "name": "joined", "path": ["path"] },
        "content": {
          "$from": "scope",
          "name": "summarized",
          "path": ["summary"],
        },
      },
      "bind": "written",
    },
  },

  "entry": "fetch",

  /* Per decision 0007 (template model), the output position accepts
     a template: an object whose values are $from references. This
     constructs the multi-field output without a dedicated assembler
     task. */

  "output": {
    "path": { "$from": "scope", "name": "joined", "path": ["path"] },
    "summary": { "$from": "scope", "name": "summarized", "path": ["summary"] },
  },
}
```

The IR is now complete. All `/* ?? */` markers from the original draft
have been resolved by adopted decisions (0006, 0007, 0008, 0009).

## 4. What hurt

### 4.1 Surprises

**S1. Boolean as enum is awkward.** _(Resolved by
[decision 0008](../decisions/0008-discriminant-key-encoding.md):
discriminants must be strings. The IR above uses `bool.toLabel` to
convert the boolean comparison result to a string selector, and the
branch uses string-typed `"retry"` / `"giveUp"` cases.)_

The original draft had `selectorSchema: { "enum": [true, false] }` with
JSON boolean values as case keys. Decision 0008 resolved this: all
discriminant values must be strings, and `bool.toLabel` converts
booleans to string labels for branching.

**S2. Body-scope `bind`s do not survive `@exit`.** _(Resolved by
[decision 0009](../decisions/0009-loop-output-source.md): `output`
resolves in full body scope at `@exit`, so body bindings ARE visible.
The IR above uses `$from: "scope", name: "summary"` directly.)_

The original draft required promoting the summary to state. Decision
0009 removed that requirement: the loop's `output` reference resolves
in the body scope at `@exit`, where all body bindings from the final
iteration are visible. This eliminates the state-promotion pattern
for loops used as bounded retry.

**S3. No object construction.** _(Resolved by
[decision 0007](../decisions/0007-value-construction-in-references.md):
the template model allows any reference position to hold a JSON object
whose values are `$from` references, evaluated element-wise.)_

The original draft could not construct the workflow's `{ path, summary }`
output from two separate bound nodes. The template model (decision 0007,
Alternative G) closes this gap: the `output` position now holds:

```jsonc
"output": {
  "path":    { "$from": "scope", "name": "joined",     "path": ["path"] },
  "summary": { "$from": "scope", "name": "summarized", "path": ["summary"] },
}
```

No assembler task is needed.

### 4.2 Verbosity tax (working as intended)

Same as A4: per-task schemas, full reference objects. No new findings.

### 4.3 Gaps

**G1. Same expressions gap as A4 S2.** `attempt + 1` uses `int.add`,
`int.lessThan` as a task, `bool.toLabel` for discriminant conversion.
Confirms A4's finding; adds no new evidence beyond multiplicity.
**Adopted:** [`decisions/0006-no-expressions-in-ir.md`](../decisions/0006-no-expressions-in-ir.md).

**G2. The retry-via-loop pattern is correct but not obvious.** §3.8
mentions the "bounded retry uses a loop body" pattern in passing.
With the §3.7 body-vs-state trap (S2), what looks like a 5-line
"call llm.summarize, retry once with smaller chunks" intent becomes a
loop with two state vars, a decision task, a branch, plus an
iterate-state with arithmetic. The decision-tree structure (§3.6
discriminant model) compounds with the loop structure.

This is the shape decision pressure A4 already raised, surfacing again
in a much smaller workflow. **Conclusion: even the simplest realistic
workflow that has any error tolerance hits the same cliff A4 hit.**
The expressiveness gap (S1, S2 in A4; S1, S3 here) is not a corner of
the design - it is on every realistic path.

### 4.4 Decision pressure summary

| Finding                                | Targets                                                                                                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 (boolean discriminant)              | §3.6. **Adopted:** [`decisions/0008-discriminant-key-encoding.md`](../decisions/0008-discriminant-key-encoding.md) (discriminants must be strings; `bool.toLabel` for booleans).                                        |
| S2 (body bindings don't survive @exit) | §3.7. **Adopted:** [`decisions/0009-loop-output-source.md`](../decisions/0009-loop-output-source.md) (`output` resolves in full body scope at `@exit`; body bindings are visible).                                      |
| S3 (no object construction)            | **Strongest finding.** **Accepted:** [`decisions/0007-value-construction-in-references.md`](../decisions/0007-value-construction-in-references.md) (Alternative G, template model). Cross-scenario evidence with A4 S1. |
| G1 (expressions, again)                | Reinforces A4 S2. **Adopted:** [`decisions/0006-no-expressions-in-ir.md`](../decisions/0006-no-expressions-in-ir.md) (no expressions; standard-library tasks; DSL hides them).                                          |
| G2 (retry pattern complexity)          | Reinforces A4. Worth a §3.8 worked example for the bounded-retry pattern specifically.                                                                                                                                  |

## 5. DSL hint

```
workflow summarizeUrl(url: string, notesDir: string) -> { path: string, summary: string } {

  fetched   = http.get(url: url)
  extracted = html.extractMain(html: fetched.body)

  summary = retry(2, shrinkOnRetry: { chunkSize -> chunkSize / 4 }) {
              llm.summarize(text: text.chunk(extracted.text, maxChars: chunkSize)[0],
                            style: "concise")
            }

  path = path.join(base: notesDir, name: "summary.md")
  file.write(path: path, content: summary)

  return { path: path, summary: summary }
}
```

~12 DSL lines vs. ~280 IR lines (~23x compression, higher than A4's
16x because B1 has a higher ratio of "small mechanical operations"
to "real work").

DSL features the IR forces:

- Inline literals (same as A4).
- Expressions (same as A4).
- Object literal in `return { path, summary }`.
- A `retry(N, shrinkOnRetry: ...)` combinator that lowers to the loop+state pattern.
- Field projection sugar (`fetched.body` instead of `{ $from, name, path }`).

Of these, only `retry` is genuinely a control-flow combinator; the rest
are pure surface concerns the IR's lack of literals and lack of
expressions force. **The "DSL is mostly compensating for missing IR
expressiveness rather than adding genuine new abstractions"** is the
B1 finding for the DSL track. That asymmetry is worth understanding
before committing to a DSL design.

## 6. Engine implications

Beyond the A4 set, this scenario adds:

- **Loop with maxIterations=2 used as bounded retry.** No new engine
  capability, but worth a test case: at iteration 2, if `branchRetry`
  selects `@iterate` again, the engine should fail the loop with the
  `LoopMaxIterationsExceeded` runtime error (§3.8.1) and that failure
  should surface as the workflow failure (loop has no `onError`).
- **String discriminants via `bool.toLabel`.** Per decision 0008, the
  engine resolves the selector and looks up the string case key
  directly; no coercion needed.
- **Body-scope `output` resolution.** Per decision 0009, the engine
  resolves the loop's `output` in the body scope at `@exit`, where
  body bindings from the final iteration are visible.
- **Template model in workflow `output`.** Per decision 0007, the
  engine evaluates a template object (with two `$from` refs) to
  construct the multi-field workflow output.

All of these are already implemented in the stub engine.
