# A4: Morning brief

Status: Open. Pre-v1.

Source: [`~/doc/workflow/wider-scope.md`](~/doc/workflow/wider-scope.md) §1.A4.

## 1. Scenario

A user wants a workflow they can run each morning that fetches their
unread email, recent commits across a configured set of repos, and
today's calendar events, then produces a single Markdown brief.

Concrete shape:

- **Workflow input:** `{ repos: string[], maxEmails: integer, maxCommits: integer }`.
- **Workflow output:** `{ brief: string }` (Markdown).
- **Behavior:** the three fetches are independent and could in principle
  run in parallel; the brief is composed once all three return. If a
  fetch fails, the brief should still be produced with a "section
  unavailable" placeholder for the failing source.

Three things make this scenario interesting for the IR:

1. **Three independent producers, one consumer.** Tests the diamond /
   fan-in shape on the data side and the §3.2.2 control-vs-data
   distinction on the control side (v1 sequences along `next`; the IR
   has to pick an order even though the data does not require one).
2. **Per-source error tolerance.** Tests the §3.8 `onError` model when
   the recovery is "substitute a placeholder value", i.e. the recovery
   produces the same shape the original task would have, and downstream
   nodes do not need to know which path was taken.
3. **Loop over the repo list.** Tests `loop` (§3.7) on a real list with
   per-repo state accumulation.

## 2. Task inventory

Registered task implementations referenced by this IR. Schemas given
in shorthand; assume they expand to full JSON Schema.

| Task id                   | Input                                                 | Output                                |
| ------------------------- | ----------------------------------------------------- | ------------------------------------- |
| `email.fetchUnread`       | `{ max: integer }`                                    | `{ messages: Message[] }`             |
| `git.fetchCommits`        | `{ repo: string, max: integer }`                      | `{ repo: string, commits: Commit[] }` |
| `calendar.today`          | `{}`                                                  | `{ events: Event[] }`                 |
| `text.renderSection`      | `{ section: string, items: any[] }`                   | `{ section: string, body: string }`   |
| `text.placeholderSection` | `{ section: string, reason: string }`                 | `{ section: string, body: string }`   |
| `markdown.compose`        | `{ emailSection, calendarSection, repoSections }`     | `{ brief: string }`                   |
| `list.elementAt`          | `{ list: any[], index: integer }`                     | `{ element: any }`                    |
| `list.append`             | `{ list: any[], item: any }`                          | `{ list: any[] }`                     |
| `int.add`                 | `{ a: integer, b: integer }`                          | `{ result: integer }`                 |
| `int.lessThan`            | `{ a: integer, b: integer }`                          | `{ result: boolean }`                 |
| `list.length`             | `{ list: any[] }`                                     | `{ length: integer }`                 |
| `bool.toLabel`            | `{ value: boolean, ifTrue: string, ifFalse: string }` | `{ label: string }`                   |

`Message`, `Commit`, `Event` are object shapes whose details do not
matter here.

Tasks `int.add`, `int.lessThan`, `list.length`, `list.elementAt`,
`list.append`, and `bool.toLabel` are standard-library tasks the
engine provides to fill the no-expressions gap (S2). Each is a
one-line computation that the engine could trivially inline. They
are genuine registered implementations under v1's model.

## 3. IR

```jsonc
{
  "kind": "workflow",
  "name": "morningBrief",
  "version": "1",

  "inputSchema": {
    "type": "object",
    "required": ["repos", "maxEmails", "maxCommits"],
    "properties": {
      "repos": { "type": "array", "items": { "type": "string" } },
      "maxEmails": { "type": "integer", "minimum": 1 },
      "maxCommits": { "type": "integer", "minimum": 1 },
    },
  },

  "outputSchema": {
    "type": "object",
    "required": ["brief"],
    "properties": { "brief": { "type": "string" } },
  },

  "types": {
    "Section": {
      "type": "object",
      "required": ["section", "body"],
      "properties": {
        "section": { "type": "string" },
        "body": { "type": "string" },
      },
    },
    "Message": { "type": "object" },
    "Commit": { "type": "object" },
    "Event": { "type": "object" },
  },

  "constants": {
    // With the template model, most literals are inline.
    // Only values shared across multiple sites belong here.
    // This workflow has one: the integer 1 used in both i+1
    // and the lessThan check. Even this could be inlined at
    // each site; it is kept here to show the mechanism.
    "one": { "schema": { "type": "integer" }, "value": 1 },
  },

  "nodes": {
    // ===== email branch =====

    "fetchEmail": {
      "kind": "task",
      "task": "email.fetchUnread",
      "inputSchema": {
        "type": "object",
        "required": ["max"],
        "properties": { "max": { "type": "integer" } },
      },
      "outputSchema": {
        "type": "object",
        "required": ["messages"],
        "properties": {
          "messages": {
            "type": "array",
            "items": { "$ref": "#/types/Message" },
          },
        },
      },
      "inputs": {
        "max": { "$from": "input", "name": "maxEmails" },
      },
      "next": "renderEmail",
      "onError": "emailUnavailable",
      "bind": "emailMessages",
    },

    "renderEmail": {
      "kind": "task",
      "task": "text.renderSection",
      "inputSchema": {
        "type": "object",
        "required": ["section", "items"],
        "properties": {
          "section": { "type": "string" },
          "items": { "type": "array" },
        },
      },
      "outputSchema": { "$ref": "#/types/Section" },
      "inputs": {
        "section": "email", // template literal
        "items": {
          "$from": "scope",
          "name": "emailMessages",
          "path": ["messages"],
        },
      },
      "next": "compose",
      "bind": "emailSection",
    },

    "emailUnavailable": {
      "kind": "task",
      "task": "text.placeholderSection",
      "inputSchema": {
        "type": "object",
        "required": ["section", "reason", "error", "trigger"],
        "properties": {
          "section": { "type": "string" },
          "reason": { "type": "string" },
          "error": { "type": "object" },
          "trigger": { "type": "object" },
        },
      },
      "outputSchema": { "$ref": "#/types/Section" },
      "inputs": {
        "section": "email", // template literal
        "reason": { "$from": "input", "name": "error", "path": ["message"] },
      },
      "next": "compose",
      "bind": "emailSection", // phi with renderEmail
    },

    // ===== calendar branch =====

    "fetchCalendar": {
      "kind": "task",
      "task": "calendar.today",
      "inputSchema": { "type": "object", "properties": {} },
      "outputSchema": {
        "type": "object",
        "required": ["events"],
        "properties": {
          "events": { "type": "array", "items": { "$ref": "#/types/Event" } },
        },
      },
      "inputs": {},
      "next": "renderCalendar",
      "onError": "calendarUnavailable",
      "bind": "calendarEvents",
    },

    "renderCalendar": {
      "kind": "task",
      "task": "text.renderSection",
      "inputSchema": {
        "type": "object",
        "required": ["section", "items"],
        "properties": {
          "section": { "type": "string" },
          "items": { "type": "array" },
        },
      },
      "outputSchema": { "$ref": "#/types/Section" },
      "inputs": {
        "section": "calendar", // template literal
        "items": {
          "$from": "scope",
          "name": "calendarEvents",
          "path": ["events"],
        },
      },
      "next": "fetchEmail",
      "bind": "calendarSection",
    },

    "calendarUnavailable": {
      "kind": "task",
      "task": "text.placeholderSection",
      "inputSchema": {
        "type": "object",
        "required": ["section", "reason", "error", "trigger"],
        "properties": {
          "section": { "type": "string" },
          "reason": { "type": "string" },
          "error": { "type": "object" },
          "trigger": { "type": "object" },
        },
      },
      "outputSchema": { "$ref": "#/types/Section" },
      "inputs": {
        "section": "calendar", // template literal
        "reason": { "$from": "input", "name": "error", "path": ["message"] },
      },
      "next": "fetchEmail",
      "bind": "calendarSection", // phi with renderCalendar
    },

    // ===== repo loop =====

    "repoLoop": {
      "kind": "loop",
      "inputs": {
        "repos": { "$from": "input", "name": "repos" },
        "maxCommits": { "$from": "input", "name": "maxCommits" },
      },
      "inputSchema": {
        "type": "object",
        "required": ["repos", "maxCommits"],
        "properties": {
          "repos": { "type": "array", "items": { "type": "string" } },
          "maxCommits": { "type": "integer" },
        },
      },
      "state": {
        "i": {
          "schema": { "type": "integer" },
          "initial": 0, // template literal
        },
        "sections": {
          "schema": {
            "type": "array",
            "items": { "$ref": "#/types/Section" },
          },
          "initial": [], // template literal
        },
      },
      "body": {
        "entry": "pickRepo",
        "nodes": {
          "pickRepo": {
            "kind": "task",
            "task": "list.elementAt",
            "inputSchema": {
              "type": "object",
              "required": ["list", "index"],
              "properties": {
                "list": { "type": "array", "items": { "type": "string" } },
                "index": { "type": "integer" },
              },
            },
            "outputSchema": {
              "type": "object",
              "required": ["element"],
              "properties": { "element": { "type": "string" } },
            },
            "inputs": {
              "list": { "$from": "input", "name": "repos" },
              "index": { "$from": "state", "name": "i" },
            },
            "next": "fetchRepo",
            "bind": "picked",
          },

          "fetchRepo": {
            "kind": "task",
            "task": "git.fetchCommits",
            "inputSchema": {
              "type": "object",
              "required": ["repo", "max"],
              "properties": {
                "repo": { "type": "string" },
                "max": { "type": "integer" },
              },
            },
            "outputSchema": {
              "type": "object",
              "required": ["repo", "commits"],
              "properties": {
                "repo": { "type": "string" },
                "commits": {
                  "type": "array",
                  "items": { "$ref": "#/types/Commit" },
                },
              },
            },
            "inputs": {
              "repo": {
                "$from": "scope",
                "name": "picked",
                "path": ["element"],
              },
              "max": { "$from": "input", "name": "maxCommits" },
            },
            "next": "renderRepo",
            "onError": "repoUnavailable",
            "bind": "repoFetch",
          },

          "renderRepo": {
            "kind": "task",
            "task": "text.renderSection",
            "inputSchema": {
              "type": "object",
              "required": ["section", "items"],
              "properties": {
                "section": { "type": "string" },
                "items": { "type": "array" },
              },
            },
            "outputSchema": { "$ref": "#/types/Section" },
            "inputs": {
              "section": "repo", // template literal
              "items": {
                "$from": "scope",
                "name": "repoFetch",
                "path": ["commits"],
              },
            },
            "next": "appendSection",
            "bind": "newSection",
          },

          "repoUnavailable": {
            "kind": "task",
            "task": "text.placeholderSection",
            "inputSchema": {
              "type": "object",
              "required": ["section", "reason", "error", "trigger"],
              "properties": {
                "section": { "type": "string" },
                "reason": { "type": "string" },
                "error": { "type": "object" },
                "trigger": { "type": "object" },
              },
            },
            "outputSchema": { "$ref": "#/types/Section" },
            "inputs": {
              "section": "repo", // template literal
              "reason": {
                "$from": "input",
                "name": "error",
                "path": ["message"],
              },
            },
            "next": "appendSection",
            "bind": "newSection", // phi with renderRepo
          },

          "appendSection": {
            "kind": "task",
            "task": "list.append",
            "inputSchema": {
              "type": "object",
              "required": ["list", "item"],
              "properties": {
                "list": { "type": "array" },
                "item": { "type": "object" },
              },
            },
            "outputSchema": {
              "type": "object",
              "required": ["list"],
              "properties": { "list": { "type": "array" } },
            },
            "inputs": {
              "list": { "$from": "state", "name": "sections" },
              "item": { "$from": "scope", "name": "newSection" },
            },
            "next": "stepIndex",
            "bind": "appended",
          },

          "stepIndex": {
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
              "a": { "$from": "state", "name": "i" },
              "b": 1, // template literal
            },
            "next": "computeLength",
            "bind": "stepped",
          },

          "computeLength": {
            "kind": "task",
            "task": "list.length",
            "inputSchema": {
              "type": "object",
              "required": ["list"],
              "properties": { "list": { "type": "array" } },
            },
            "outputSchema": {
              "type": "object",
              "required": ["length"],
              "properties": { "length": { "type": "integer" } },
            },
            "inputs": {
              "list": { "$from": "input", "name": "repos" },
            },
            "next": "compareIndex",
            "bind": "repoCount",
          },

          "compareIndex": {
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
              "a": { "$from": "scope", "name": "stepped", "path": ["result"] },
              "b": {
                "$from": "scope",
                "name": "repoCount",
                "path": ["length"],
              },
            },
            "next": "labelDone",
            "bind": "hasMore",
          },

          "labelDone": {
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
                "name": "hasMore",
                "path": ["result"],
              },
              "ifTrue": "more", // template literal
              "ifFalse": "done", // template literal
            },
            "next": "checkDone",
            "bind": "doneLabel",
          },

          "checkDone": {
            "kind": "branch",
            "selector": {
              "$from": "scope",
              "name": "doneLabel",
              "path": ["label"],
            },
            "selectorSchema": { "enum": ["more", "done"] },
            "cases": { "more": "@iterate", "done": "@exit" },
            "default": "@exit",
          },
        },
      },
      "iterateState": {
        "i": { "$from": "scope", "name": "stepped", "path": ["result"] },
        "sections": { "$from": "scope", "name": "appended", "path": ["list"] },
      },
      "output": { "$from": "scope", "name": "appended", "path": ["list"] },
      "outputSchema": {
        "type": "array",
        "items": { "$ref": "#/types/Section" },
      },
      "maxIterations": 1000,
      "next": "compose",
      "bind": "repoSections",
    },

    // ===== compose =====

    "compose": {
      "kind": "task",
      "task": "markdown.compose",
      "inputSchema": {
        "type": "object",
        "required": ["emailSection", "calendarSection", "repoSections"],
        "properties": {
          "emailSection": { "$ref": "#/types/Section" },
          "calendarSection": { "$ref": "#/types/Section" },
          "repoSections": {
            "type": "array",
            "items": { "$ref": "#/types/Section" },
          },
        },
      },
      "outputSchema": {
        "type": "object",
        "required": ["brief"],
        "properties": { "brief": { "type": "string" } },
      },
      "inputs": {
        "emailSection": { "$from": "scope", "name": "emailSection" },
        "calendarSection": { "$from": "scope", "name": "calendarSection" },
        "repoSections": { "$from": "scope", "name": "repoSections" },
      },
      "bind": "result",
    },
  },

  "entry": "fetchCalendar", // arbitrary sequencing; v1 requires a linear next chain
  "output": { "$from": "scope", "name": "result", "path": ["brief"] },
}
```

**Changes from the pre-template draft.** The previous IR used `/* ?? */`
markers at every literal position. With the template model (decision
0007, Alternative G):

- **Literal inputs are inline.** `"section": "email"`, `"initial": 0`,
  `"initial": []`, `"b": 1`, `"ifTrue": "more"`, `"ifFalse": "done"` -
  all appear directly at their use site as template literals. No
  `$from` wrapper, no constants block entry.
- **Constants block shrunk from 6 entries to 1.** Only `one` remains
  (and even that is inlined at its sole use site in `stepIndex.inputs.b`;
  the constants entry is kept here to demonstrate the mechanism, not
  because it is needed).
- **Task inventory expanded to 12.** The standard-library tasks
  (`int.add`, `int.lessThan`, `list.length`, `list.elementAt`,
  `list.append`, `bool.toLabel`) are now listed explicitly. These fill
  the no-expressions gap (S2); the template model does not help with
  expressions.
- **Calendar branch written out.** `renderCalendar` and
  `calendarUnavailable` were previously elided; now complete with
  template literals.
- **Task abuse removed.** `renderEmail` previously reused
  `text.placeholderSection` for the success path; now uses
  `text.renderSection` (new task) with `items` input.
- **No remaining `/* ?? */` markers.** Every position is filled. The
  IR is complete and validator-ready (modulo the standard-library
  task implementations themselves).

## 4. What hurt

### 4.1 Surprises

**S1. Literal values in `inputs`: resolved.** The pre-template draft
could not write literal inputs (section discriminants, initial state
values, integer `1`). Every literal required a workflow-root
`constants` entry. The template model (decision 0007, Alternative G)
resolves this completely: `"section": "email"`, `"initial": 0`,
`"b": 1` appear directly at their use sites as template literals.

The constants block shrank from 6 entries to 1 (and that remaining
entry is optional - `one` could equally be inlined as `1`). The
constants mechanism is now what it was designed to be: a place for
values shared across many sites, not the only way to spell a literal.

**S2. No expressions, including `i + 1`.** Unchanged from the pre-
template draft. The template model does not address expressions;
templates evaluate `$from` references and assemble JSON values, but do
not compute. The repo loop still requires `int.add`, `int.lessThan`,
`list.length`, `list.elementAt`, `list.append`, and `bool.toLabel` as
standard-library tasks. For this scenario alone: 6 standard-library
tasks, 4 standard-library task _nodes_ in the loop body
(`stepIndex`, `computeLength`, `compareIndex`, `labelDone`), all of
which exist solely to compute `i + 1 < len(repos)`.

Decision pressure: unchanged. Worth a `decisions/0006-no-expressions.md`
record. The two tenable stances remain:

1. **No expressions, ever.** Standard-library tasks are the IR's
   answer. The DSL hides them.
2. **Expressions in references.** A tiny pure-functional sublanguage.
   Adds a concept (evaluation order, error semantics).

The template model gives option (1) a modest improvement: the
standard-library tasks can now receive literal arguments inline
(`"b": 1` instead of `{ "$from": "constant", "name": "one" }`),
which makes the tasks slightly less verbose. But the node count is
unchanged: four tasks to check a loop counter is still four tasks.

**S3. Loop ordering is forced by `next`.** The three top-level fetches
(email, calendar, repos) are independent. v1 §5.7 says execution is
sequential along `next` chains; v1 has no parallel construct. So the
IR has to thread them in some order: `fetchCalendar -> fetchEmail ->
repoLoop -> compose`. Reading the IR cold, this order looks meaningful;
it is not. §3.2.2's "v1 limitation: control-flow edges are ambiguous"
notes this exactly and points at the post-v1 side-effect /
parallelism work; this scenario is an existence proof of why that
matters and not a corner case.

Decision pressure: none for v1, but the "we will have to thread
sequence even where none exists" cost is real and should be stated in
§1.1.3 as a tension, not buried in §3.2.2.

### 4.2 Verbosity tax (working as intended)

**V1. Per-task `inputSchema` and `outputSchema` restate the task contract.**
This is exactly the §8.16 / decision 0003 story: drift-checked, intentional.
For this scenario the cost is bearable: ~40 lines of restated schema
across 8 tasks. It would be unbearable for a 40-task workflow without
codegen. Confirms the v1 stance and confirms the "DSL or codegen
mandatory for non-trivial workflows" implication of §1.1.2.

**V2. Reference objects are still 1-4 lines.** Under the template
model, simple literal positions are now 1 line (`"section": "email"`),
but `$from` references are unchanged at 1-4 lines. The mix is better
than before (roughly half of `inputs` positions are now literals), but
the reference syntax cost is still confirmed local and not a barrier.
§8.2 holds.

**V3. Phi-merge under one `bind` name.** The `emailSection` /
`calendarSection` / `newSection` merges where success and recovery
both bind the same name worked exactly as §3.8 advertises and produced
clean downstream consumers (`compose` does not branch on which path
ran). **This is a strong vindication of the §3.8 model.** No
findings.

### 4.3 Gaps

**G1. No fan-out / fan-in over a list other than via a loop with a
counter.** The natural shape "for each repo in repos, fetch in
parallel" is not expressible. The loop expresses the iteration but
not the parallelism. If repos has 50 entries the workflow is 50x
slower than it could be. v1 (§2.2) explicitly defers parallelism;
the scenario confirms this is one of the most visible deferrals an
end user will hit.

**G2. No way to iterate a list directly.** The loop uses an integer
index `i` plus `list.elementAt` plus `int.add` plus a length check.
A foreach construct (or a `state` projection that consumes the head
of a list) would collapse three nodes and three constants. v1 does
not have this; whether the DSL provides it or whether the IR grows a
foreach loop is open. The §1.3 minimization rule says: only if it
adds a behavioral rule the existing concepts do not cover. A foreach
arguably does (termination on list exhaustion, not on a counter
predicate), so this is a real schema question, not just sugar.

**G3. Compound cost of "no predicate branches" + "no expressions".**
The discriminant of `checkDone` is `"more"` or `"done"`, which the IR
must compute via a comparison task and a `bool.toLabel` task (S2). A
predicate-style branch (`if list.length > i+1`) is rejected by §8.3
in favor of the discriminant model; the rationale (P3 boundary) holds,
but the combination of "no predicate branches" + "no expressions"
means a single `i+1 < len(repos)` check requires four tasks
(`stepIndex`, `computeLength`, `compareIndex`, `labelDone`) and one
branch. Templates reduced this from five tasks to four (the literal
`1` is now inline rather than a constant-lookup task), but the
dominant cost is the no-expressions gap, not the literal mechanism.
This is the multiplicative cost of the prior decisions, not a new
decision; recording it makes the cost visible.

### 4.4 Decision pressure summary

| Finding              | Targets                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 (literals)        | §1.2, §1.3 (variance lens). **Accepted:** [`decisions/0007-value-construction-in-references.md`](../decisions/0007-value-construction-in-references.md) (Alternative G, template model). |
| S2 (expressions)     | §1.3, principle-gaps. **Adopted:** [`decisions/0006-no-expressions-in-ir.md`](../decisions/0006-no-expressions-in-ir.md) (no expressions; standard-library tasks; DSL hides them).       |
| S3 (forced sequence) | §3.2.2 v1-limitation, §1.1.3. Lift this to §1.1.3 as a named tension.                                                                                                                    |
| G1 (fan-out)         | §2.2 already defers; no change.                                                                                                                                                          |
| G2 (foreach)         | §1.3 and `post-v1/`. Worth a sketch.                                                                                                                                                     |
| G3 (compound cost)   | Note in §1.3 that minimization decisions have multiplicative costs at use sites.                                                                                                         |

## 5. DSL hint

A morning-brief workflow that a user actually authors should look
roughly like:

```
workflow morningBrief(repos: string[], maxEmails: int, maxCommits: int) -> { brief: string } {

  parallel {
    emailSection = try email.fetchUnread(max: maxEmails)
                     |> renderEmailSection
                     else err -> placeholderSection("email", err.message)

    calendarSection = try calendar.today()
                        |> renderCalendarSection
                        else err -> placeholderSection("calendar", err.message)

    repoSections = for repo in repos {
                     try git.fetchCommits(repo, max: maxCommits)
                       |> renderRepoSection(repo)
                       else err -> placeholderSection("repo:" + repo, err.message)
                   }
  }

  return markdown.compose(emailSection, calendarSection, repoSections)
}
```

Compared to the IR this is ~15 lines vs. ~480. The compression
factor (~32x) is a calibration data point for the §1.2 verbosity tax
discussion. Note that ~180 of those 480 lines are restated
`inputSchema`/`outputSchema` blocks (V1) and ~100 are standard-library
task nodes for arithmetic (S2). Templates did not change the
compression ratio much: the pre-template draft was ~250 lines because
it elided calendar nodes and loop-body detail; the complete IR with
templates is larger because nothing is elided, but the DSL is
unchanged.

The DSL features the IR forces this surface to provide:

- **Inline literals** (`"email"`, `"repo:" + repo`). Templates handle
  simple literals (`"email"`); the DSL additionally handles string
  concatenation (`"repo:" + repo`) which the IR expresses only via
  standard-library tasks or a future expression sublanguage.
- **Expressions** at minimum string concatenation and integer arithmetic.
- **`for x in list`** desugaring to the index-loop pattern
  (`list.elementAt` + `int.add` + `list.length` + `int.lessThan` +
  `bool.toLabel` + branch).
- **`parallel { ... }`** desugaring to either explicit IR parallelism
  (post-v1) or to a still-sequential IR (v1) with a clear "this is a
  perf placeholder" marker.
- **`try ... else err -> ...`** desugaring to `onError` plus a
  recovery task, with shared bind name.
- **Pipeline `|>`** desugaring to `next` plus a `bind` plus a
  reference.

The interesting observation: of the six items above, only `parallel`
is gated on post-v1 IR work. The other five are pure DSL surface and
could ship at the same time as v1 of the IR. This argues for starting
the DSL alongside the engine rather than after it.

## 6. Engine implications

To run this IR (in v1, sequentially), the engine has to:

1. Resolve constants once at workflow load.
2. Sequence top-level tasks per `next` chain.
3. For each `task` node: evaluate `inputs` as a template (walk the
   JSON tree; pass through literals; resolve `$from` references
   against the named namespace; skip `$literal` bodies; reject
   unrecognized `$`-prefix keys). Validate the assembled object
   against `inputSchema`, dispatch to the registered task, validate
   the result against `outputSchema`, bind to `scope` if `bind` is
   present.
4. Honor `onError` by routing to the recovery task and injecting
   `error` and `trigger` (§3.8.1).
5. For the loop: maintain the body scope per iteration, evaluate
   `iterateState` at `@iterate`, increment iteration counter against
   `maxIterations`, evaluate `output` at `@exit`.
6. For the branch: evaluate `selector` (template), look up in `cases`,
   fall back to `default`.
7. Emit `nodeStarted` / `nodeCompleted` / `nodeFailed` per node, per
   iteration, per recovery dispatch.

Steps (3) and (6) are the only ones that changed under the template
model. Template evaluation is a recursive JSON walk: the engine was
already resolving `$from` at each `inputs` key; now it walks deeper
when a value is an object or array without `$from` at the top level.
The implementation cost is negligible (a 10-line recursive function).

Nothing here is exotic. A 250-line engine can do (1)-(7) for this
workflow. **This is good news for the design**: the load-bearing
work for v1 is in the validator (which is doing dominator analysis,
phi-soundness, and IR/task drift), not in the runtime. The engine
sketch step suggested in the prior design discussion is well-scoped.

What this scenario does _not_ exercise that the engine still has to
support: nested loops, recovery from inside a loop body that fails
the loop node, multiple `onError` triggers in one scope with
overlapping recovery semantics, references to `state` from a
recovery task. Each is a candidate for its own scenario.
