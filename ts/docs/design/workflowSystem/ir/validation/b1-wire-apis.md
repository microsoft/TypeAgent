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
              /* ?? we want chunks[0] - first attempt - or some join across chunks.
                 Either way: indexing requires another task or we just take
                 the first chunk. Using path projection on bound output. */
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
             (give up and propagate). attempt=0 means we have one retry left. */

          "decideRetry": {
            "kind": "task",
            "task": "int.lt" /* ?? same standard-library task as A4 S2 */,
            "inputSchema": {
              "type": "object",
              "required": ["a", "b", "error", "trigger"],
              "properties": {
                "a": { "type": "integer" },
                "b": { "type": "integer" },
                "error": { "$ref": "#/types/Error" },
                "trigger": { "type": "object" },
              },
            },
            "outputSchema": {
              "type": "object",
              "required": ["lt"],
              "properties": { "lt": { "type": "boolean" } },
            },
            "inputs": {
              "a": { "$from": "state", "name": "attempt" },
              "b": { "$from": "constant", "name": "one" },
            },
            "next": "branchRetry",
            "bind": "shouldRetry",
          },

          "branchRetry": {
            "kind": "branch",
            "selector": {
              "$from": "scope",
              "name": "shouldRetry",
              "path": ["lt"],
            },
            "selectorSchema": {
              "enum": [true, false],
            } /* ?? boolean as enum */,
            "cases": {
              "true": "@iterate",
              "false": "@exit",
            },
            "default": "@exit",
          },
        },
      },

      "iterateState": {
        /* attempt += 1 - same int.add gap as A4 S2 */
        "attempt": {
          /* ?? want attempt + 1 */
        },
        /* shrink to small chunk size on the second attempt */
        "chunkSize": { "$from": "constant", "name": "smallChunkSize" },
      },

      /* The loop's output is whichever path reached @exit:
         - happy path: summary was bound, but it was bound in a body
           scope that does not survive @exit, so we need to thread it
           through state - or accept that @exit-on-failure means
           "no summary".

         This is the second surprise (S2 below): scope variables in the
         body do not survive @exit. The loop's `output` reference can
         only resolve against `state`, never against body scope.
         Therefore the summary must be promoted to state. */

      "output": { "$from": "state", "name": "lastSummary" },
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

  /* The output joins the joined path and the summary text.
     There is no inline-object construction; we have to point at one
     place. Either we read the bound `written` (which has path) plus
     `summarized` (which has summary), OR we add a task whose only job
     is to assemble the output object. v1 forces the assembler. */

  "output": {
    /* ?? cannot construct { path, summary } from two refs */
  },
}
```

The IR is incomplete in three places, marked `/* ?? */`. Each is a
finding.

## 4. What hurt

### 4.1 Surprises

**S1. Boolean as enum is awkward.** The branch on `shouldRetry.lt` has
`selectorSchema: { "enum": [true, false] }`. v1 §3.6 says the selector
schema is "JSON Schema with `enum` or string-typed discriminant"; a
boolean fits but cases must be the _strings_ `"true"` and `"false"` (or
the JSON literals `true`/`false`?). The IR doesn't say which; the
example `cases` map keys are JSON strings by definition (object key
type), but the discriminant value is a boolean. The validator has to
do JSON-to-string coercion to look up the case, which is exactly the
kind of implicit conversion P5 disallows.

Decision pressure: §3.6 needs a sentence on what the legal `cases` key
form is when the discriminant is non-string. Three options:

1. **Discriminants must be strings.** Rule out boolean and integer
   selectors; force authors to wrap in `int.toString` or
   `bool.toString`. Most P5-pure, most verbose.
2. **`cases` keys are JSON-stringified discriminant values.** What the
   draft seems to assume but does not state. A `true` discriminant
   matches case key `"true"`. Has hidden coercion (P5 risk) but is the
   pragmatic answer.
3. **`cases` keys may be any JSON literal.** Rewrites `cases` from a
   JSON object (string keys only) to a JSON array of `{value, target}`
   pairs. Most general, biggest schema change.

The current text papers over this. The scenario forces the choice.

**S2. Body-scope `bind`s do not survive `@exit`.** The retry loop's
"happy path" binds `summary` in the body, then takes `@exit`. The
loop's `output` reference resolves _after_ body scope tears down, so
it can only read from `state` (and constants/loop-inputs, which don't
help here). To export the summary, it has to be promoted to state -
i.e., declared as a state variable initialized to `null`-or-similar
(another constant!), assigned in the body, and read by `output`.

This is technically consistent with §3.7 ("`output` is resolved when
the body reaches `@exit`. It is a single reference object resolved in
the body scope") - wait, the spec says "resolved in the body scope",
which would suggest body bindings _should_ be visible. Re-reading:
"typically against `state`, since per-iteration scope variables do
not survive across iterations". So the spec acknowledges this and
expects authors to thread through state.

Decision pressure: this is one more thing the §1.2 verbosity tax
quietly imposes. The §3.7 wording is correct but easy to miss. The
scenario suggests adding a worked example: "to surface a single
body-computed value through `output`, declare it as state with
`initial: null`, write it on the success path, and read it from
`output`." Without that, every loop with a single answer per run
trips over this.

A larger question: the rule "scope vars don't survive `@iterate` so
they can't survive `@exit`" makes `@iterate` and `@exit` symmetric
and that's clean. But for a loop that is being used as a bounded
retry rather than as iteration over a list, this symmetry costs.
Worth a note in §3.7 or its own decision record.

**S3. No object construction.** The workflow's top-level `output` wants
`{ path: ..., summary: ... }`. The two values exist in different bound
nodes (`joined.path` and `summarized.summary`). There is no way to
build a fresh object from two references; `output` is one reference
object. So the IR needs an `assemble` task whose only job is:

```jsonc
"assemble": {
  "kind": "task", "task": "obj.fromFields",
  "inputs": { "path": { "$from": "scope", "name": "joined",     "path": ["path"] },
              "summary": { "$from": "scope", "name": "summarized", "path": ["summary"] } },
  "outputSchema": { "type": "object", ... },
  "bind": "result"
}
```

and `output` then resolves `{ "$from": "scope", "name": "result" }`.
This is the same shape as the loop's `output` problem (S2): every
value-producing scope can publish exactly one named value, which is
fine when there is one, painful when there are several.

Decision pressure: this collides with S1 from A4 (literals) and S2
from A4 (expressions). Together they argue for **a record-construction
form in references**, e.g.:

```jsonc
"output": {
  "$build": {
    "path":    { "$from": "scope", "name": "joined",     "path": ["path"] },
    "summary": { "$from": "scope", "name": "summarized", "path": ["summary"] }
  }
}
```

This is a behavioral rule the existing concepts do not cover (it lets
a reference position assemble a new value rather than project from one)
and it has clear analogs in any structured-data system (record literals
in TypeScript, struct construction in Rust). It would close A4 S1
(constants become inline values), would close B1 S3, and would make
the "thread one value through state to surface from a loop" pattern
much less ad-hoc.

This is the strongest cross-scenario finding so far. Worth a
`decisions/0007-value-construction-in-references.md`.

### 4.2 Verbosity tax (working as intended)

Same as A4: per-task schemas, full reference objects. No new findings.

### 4.3 Gaps

**G1. Same expressions gap as A4 S2.** `attempt + 1`, `int.lt` as a
task, `int.toString` if we keep the boolean-discriminant workaround.
Confirms A4's finding; adds no new evidence beyond multiplicity.

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
| S1 (boolean discriminant)              | §3.6. **Suggested:** clarification edit + maybe `decisions/0008-discriminant-key-encoding.md`.                                                                                                                          |
| S2 (body bindings don't survive @exit) | §3.7 wording + worked example. Possibly `decisions/0009-loop-output-source.md` if the symmetric rule is to be defended.                                                                                                 |
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
- **Boolean discriminants.** Pending the S1 decision, the engine has
  to either coerce or reject. Tests for both directions belong here.
- **Body-scope vs. state-scope `output` resolution.** Pending the S2
  decision, the engine has to enforce that `output` only reads from
  state + loop-inputs + constants, not body scope vars.

Still well within the "200-line engine" budget. The harder thing v1
asks the engine to do (per A4) is dominator analysis at validation
time, not anything at runtime.
