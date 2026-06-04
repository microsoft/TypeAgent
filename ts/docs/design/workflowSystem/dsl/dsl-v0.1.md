# Workflow DSL

Status: **Implemented.** All phases complete (lexer, parser, type checker, emitter, graph extractor).

Compile target: [ir-v0.1.md](../ir/ir-v0.1.md) + [ir-v0.2.md](../ir/ir-v0.2.md).
Design rationale: [dsl-comparison.md](dsl-comparison.md) (Option E selected).
Implementation gaps: [dsl-v0.1-gap.md](dsl-v0.1-gap.md).

---

## 1. Overview

The workflow DSL is a TypeScript-like language that compiles to
[workflow IR JSON](../ir/ir-v0.1.md). Its purpose is to absorb the IR's
verbosity tax so that workflow authors write familiar imperative code
while the compiler handles schema restatement, `$from` reference objects,
`next` edge threading, loop machinery, and scope capture.

The compiler pipeline is: **lex -> parse -> type-check -> emit**, with an
optional validation pass. Implementation is in `examples/workflow/dsl/src/`:

| File                | Role                                                          |
| ------------------- | ------------------------------------------------------------- |
| `ast.ts`            | AST type definitions                                          |
| `lexer.ts`          | Tokenizer with position tracking                              |
| `parser.ts`         | Recursive-descent parser producing a typed AST                |
| `typeChecker.ts`    | Type inference and validation (between parse and emit)        |
| `emitter.ts`        | AST-to-IR lowering: scopes, name resolution, node generation  |
| `compiler.ts`       | Public API orchestrating the phases                           |
| `graphExtractor.ts` | Extracts a visual graph model (nodes, edges, groups) from AST |
| `visualize.ts`      | Generates HTML visualization of workflow graphs               |
| `index.ts`          | Public API re-exports                                         |

The public API is `compile(source, taskSchemas, options?)`, which returns
`{ ir?: WorkflowIR, errors: CompileError[] }`. All compile errors carry
`{ phase, message, line, col }` for source-position diagnostics. The
optional `validate` flag runs the IR validator after emit.

Seven high-level principles drove the design. Each one eliminated alternatives
and shaped specific technical decisions.

1. **Every line should be a visual node.** If a DSL construct doesn't map to
   something an author would draw on a whiteboard, it shouldn't exist. This
   eliminated `continue`, uninitialized `let`, accumulator
   `list.append`, and `while(true)` loop machinery. (`break` in switch arms
   is structural syntax, not a visual node.)

2. **The DSL's structure IS the graph structure.** Block nesting maps to visual
   group nesting. Variable references map to edges. There should be no
   reconstruction step where the visual editor has to infer structure the DSL
   doesn't encode. (This is why Option D's implicit branching was problematic.)

3. **Single definition, single purpose.** Every variable is defined once
   (`const`), at the point where its producing node exists. No phi-nodes, no
   merge points, no "which definition of `x` am I looking at?" The variable
   name IS the edge label, and there is exactly one source.

4. **Domain constructs, not general-purpose escapes.** Workflow patterns
   (attempts, map, filter, parallel) should be first-class, not emergent from
   combining lower-level primitives. The DSL vocabulary should match the visual
   vocabulary: an "attempts group" in the graph corresponds to an `attempts()` in the
   source, not a 14-line while/try/break pattern.

5. **Complexity goes into sub-workflows, not deeper nesting.** When a branch,
   loop body, or error handler gets complex, factor it into a named
   sub-workflow. This keeps any single workflow's graph flat and readable, and
   gives the visual editor a natural "drill-in" mechanism.

6. **The AST is the canonical model.** Both the text editor and visual editor
   operate on the same AST. Text is just one serialization of it. This means
   the AST must be self-describing: dedicated node types for each workflow
   concept, not generic "call expression with magic name."

7. **TypeScript subset by default.** The DSL syntax should be valid TypeScript
   wherever possible. Deviations from TS syntax must be explicitly justified.
   This gives authors familiar syntax, reduces the learning curve, and opens
   the door to reusing TS tooling (syntax highlighting, formatters, etc.).

### 1.2 Technical design rules

These rules implement the guiding principles above.

1. **Single-assignment (SSA).** All bindings are `const`. No `let`, no
   reassignment, no uninitialized declarations. Every variable has exactly
   one definition point. _(from principles 1, 3)_

2. **No general-purpose loops.** No `while`, `for`, `continue`.
   Iteration is expressed via built-in functions: `map`, `filter`.
   `break` exists only as structural syntax in switch arms (not rendered
   visually). _(from principles 1, 4)_

3. **No try/catch.** Error handling is expressed via the `attempts` built-in.
   _(from principle 4)_

4. **Statements vs expressions.** `if/else` and `switch` are statements
   (side effects only, no value). `?:` (ternary) is an expression for
   simple value selection. Sub-workflow calls handle complex value-producing
   branches. _(from principles 2, 5)_

5. **Built-ins are compiler directives.** `attempts`, `map`, `filter`, `parallel`
   look like function calls but the parser produces dedicated AST node types.
   They are not runtime functions. _(from principle 6)_

6. **Visual editor friendly.** Every DSL construct maps 1:1 to a visual element.
   No phantom nodes, no visual noise. The AST is the canonical model for both
   text and visual editing. _(from principles 1, 2, 6)_

7. **TypeScript subset by default.** _(from principle 7)_

8. **Static type checking with no implicit coercion.** The compiler type-checks
   all expressions. Operators are stricter than JS/TS: no implicit coercion
   between types. `number + string` is a compile error, not string
   concatenation. _(from principles 4, 7)_

#### Justified deviations from TypeScript syntax

| Deviation                         | TS equivalent                     | Justification                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow name(params): Type { }` | `function name(params): Type { }` | Distinguishes workflow declarations from ordinary functions. Enables the compiler to reject files that don't contain a workflow. Makes intent explicit to both human readers and LLM generators. A workflow is not a function: it compiles to IR, not executable code, and its parameters and return type are validated against a schema. |

This is the **only** deviation from TypeScript syntax. All other constructs
(`const`, task calls with `{ }` argument objects, `if/else`, `switch`, `?:`,
arrow functions, template literals, dotted access, object/array literals,
`return`) are valid TypeScript.

---

## 2. Syntax

### 2.1 Workflow declaration

```
workflow NAME(PARAM: TYPE, ...): RETURN_TYPE {
    STATEMENTS
}
```

Multiple workflows can be defined in a single file.
Sub-workflows are called by name.

### 2.2 Bindings

All bindings are `const`:

```
const x = namespace.task(arg1, arg2)
const y = `template ${x.field}`
const z = 42
```

No `let`. No uninitialized declarations. No reassignment.

### 2.3 Task calls

```
const result = namespace.task(positionalArg)
const result = namespace.task({ name: value, name2: value2 })
```

Named arguments are wrapped in `{ }`, matching TypeScript object literal
syntax. The compiler validates argument names against the task schema.
Positional arguments (no `{ }`) are allowed when the task has a single
input field.

Bare task calls (without `const`) are allowed for side-effect-only calls:

```
if (check.needsAudit) {
    audit.log(data)
}
```

The parser wraps these as `ConstStatement` with a synthetic name
(`_<line>_<col>`) so the emitter can generate a node. The binding is
never referenced.

### 2.4 Template literals

```
const prompt = `Hello ${name}, your order ${order.id} is ready`
```

Backtick syntax with `${}` interpolation.

Supported escape sequences in template literals: `\n`, `\t`, `\r`,
`\\`, `` \` ``, `\$`. String literals additionally support `\'` and
`\"`.

### 2.5 Constants

```
const maxRetries = 2
const baseUrl = "https://api.example.com"
```

String, number, and boolean literals. Number literals may include a
decimal point (e.g., `3.14`). The type checker infers `integer` for
whole-number literals and `number` for literals with a decimal.

### 2.6 Operators (syntactic sugar)

The DSL supports a limited set of operators for use in conditions and simple
value expressions. These are syntactic sugar: the emitter lowers them to task
nodes in the IR. They never appear as separate visual nodes; instead they
display as inline labels on the containing element (branch diamond, condition
header, etc.).

**Comparison operators:**

```
if (result.count > 0) { ... }
if (score >= threshold) { ... }
const isMatch = result.status === "ok"
const changed = oldValue !== newValue
```

**Logical operators:**

```
if (result.isValid && result.count > 0) { ... }
const shouldNotify = isUrgent || isEscalated
const isReady = !result.isPending
```

**Arithmetic operators:**

```
const total = basePrice + tax
const remaining = maxRetries - attempts
```

Supported set:

| Category   | Operators                          |
| ---------- | ---------------------------------- |
| Comparison | `===`, `!==`, `>`, `<`, `>=`, `<=` |
| Logical    | `&&`, `\|\|`, `!`                  |
| Arithmetic | `+`, `-`, `*`, `/`, `%`            |
| Rejected   | `==`, `!=` (compile error)         |

**AST:** `BinaryExpr { op, left, right }` and `UnaryExpr { op, operand }`.
Embedded inline in conditions and value positions.

**Type rules (no implicit coercion):**

| Operator       | Allowed operand types   | Result type | Compile error example         |
| -------------- | ----------------------- | ----------- | ----------------------------- |
| `+`, `-`, etc. | `number`, `number`      | `number`    | `count + "1"` (mixed types)   |
| `===`, `!==`   | same type on both sides | `boolean`   | `count === "5"` (mixed)       |
| `>`, `<`, etc. | `number`, `number`      | `boolean`   | `name > 0` (string vs num)    |
| `&&`, `\|\|`   | `boolean`, `boolean`    | `boolean`   | `count && valid` (num + bool) |
| `!`            | `boolean`               | `boolean`   | `!count` (not boolean)        |

String concatenation uses template literals only: `` `${a}${b}` ``, not `+`.
This eliminates the primary source of implicit coercion in JS/TS.

**IR lowering:** Most operators emit a task node (e.g., `===` becomes
`compare.equals`, `+` becomes `math.add`). The exceptions are `&&` and `||`,
which lower to branch nodes for short-circuit evaluation: the left operand
is evaluated and used as the branch condition; one arm evaluates the right
operand, the other returns the short-circuit value directly. This is an
implementation detail invisible to the workflow author.

**Visual:** Operators appear as inline text on the containing visual element
(branch label, condition header), not as separate nodes. This is consistent
with how literals and dotted names are already inlined.

### 2.7 If/else (statement, no value)

```
if (result.count > 0) {
    processor.handle(result)
}

if (check.isValid && check.score >= threshold) {
    audit.logAccepted(data)
} else {
    audit.logRejected(data)
}
```

No value produced. For value selection, use ternary or sub-workflow.

### 2.8 Ternary expression (value selection)

```
const result = check.isValid ? processor.accept(data) : processor.reject(data)
```

Each arm is a single expression (task call, literal, variable reference, or
sub-workflow call). For multi-step branches, use sub-workflows.

### 2.9 Switch (statement, no value)

```
switch (category) {
    case "email":
        email.send(data)
        break
    case "slack":
        slack.post(data)
        break
    default:
        log.warn("unknown category")
        break
}
```

Standard TypeScript switch syntax. Every arm must end with `break` or
`return` (compile error if missing). Fallthrough is supported by omitting
`break`, matching TS semantics.

`break` is structural syntax: the visual editor does not render it as a
node. It is only valid inside switch arms (not loops, since the DSL has
no loops).

For value selection from multi-way branches, use a sub-workflow with
`return` in each arm:

```
workflow dispatch(category: string, data: Data): Result {
    switch (category) {
        case "email":
            return email.send(data)
        case "slack":
            return slack.post(data)
        default:
            return fallback.handle(data)
    }
}

const result = dispatch(category, data)
```

### 2.10 Throw

```
throw err
throw "deployment failed"
```

Explicit error signaling. `throw` terminates the current workflow (or
fallback body) with an error. Primary use case: cleanup then rethrow
in an attempts fallback.

```
const result = attempts(2, () => {
    const uploaded = storage.upload(data)
    cluster.deploy(uploaded)
}, (err) => {
    storage.cleanup({ prefix: data.id })   // cleanup
    throw err                              // rethrow
})
```

Valid TS syntax. No deviation from principle 7.

### 2.11 Return

```
return result
return result.field
return { path: writeResult, summary: summaryResult }
```

Object literal return for multi-field output.

### 2.12 Semicolons

Semicolons are **optional**. The parser treats newlines as statement
terminators (like Go or Kotlin). Semicolons are accepted for authors who
prefer them, but the canonical style (used in all documentation and examples)
omits them.

This is valid TypeScript behavior (ASI), so it does not violate principle 7.

### 2.13 Comments

```
// Line comments
const result = ai.analyze(data)   // trailing comments

/* Block comments */
const summary = llm.summarize(result)
```

Both `//` and `/* */` are supported. Comments are preserved in the AST
(see section 6) to ensure round-trip fidelity between text and visual editing.

### 2.14 Type system

The DSL has a static type system that runs between parsing and emission. It
infers types for all expressions, validates operator usage, and reports errors
at compile time. The system follows TypeScript semantics where possible but is
deliberately simpler: no union types, no generics, no type aliases.

#### Type kinds

| Kind      | Description                            | DSL syntax                        | JSON Schema                                 |
| --------- | -------------------------------------- | --------------------------------- | ------------------------------------------- |
| `string`  | Text values                            | `string`                          | `{ "type": "string" }`                      |
| `number`  | Floating-point numbers                 | `number`                          | `{ "type": "number" }`                      |
| `integer` | Whole numbers                          | `integer`                         | `{ "type": "integer" }`                     |
| `boolean` | True/false values                      | `boolean`                         | `{ "type": "boolean" }`                     |
| object    | Structured records with typed fields   | `{ name: string, age?: integer }` | `{ "type": "object", "properties": {...} }` |
| array     | Ordered list of elements               | `string[]`, `{ x: number }[]`     | `{ "type": "array", "items": {...} }`       |
| tuple     | Fixed-length heterogeneous list        | _(inferred from `parallel`)_      | _(no DSL syntax)_                           |
| `unknown` | Top type: anything is assignable to it | `unknown`                         | `{}`                                        |
| `never`   | Bottom type: assignable to anything    | `never`                           | `{ "not": {} }`                             |

`integer` and `number` are interchangeable in type compatibility checks
(an `integer` value can be used where `number` is expected, and vice versa).

#### Type annotations

Type annotations appear in two places:

1. **Workflow parameters and return types** (required):

   ```
   workflow process(url: string, maxRetries: integer): { body: string }
   ```

2. **Const bindings** (optional, for documentation or to constrain):
   ```
   const x = task.call(arg: v)           // type inferred from task schema
   const y: string = task.call(arg: v)   // explicit: error if schema disagrees
   ```

#### Type inference

Every expression has a type, inferred bottom-up:

- **Literals:** `42` is `number`, `"hello"` is `string`, `true` is `boolean`,
  `null` is `unknown`.
- **Task calls:** return type from the task's `outputSchema`.
- **Workflow calls:** return type from the called workflow's declaration.
- **Dotted access:** field type from the parent object's schema.
- **Operators:** result type from the operator type rules (section 2.6).
- **Ternary:** both arms must be the same type; that is the result type.
  If either arm is `never`, the result is the other arm's type.
- **Template literals:** always `string`.
- **Array literals:** `[a, b, c]` infers the element type from the first element.
- **Built-ins:** `map` and `filter` return arrays of the body's return type.
  `attempts` returns the body's return type. `parallel` returns a tuple of each
  arm's return type. `parallelMap` returns an array of the body's return type.

#### `unknown` (top type)

The `unknown` type represents values whose structure is not statically known.
It corresponds to `{}` (empty schema) in JSON Schema and follows TypeScript
semantics:

- **Any type is assignable to `unknown`.** A workflow returning `unknown` can
  return a string, number, object, or any other value.
- **`unknown` is not assignable to concrete types.** If a task returns
  `unknown`, the result cannot be used where a `string` or `number` is
  expected without passing through a task that produces a concrete type.
- **Field access on `unknown` is an error.** If `r.value` has type `unknown`,
  writing `r.value.foo` is a compile error.
- **Equality operators (`===`, `!==`) skip type checking when either operand
  is `unknown`.** This allows comparing unknown values for identity without
  a compile error.

Primary use case: tasks like `llm.generateJson` that produce arbitrary
structured data. The output type is genuinely unknown at compile time;
downstream consumers must use it opaquely or pass it to tasks that accept `{}`.

```
workflow test(): unknown {
    const r = llm.generateJson(prompt: "generate some JSON")
    return r.value    // r.value is unknown
    // r.value.foo    // compile error: Cannot access property 'foo' on unknown type
}
```

#### `never` (bottom type)

The `never` type represents computations that never produce a value (they
always throw). It corresponds to `{ "not": {} }` in JSON Schema and follows
TypeScript semantics:

- **`never` is assignable to any type.** A `throw` expression or a workflow
  that always throws can appear anywhere a value is expected.
- **No concrete type is assignable to `never`.** A workflow declared as
  returning `never` must throw; `return "value"` is a compile error.
- **In ternary expressions, `never` propagates the other arm's type.** If one
  arm throws (returns `never`), the ternary's type is the other arm's type,
  matching TypeScript behavior.

```
workflow fail(): never { throw "fatal error" }

workflow process(x: boolean): string {
    return x ? "ok" : fail()   // type is string, not string | never
}
```

#### Strict rules (deviations from TypeScript)

- No implicit coercion. `number + string` is a compile error.
- `===` / `!==` require both operands to be the same type (unless `unknown` or `never`).
- `&&` / `||` require `boolean` operands (no truthy/falsy coercion).
- `if` and ternary conditions must be `boolean`, not just truthy.
- `+` is arithmetic only; use template literals for string concatenation.
- No `any` type. Use `unknown` for untyped values.

#### Unresolved type (internal)

When the type checker encounters an unknown type name (typo or unsupported
type) or an unknown variable reference, it produces an internal `unresolved`
type. This type is compatible with everything to prevent cascading errors:
a single typo should not generate dozens of downstream type errors. The
`unresolved` type is never exposed in DSL syntax.

---

## 3. Built-in functions

Built-in functions are compiler directives, not runtime functions. The parser
recognizes them by name and produces dedicated AST nodes. The emitter lowers
them to IR patterns.

The name reservation is narrow: only `name(` at call position triggers the
builtin path. Using a reserved name as a variable reference or as a dotted
segment (e.g., `obj.map(...)`) is unaffected. However, you cannot define a
task or workflow with a reserved name and call it: `map(...)` will always be
parsed as the builtin, not a task call.

### 3.1 `attempts(count, body, fallback?)`

Execute the body up to `count` times total. On error, re-execute the body
until the attempt limit is reached. Optional fallback runs after all
attempts are exhausted.

```
const result = attempts(2, () => {
    http.get({ url: url })
})
```

With fallback (cleanup then rethrow):

```
const result = attempts(2, () => {
    const uploaded = storage.upload(data)
    cluster.deploy(uploaded)
}, (err) => {
    storage.cleanup({ prefix: data.id })
    throw err
})
```

With fallback (substitute value):

```
const result = attempts(2, () => {
    http.get({ url: url })
}, (err) => {
    cache.lookup({ url: url })
})
```

- `count`: total number of attempts (number literal or const reference).
  `attempts(1, ...)` means try once with no retries.
  `attempts(3, ...)` means try up to 3 times total.
- `body`: arrow function containing one or more task calls
- `fallback`: optional arrow function with one parameter (the error;
  defaults to `err` if the parameter name is omitted).
  Can return a substitute value or `throw` to propagate the error.
- Returns the successful result of the body, or the fallback's return value
- On exhaustion without fallback: runtime error

**AST:** `AttemptsNode { count: Expr, body: Statement[], fallback?: { param: string, body: Statement[] } }`
**IR lowering:** Loop node with onError edges and attempt counter.

### 3.2 `map(collection, body)`

Apply body to each item, collect results.

```
const sections = map(repos, (repo) => {
    const gitResult = shell.exec({ command: "git log", args: [repo] })
    text.template(`## ${repo}\n${gitResult.stdout}`)
})
```

- `collection`: expression resolving to an array
- `body`: arrow function with one parameter (the item; defaults to
  `item` if the parameter name is omitted)
- Returns an array of the body's last expression per item

**AST:** `MapNode { collection: Expr, param: string, body: Statement[] }`
**IR lowering:** Loop node with index/length/compare/check_done machinery.

**Semantics:** `map` uses pre-check loop semantics. On each iteration, the
compiler-generated loop first compares the current index against the
collection length. If the check fails, the body does not run and the loop
exits immediately. If the check succeeds, the body runs, its result is
appended to the output array, the index is incremented, and the next
iteration begins. Empty collections therefore skip the body entirely.

### 3.3 `filter(collection, body)`

Keep items where body returns `true`.

```
const valid = filter(items, (item) => {
    validator.isValid(item)
})
```

- `collection`: expression resolving to an array
- `body`: arrow function with one parameter (the item; defaults to
  `item`) returning a boolean-producing task call
- Returns a filtered array

**AST:** `FilterNode { collection: Expr, param: string, body: Statement[] }`
**IR lowering:** Loop node (same as `map`) with a branch node inside the body.
The body's last expression must produce a `boolean`. The emitter inserts a
branch node that checks this result: the true branch appends the element to
the output array via a `list.append` built-in task; the false branch skips
(no-op, advances to next iteration). The output is the accumulated array.

**Semantics:** `filter` uses the same pre-check loop shape as `map`: compare
index vs length before entering the body, exit immediately when the check
fails, and increment only after the current iteration's keep/drop decision is
resolved. Empty collections therefore skip the body entirely.

### 3.4 `parallel(...bodies, options?)`

Execute bodies concurrently, wait for all.

```
const [text, image, meta] = parallel(
    () => text.analyze(document),
    () => image.analyze(document),
    () => metadata.extract(document)
)
```

With concurrency limit:

```
const [a, b, c, d, e] = parallel(
    () => api.call1(data),
    () => api.call2(data),
    () => api.call3(data),
    () => api.call4(data),
    () => api.call5(data),
    { maxConcurrency: 3 }
)
```

- `bodies`: two or more arrow functions
- `options`: optional trailing object literal with configuration fields:
  - `maxConcurrency`: number literal or const reference. Limits how many
    branches run simultaneously. The engine schedules branches in declaration
    order. Defaults to unbounded if omitted.
- Returns a tuple of results via destructuring
- All bodies must be independent (no data dependencies between them)

**AST:** `ParallelNode { bodies: { body: Statement[] }[], maxConcurrency?: Expr }`
**IR lowering:** `fork` node ([ir-v0.2.md](../ir/ir-v0.2.md) §2.1). Each arrow function
becomes a branch sub-scope. Destructuring bindings extract results by position.
`maxConcurrency` maps directly to the IR field of the same name.

### 3.5 `parallelMap(collection, body, options?)`

Map over collection with concurrent execution.

```
const results = parallelMap(items, (item) => {
    text.process(item)
})
```

With concurrency limit:

```
const results = parallelMap(items, (item) => {
    text.process(item)
}, { maxConcurrency: 5 })
```

- `collection`: expression resolving to an array
- `body`: arrow function with one parameter (the item)
- `options`: optional object literal with configuration fields:
  - `maxConcurrency`: number literal or const reference. Limits concurrent
    iterations. Defaults to unbounded if omitted.
- Returns an array of the body's last expression per item, preserving order

**AST:** `ParallelMapNode { collection: Expr, param: string, body: Statement[], maxConcurrency?: Expr }`
**IR lowering:** `forkMap` node ([ir-v0.2.md](../ir/ir-v0.2.md) §2.2). Collection
becomes the `collection` reference, body becomes the body sub-scope.
`maxConcurrency` maps directly to the IR field of the same name.

---

## 4. Sub-workflows

Multiple workflows in a single file. Sub-workflows are called by name like
task calls but dispatch to the workflow definition, not an external task.

```
workflow handleEmail(data: Data): Result {
    const sent = email.send(data)
    const logged = audit.log(sent)
    return sent
}

workflow handleSlack(data: Data): Result {
    const posted = slack.post(data)
    return posted
}

workflow dispatch(category: string, data: Data): Result {
    switch (category) {
        case "email":
            return handleEmail(data)
        case "slack":
            return handleSlack(data)
        default:
            return fallback.handle(data)
    }
}
```

Sub-workflow calls are visually rendered as collapsed nodes that can be
drilled into to see the internal structure.

Each sub-workflow compiles to its own `WorkflowBody` in the IR's
top-level `workflows` table, and each call site becomes a
`WorkflowCallNode` (kind `"workflowCall"`) that references the body by
name. Calls execute in an isolated child frame; the call graph must be
acyclic (recursion is statically rejected in v1). The visual editor
still shows sub-workflows as collapsed nodes (drill-in) based on the
AST.

`export workflow foo(...) { ... }` marks a workflow as exportable so
other `.wf` files can import it:

```
// helpers.wf
export workflow summarize(text: string): string { ... }

// main.wf
import { summarize } from "./helpers.wf"
import { summarize as fancySummarize } from "./other.wf"

workflow main(text: string): string {
    return summarize(text)
}
```

`as` is a **contextual keyword**: it is only special inside an import
specifier and remains a valid identifier name elsewhere in `.wf` source.

A workflow is the program entry when (a) it is the only workflow in the
entry file, (b) it is the only `export workflow` in the entry file, or
(c) it is named explicitly via `wfc --entry <name>`. Imports never
become the program entry — only workflows declared in the entry file
are eligible. See [`workflow-composition.md`](./workflow-composition.md)
for the full semantics.

---

## 5. Full examples

### 5.1 d1-standup-prep

```
workflow standupPrep(repos: string[], author: string): string {
    const authorArg = `--author=${author}`
    const sections = map(repos, (repo) => {
        const gitResult = shell.exec({ command: "git", args: ["log", "--since=yesterday", authorArg, "--oneline"], cwd: repo })
        return `## ${repo}\n${gitResult.stdout}`
    })
    const joined = string.join(sections, "\n\n")
    return joined
}
```

### 5.2 d8-summarize-url

```
workflow summarizeUrl(url: string, outputPath: string): { path: string, summary: string } {
    const summaryPrompt = "Summarize the following web page content in 3-5 paragraphs. Focus on the main points and key information. Be clear and concise.\n\nContent:\n"
    const maxRetries = 2

    const fetchResult = attempts(maxRetries, () => {
        http.get({ url: url })
    })

    const prompt = `${summaryPrompt}${fetchResult.body}`
    const summaryResult = llm.generate(prompt)
    const writeResult = file.write({ path: outputPath, content: summaryResult })

    return { path: writeResult, summary: summaryResult }
}
```

### 5.3 Parallel analysis with conditional notification

```
workflow analyzeDocument(document: string, notifyEmail: string): { text: string, image: string } {
    const [textResult, imageResult] = parallel(
        () => text.analyze(document),
        () => image.analyze(document)
    )

    if (textResult.hasSensitiveContent) {
        notify.send({ to: notifyEmail, body: "Sensitive content detected" })
    }

    return { text: textResult.summary, image: imageResult.tags }
}
```

### 5.4 Map with attempts and filter

```
workflow processReliable(urls: string[]): string[] {
    const fetched = map(urls, (url) => {
        attempts(3, () => {
            http.get({ url: url })
        })
    })

    const valid = filter(fetched, (page) => {
        validator.hasContent(page)
    })

    const summaries = map(valid, (page) => {
        llm.summarize(page.body)
    })

    return summaries
}
```

### 5.5 Parallel map with concurrency

```
workflow processBatch(items: Item[]): Result[] {
    const results = parallelMap(items, (item) => {
        const validated = validator.check(item)
        processor.run(validated)
    }, { maxConcurrency: 5 })
    return results
}
```

### 5.6 Multi-way dispatch with sub-workflow

```
workflow routeMessage(channel: string, message: string): Result {
    switch (channel) {
        case "email":
            return sendEmail(message)
        case "slack":
            return sendSlack(message)
        default:
            return logUnknown(channel, message)
    }
}

workflow sendEmail(message: string): Result {
    const formatted = text.template(`<html><body>${message}</body></html>`)
    const sent = email.send({ body: formatted })
    return sent
}

workflow sendSlack(message: string): Result {
    const sent = slack.post({ text: message })
    return sent
}

workflow logUnknown(channel: string, message: string): Result {
    const logged = log.warn(`Unknown channel: ${channel}`)
    return logged
}
```

---

## 6. AST node types

| Node type           | Fields                                   | Visual element                  |
| ------------------- | ---------------------------------------- | ------------------------------- |
| WorkflowDecl        | name, params, returnType, body           | Top-level container             |
| ConstStatement      | name, typeAnnotation?, value             | Node with output edge           |
| DestructuringConst  | names, value                             | Node with multiple edges        |
| TaskCallExpr        | task, args                               | Node (orange)                   |
| WorkflowCallExpr    | name, args                               | Collapsed node (drill-in)       |
| TemplateLiteralExpr | parts, expressions                       | Node (purple)                   |
| StringLiteralExpr   | value                                    | Inline label                    |
| NumberLiteralExpr   | value                                    | Inline label                    |
| BooleanLiteralExpr  | value                                    | Inline label                    |
| NullLiteralExpr     |                                          | Inline label                    |
| ArrayLiteralExpr    | elements                                 | Inline label                    |
| ObjectLiteralExpr   | entries                                  | Inline label                    |
| DottedNameExpr      | segments                                 | Edge label                      |
| BinaryExpr          | op, left, right                          | Inline in condition/value       |
| UnaryExpr           | op, operand                              | Inline in condition/value       |
| TernaryExpr         | condition, consequent, alternate         | Diamond + two edges             |
| IfStatement         | condition, then, else\_?                 | Branch group                    |
| SwitchStatement     | discriminant, arms, default\_?           | Multi-branch group              |
| BreakStatement      |                                          | _(structural, not rendered)_    |
| ThrowStatement      | value                                    | Terminal node (red, error)      |
| ReturnStatement     | value                                    | Terminal node (red)             |
| AttemptsNode        | count, body, fallback?                   | "attempts" group (green border) |
| MapNode             | collection, param, body                  | "map" group (blue border)       |
| FilterNode          | collection, param, body                  | "filter" group (teal border)    |
| ParallelNode        | bodies, maxConcurrency?                  | Side-by-side group              |
| ParallelMapNode     | collection, param, body, maxConcurrency? | "parallel map" group            |

Every AST node carries a `loc` field with source location (`{ line, col,
offset }`). This enables:

- **Text editor:** squiggly underlines on type errors, "go to definition"
- **Visual editor:** click a node to highlight the corresponding source line
- **Error messages:** `"line 12, col 5: cannot compare number with string"`

### Comments

The AST preserves comments. Comments come in three flavors based on
where they are anchored:

- `leadingComments` (on any AST node): comments that appear immediately
  before the node, attached to the following node. `ParamDecl` also
  carries `leadingComments` and `trailingComments` so comments
  between, before, or after individual parameters round-trip.
- `trailingComments` (on each `Statement`): comments that appear after a
  statement. A comment is considered _inline trailing_ if its source line
  equals the statement's `endLine` (e.g. `return x; // why`); otherwise it
  is a _block-end trailing_ comment (a comment that appears between the
  last statement of a block and the block's closing `}`, `case`, or
  `default`). Inline and block-end trailing comments share the same
  `trailingComments` array — the renderer distinguishes them by
  comparing each comment's line against the statement's `endLine`.
- Per-position **inner** comment buckets carry comments that appear
  _inside_ an otherwise-empty block. Every block-bearing node has its
  own field so the comment never silently drops:
  - `WorkflowDecl.innerComments` — empty workflow body.
  - `WorkflowDecl.paramInnerComments` — inside `(` … `)` when the
    parameter list is empty.
  - `IfStatement.thenInnerComments` / `elseInnerComments` — empty
    `then` / `else` block.
  - `IfStatement.elseLeadingComments` — between the `}` of the `then`
    block and the `else` keyword (e.g. `} /* note */ else`).
  - `SwitchStatement.defaultInnerComments` — empty `default:` arm.
  - `SwitchStatement.innerComments` — comments inside an empty
    `switch (x) { }` body, and any pre-first-arm comments.
  - `SwitchStatement.defaultLeadingComments` — comments immediately
    before the `default` keyword.
  - `SwitchArm.innerComments` — empty `case` arm body.
  - `SwitchArm.leadingComments` — comments immediately before the
    `case` keyword (e.g. a `// before case 2` line).
  - `ObjectType.innerComments` — comments inside an empty object
    type body (`{ /* shape: empty */ }`).
  - `ObjectTypeField.leadingComments` / `trailingComments` —
    comments on each side of an object-type field's `,`. The field
    also carries an `endLine` used for inline-vs-own-line trailing
    placement.
  - `AttemptsNode.bodyInnerComments` / `fallback.bodyInnerComments`,
    `MapNode.bodyInnerComments`, `FilterNode.bodyInnerComments`,
    `ParallelMapNode.bodyInnerComments`, and
    `ParallelNode.bodies[i].bodyInnerComments`.
  - `WorkflowDecl.trailingComments` — comments that appear AFTER the
    workflow's closing `}` (between the brace and EOF). No statement
    can carry them, so they hang off the declaration itself.

Each comment is a `Comment { text, pos }` where `text` includes the
delimiters (`//…` or `/* … */`). Statements and `ParamDecl` carry an
additional `endLine` field — the source line of the node's last token
— used solely to drive inline-vs-own-line rendering of trailing
comments.

Supported comment forms:

- `//` line comments
- `/* */` block comments

The text serializer (AST → source) emits comments in their attached
positions. Inline trailing comments are rendered on the same line as
the host node (after the terminator), block-end trailing comments are
rendered on their own indented line, and the per-position inner
buckets are emitted on their own indented lines inside the empty
block (or `(` `)` for `paramInnerComments`). This ensures
round-tripping (source → AST → source → AST) preserves comment
attachment. _(from principle 6: AST is canonical)_

No ArrowFunction in the AST: the parser dissolves arrow function syntax into
the parent built-in node's `body` field directly.

### Layout-preservation flags

Three AST flags let the text serializer preserve the source's
choice of inline vs. multi-line layout for constructs that have
both:

- `WorkflowDecl.paramListMultiLine` — `true` when the source put
  the parameter list across multiple lines.
- `ObjectType.multiLine` — same for object-type literals.
- `IfStatement.elseOnNewLine` — `true` when the source put the
  `else` keyword on a different line from the preceding `}`.

The serializer respects these flags unconditionally and otherwise
falls back to a `printWidth`-driven decision (`FormatOptions.printWidth`,
default 100): inline if the projected single-line emission fits,
multi-line otherwise. Comments that cannot live in the inline
layout (e.g. a `//` line comment between parameters) always force
multi-line regardless of the flags.

---

## 7. Compiler specification

### 7.1 Lexer

Tokens:

- Keywords: `workflow`, `const`, `return`, `if`, `else`, `switch`, `case`,
  `default`, `break`, `throw`, `true`, `false`, `null`
- `Arrow` (`=>`) for arrow functions
- `QuestionMark` (`?`) and `Colon` (`:`) for ternary and switch arms
- Comparison operators: `===`, `!==`, `>`, `<`, `>=`, `<=`
- Logical operators: `&&`, `||`, `!`
- Arithmetic operators: `+`, `-`, `*`, `/`, `%`
- `==` and `!=` are recognized but produce a compile error:
  `"use === instead of == (no implicit coercion)"`
- String literals, template literals, number literals, identifiers
- Structural: `{`, `}`, `(`, `)`, `[`, `]`, `,`, `.`, `;`

### 7.2 Parser

The parser is recursive-descent, producing a typed AST. It handles:

- Workflow declarations with typed parameters and return types
- `const` bindings with optional type annotations
- Arrow function expressions: `(param, ...) => { body }` and `() => expr`
- Built-in call recognition: after parsing a call expression, check if callee
  is in `{ attempts, map, filter, parallel, parallelMap }`. If so, restructure
  into dedicated AST node.
- Ternary expressions: `expr ? expr : expr`
- Binary expressions with precedence (lowest to highest):

  | Level | Operators            | Associativity  |
  | ----- | -------------------- | -------------- |
  | 0     | `?:` (ternary)       | right          |
  | 1     | `\|\|`               | left           |
  | 2     | `&&`                 | left           |
  | 3     | `===`, `!==`         | left           |
  | 4     | `<`, `>`, `<=`, `>=` | left           |
  | 5     | `+`, `-`             | left           |
  | 6     | `*`, `/`, `%`        | left           |
  | 7     | `!`, unary `-`       | right (prefix) |
  | 8     | `.` (member), `()`   | left           |

- Unary expressions: `!expr`, `-expr`
- Switch statement: `switch (expr) { case lit: stmts break ... default: stmts break }`
- Destructuring const: `const [a, b, c] = expr`
- Throw statement: `throw expr`
- Task call expressions: `namespace.task({ ... })` or `namespace.task(arg)`
- Dotted name expressions for field access
- Literals: strings, template literals, numbers, booleans, null, arrays, objects
- `if/else` statements
- `switch/case/default` statements with `break`
- `return` statements

### 7.3 Type checker

A compiler phase between parsing and emission. Walks the AST and assigns
a type to every expression. Reports errors for type mismatches. See section
2.14 for the full type system specification.

Type sources:

- **Literals:** inferred (`42` is `number`, `"hello"` is `string`, `true` is
  `boolean`).
- **Task calls:** return type from the task schema.
- **Workflow calls:** return type from the workflow declaration.
- **Dotted access:** field type from the parent object's schema.
- **Operators:** result type from the operator type rules (see section 2.6).
- **Ternary:** both arms must have the same type; that is the result type.
- **Template literals:** always `string`.
- **Built-ins:** `map` and `filter` return arrays of the body's type.
  `attempts` returns the body's type (or `body | fallback` if fallback returns
  a different type). `parallel` returns a tuple.

Type annotations on `const` are optional. The compiler infers the type from
the initializer expression. Explicit annotations are allowed for documentation
or to constrain the type:

```
const x = ai.analyze(data)              // type inferred from task schema
const y: string = ai.analyze(data)      // explicit: compile error if schema disagrees
```

Strict rules (deviations from TS):

- No implicit coercion. `number + string` is a compile error.
- `===` / `!==` require both operands to be the same type.
- `&&` / `||` require `boolean` operands (no truthy/falsy).
- `if` and ternary conditions must be `boolean`, not just truthy.
- `+` is arithmetic only; use template literals for string concatenation.

### 7.4 Emitter

The emitter lowers the typed AST to IR. It manages scopes, resolves names,
generates nodes, and applies several post-processing passes.

#### Scope model

The emitter uses a chain of `ScopeContext` objects with parent pointers
for lexical scoping. Each scope tracks:

- `nodes`: IR nodes generated in this scope
- `nodeOrder`: insertion order (drives `next` threading)
- `bindings`: `Map<string, Binding>` mapping names to resolution info
- `parent`: enclosing scope (walked for name lookup)

Child scopes are created for if/else branches, switch arms, loop bodies,
attempts bodies, and parallel branches.

#### Binding kinds

| Kind          | Resolves to         | Origin                              |
| ------------- | ------------------- | ----------------------------------- |
| `"node"`      | `$from: "scope"`    | `const x = task.call(...)` binding  |
| `"param"`     | `$from: "input"`    | Workflow parameter                  |
| `"constant"`  | `$from: "constant"` | `const` with literal value          |
| `"loopInput"` | `$from: "input"`    | Value captured into loop body scope |
| `"literal"`   | Inlined value       | Inline template value (not a node)  |

Name resolution walks the scope chain from innermost to outermost.
There is no `input.` prefix in the DSL: parameter names resolve directly
(e.g., `url` not `input.url`). Remaining path segments after the binding
name become the `path` array on the emitted `$from` template reference.

Shadowing follows standard lexical scoping: if an inner loop parameter
has the same name as an outer binding, the inner binding wins and the
outer one becomes inaccessible within that scope. No warning is produced.

```
const results = map(items, (item) => {
    const inner = map(item.children, (item) => {   // shadows outer "item"
        task.process(item)                          // refers to inner "item"
    })
})
```

#### Scope capture for loop and fork bodies

Loop bodies (`map`, `filter`, `attempts`, `parallelMap`) and fork branches
execute in isolated sub-scopes in the IR. When the DSL body references a
variable defined outside (a workflow parameter or an earlier task result),
the emitter must explicitly pass that value into the sub-scope.

After emitting all nodes in a body scope, the emitter runs
`captureOuterRefs(bodyScope)`. This walks every `$from` reference in the
body's nodes and identifies references that target names outside the body:

- **Outer node references** (`$from: "scope"` where the name is not a
  node in the body) are rewritten in-place to `$from: "input"`. The
  original outer Template is recorded.
- **Workflow param references** (`$from: "input"` where the name is not
  already a declared body input) are recorded as-is.

The captured references are then merged into the loop/fork node:

- `inputs`: `{ items: collectionRef, ...capturedRefs }` - outer values
  fed into the sub-scope alongside the iteration collection.
- `body.inputSchema.properties`: declares each captured name.
- `body.inputSchema.required`: marks each captured name required.

At runtime, the engine resolves `{ $from: "input", name: "x" }` inside
the body from the enclosing node's `inputs` map, which holds the outer
Template pointing to the original source.

This mechanism is invisible to the DSL author: they reference outer
variables freely and the emitter handles plumbing.

#### Next threading

After all nodes in a scope are emitted, `threadNext` iterates `nodeOrder`
sequentially. For each non-branch node that does not already have a `next`,
it sets `next` to the following node in order. Branch nodes are skipped
(they use `cases`/`default`). Already-set `next` values (from explicit
wiring like `onError` edges) are preserved.

#### Conditional bind stripping

The emitter tracks which node bindings are actually referenced downstream.
After emission, `stripUnreferencedBinds` removes the `bind` field from
task nodes whose names are never used. This keeps the IR minimal without
requiring the author to think about it.

#### Lowering rules

- BinaryExpr / UnaryExpr: operators lower to built-in task nodes.
  `&&` and `||` are special-cased to branch nodes for short-circuit
  evaluation (same pattern as ternary). All other operators map as:

  | Operator  | Task                     | Operator | Task            |
  | --------- | ------------------------ | -------- | --------------- |
  | `===`     | `compare.equals`         | `+`      | `math.add`      |
  | `!==`     | `compare.notEquals`      | `-`      | `math.subtract` |
  | `>`       | `compare.greaterThan`    | `*`      | `math.multiply` |
  | `<`       | `compare.lessThan`       | `/`      | `math.divide`   |
  | `>=`      | `compare.greaterOrEqual` | `%`      | `math.modulo`   |
  | `<=`      | `compare.lessOrEqual`    | `!`      | `bool.not`      |
  | unary `-` | `math.negate`            |          |                 |

  Syntactic sugar only; invisible to the workflow author.

- TemplateLiteralExpr: emits a `text.template` task node. Static string
  segments and interpolation slots are combined into a single template
  string using `{{varName}}` placeholders. Each interpolated expression
  is resolved via `emitExpr()` and stored in an `inputs.vars` map:

  ```
  `Hello ${user.name}, you have ${count} items`
  ```

  becomes:

  ```json
  {
    "kind": "task",
    "task": "text.template",
    "inputs": {
      "template": "Hello {{name}}, you have {{count}} items",
      "vars": {
        "name": { "$from": "scope", "name": "userNode", "path": ["name"] },
        "count": { "$from": "scope", "name": "countNode" }
      }
    }
  }
  ```

  Variable names in the template are derived from the last segment of
  dotted names (e.g., `user.name` becomes `{{name}}`), or positional
  names (`v0`, `v1`) for complex expressions.

- AttemptsNode: emit loop node with onError edges and attempt counter
- MapNode: emit loop node with index/length/compare/check_done
- FilterNode: emit loop with branch + `list.append` (see section 3.3 IR lowering)
- ParallelNode: emit `fork` node ([ir-v0.2.md](../ir/ir-v0.2.md)) with branches
  per arrow function and optional `maxConcurrency`
- ParallelMapNode: emit `forkMap` node ([ir-v0.2.md](../ir/ir-v0.2.md)) with
  collection, body sub-scope, and optional `maxConcurrency`
- TernaryExpr: emit branch node with condition and two output edges
- SwitchStatement: emit a chain of condition-check nodes (one per case arm).
  Each check compares the discriminant to the arm's value using `compare.equals`.
  A true result routes to that arm's body; a false result chains to the next
  check. The default arm (if present) is the final false edge. All arm bodies
  merge to a shared continuation node.
- WorkflowCallExpr: emit sub-workflow invocation (inline or reference)
- ThrowStatement: emits an `error.fail` built-in task node
  ([ir-v0.2.md](../ir/ir-v0.2.md) §3.5). The preceding node's `next` points
  to `error.fail`; `error.fail` has `next: null` (terminal). The engine
  executes `error.fail` and produces a failure result with the thrown
  value, which triggers the enclosing scope's error propagation. In an
  attempts fallback body, this causes the fallback handler to fail per
  ir-v0.1.md section 3.8 recovery-failure semantics. At workflow top level, it fails the
  workflow. No new IR node kind is needed: `error.fail` is a regular
  task node with `kind: "task"`.

### 7.5 Graph extractor

Already walks the AST. New node types need handlers:

- AttemptsNode -> GraphGroup { kind: "attempts" }
- MapNode -> GraphGroup { kind: "map" }
- FilterNode -> GraphGroup { kind: "filter" }
- ParallelNode -> GraphGroup { kind: "parallel" }
- ParallelMapNode -> GraphGroup { kind: "parallelMap" }
- TernaryExpr -> GraphNode { kind: "branch" } with two edges
