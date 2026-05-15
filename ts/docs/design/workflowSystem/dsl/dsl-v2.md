# Workflow DSL v2

Status: **Implemented.** All phases complete (lexer, parser, type checker, emitter, graph extractor).

Compile target: [ir-v1.md](../ir/ir-v1.md) + [ir-v2.md](../ir/ir-v2.md) (new node kinds: `fork`, `forkMap`).
Design rationale: [dsl-comparison.md](dsl-comparison.md) (Option E selected).

---

## 1. Overview

DSL v2 is an evolution of v1 (Option A, TS-like) to Option E (TS + built-ins).
The core change: replace general-purpose imperative control flow (`while`, `for`,
`try/catch`, `break`, `continue`) with compiler-recognized built-in functions
(`retry`, `map`, `filter`, `parallel`) that take arrow function arguments.

### 1.1 Guiding principles

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
   (retry, map, filter, parallel) should be first-class, not emergent from
   combining lower-level primitives. The DSL vocabulary should match the visual
   vocabulary: a "retry group" in the graph corresponds to a `retry()` in the
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

3. **No try/catch.** Error handling is expressed via the `retry` built-in.
   _(from principle 4)_

4. **Statements vs expressions.** `if/else` and `switch` are statements
   (side effects only, no value). `?:` (ternary) is an expression for
   simple value selection. Sub-workflow calls handle complex value-producing
   branches. _(from principles 2, 5)_

5. **Built-ins are compiler directives.** `retry`, `map`, `filter`, `parallel`
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

### 1.3 What stays from v1

- `workflow` declaration with typed parameters and return type
- `const` for constants and string/number/boolean literals
- Template literals with `${}` interpolation
- Task calls: `namespace.task({ name: value, ... })` with named arguments
- Object literal return: `return { field: expr, ... }`
- `if/else` (statement only, no value)
- `switch` (renamed from `match`, statement only, no value)
- Dotted name expressions for field access

### 1.4 What changes from v1

| v1 (removed)                                 | v2 (replacement)                                      |
| -------------------------------------------- | ----------------------------------------------------- |
| `let x = expr`                               | `const x = expr`                                      |
| `let x: type` (uninitialized)                | Eliminated. All bindings initialized.                 |
| `x = expr` (reassignment)                    | Eliminated. SSA.                                      |
| `for (item of collection) { ... }`           | `const results = map(collection, (item) => { ... })`  |
| `while (true) { try { ... } catch { ... } }` | `const result = retry(n, () => { ... })`              |
| `continue`                                   | Eliminated. Built-ins handle control flow internally. |
| `break` (loop control)                       | Eliminated. `break` exists only in switch arms.       |
| `match` keyword                              | `switch` keyword (TS alignment)                       |
| Need a value from if/else                    | `const x = cond ? exprA : exprB`                      |
| Need a value from switch                     | Sub-workflow with `return` in each arm                |
| Sequential execution only                    | `const [a, b] = parallel(() => ..., () => ...)`       |

### 1.5 What's new in v2

| Feature                | Syntax                                         | AST node         | Visual element                      |
| ---------------------- | ---------------------------------------------- | ---------------- | ----------------------------------- |
| Arrow functions        | `(param) => { body }`                          | ArrowFunction    | Group boundary                      |
| `retry` built-in       | `retry(n, () => { body }, fallback?)`          | RetryNode        | "retry" group with badge            |
| `map` built-in         | `map(coll, (item) => { body })`                | MapNode          | "map" group with iteration badge    |
| `filter` built-in      | `filter(coll, (item) => { body })`             | FilterNode       | "filter" group with predicate badge |
| `parallel` built-in    | `parallel(() => a, () => b, opts?)`            | ParallelNode     | Side-by-side group                  |
| `parallelMap` built-in | `parallelMap(coll, (item) => { body }, opts?)` | ParallelMapNode  | "parallel map" group                |
| Ternary expression     | `cond ? exprA : exprB`                         | TernaryExpr      | Diamond with two edges              |
| Sub-workflow calls     | `subWorkflow(args)`                            | WorkflowCallExpr | Collapsed node (drill-in)           |

---

## 2. Syntax

### 2.1 Workflow declaration

```
workflow NAME(PARAM: TYPE, ...): RETURN_TYPE {
    STATEMENTS
}
```

Unchanged from v1. Multiple workflows can be defined in a single file.
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

### 2.4 Template literals

```
const prompt = `Hello ${name}, your order ${order.id} is ready`
```

Unchanged from v1. Backtick syntax with `${}` interpolation.

### 2.5 Constants

```
const maxRetries = 2
const baseUrl = "https://api.example.com"
```

String, number, and boolean literals. Unchanged from v1.

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
in a retry fallback.

```
const result = retry(2, () => {
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
return { path: writeResult.path, summary: summaryResult.text }
```

Object literal return for multi-field output. Unchanged from v1.

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

---

## 3. Built-in functions

Built-in functions are compiler directives, not runtime functions. The parser
recognizes them by name and produces dedicated AST nodes. The emitter lowers
them to IR patterns.

### 3.1 `retry(count, body, fallback?)`

Retry the body up to `count` times on error. Optional fallback runs after
all retries are exhausted.

```
const result = retry(2, () => {
    http.get({ url: url })
})
```

With fallback (cleanup then rethrow):

```
const result = retry(2, () => {
    const uploaded = storage.upload(data)
    cluster.deploy(uploaded)
}, (err) => {
    storage.cleanup({ prefix: data.id })
    throw err
})
```

With fallback (substitute value):

```
const result = retry(2, () => {
    http.get({ url: url })
}, (err) => {
    cache.lookup({ url: url })
})
```

- `count`: number literal or const reference
- `body`: arrow function containing one or more task calls
- `fallback`: optional arrow function with one parameter (the error).
  Can return a substitute value or `throw` to propagate the error.
- Returns the successful result of the body, or the fallback's return value
- On exhaustion without fallback: runtime error

**AST:** `RetryNode { count, body: Statement[], fallback?: Statement[] }`
**IR lowering:** Loop node with onError edges and attempt counter (same
machinery as v1's while+try/catch, but generated by compiler).

### 3.2 `map(collection, body)`

Apply body to each item, collect results.

```
const sections = map(repos, (repo) => {
    const gitResult = shell.exec({ command: "git log", args: [repo] })
    text.template(`## ${repo}\n${gitResult.stdout}`)
})
```

- `collection`: expression resolving to an array
- `body`: arrow function with one parameter (the item)
- Returns an array of the body's last expression per item

**AST:** `MapNode { collection: Expr, param: string, body: Statement[] }`
**IR lowering:** Loop node with index/length/compare/check_done machinery
(same as v1's for..of, but no explicit accumulator).

### 3.3 `filter(collection, body)`

Keep items where body returns truthy.

```
const valid = filter(items, (item) => {
    validator.isValid(item)
})
```

- `collection`: expression resolving to an array
- `body`: arrow function returning a boolean-producing task call
- Returns a filtered array

**AST:** `FilterNode { collection: Expr, param: string, body: Statement[] }`
**IR lowering:** Loop node (same as `map`) with a branch node inside the body.
The body's last expression must produce a `boolean`. The emitter inserts a
branch node that checks this result: the true branch appends the element to
the output array via a `list.append` built-in task; the false branch skips
(no-op, advances to next iteration). The output is the accumulated array.

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

**AST:** `ParallelNode { bodies: ArrowFunction[], maxConcurrency?: Expr }`
**IR lowering:** `fork` node ([ir-v2.md](../ir/ir-v2.md) §2.1). Each arrow function
becomes a named branch sub-scope. Destructuring bindings become branch names.
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
**IR lowering:** `forkMap` node ([ir-v2.md](../ir/ir-v2.md) §2.2). Collection
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

Sub-workflows are inlined at compile time: the compiler expands the
sub-workflow body into the calling workflow's IR. The visual editor
still shows them as collapsed nodes (drill-in) based on the AST.

---

## 5. Full examples

### 5.1 d1-standup-prep (v2)

```
workflow standupPrep(author: string, repos: string[]): string {
    const authorArg = `--author=${author}`
    const sections = map(repos, (repo) => {
    const gitResult = shell.exec({ command: "git log", args: [authorArg, repo] })
    text.template(`## ${repo}\n${gitResult.stdout}`)
    })
    const joined = string.join({ items: sections, separator: "\n\n" })
    return joined
}
```

### 5.2 d8-summarize-url (v2)

```
workflow summarizeUrl(url: string, outputPath: string): { path: string, summary: string } {
    const summaryPrompt = "Summarize the following web page content in 3-5 paragraphs. Focus on the main points and key information. Be clear and concise.\n\nContent:\n"
    const maxRetries = 2

    const fetchResult = retry(maxRetries, () => {
        http.get({ url: url })
    })

    const prompt = `${summaryPrompt}${fetchResult.body}`
    const summaryResult = llm.generate(prompt)
    const writeResult = file.write({ path: outputPath, content: summaryResult })

    return { path: writeResult.path, summary: summaryResult.text }
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

### 5.4 Map with retry and filter

```
workflow processReliable(urls: string[]): string[] {
    const fetched = map(urls, (url) => {
        retry(3, () => {
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

| Node type           | Fields                           | Visual element               |
| ------------------- | -------------------------------- | ---------------------------- |
| WorkflowDecl        | name, params, returnType, body   | Top-level container          |
| ConstStatement      | name, type?, value               | Node with output edge        |
| TaskCallExpr        | namespace, task, args            | Node (orange)                |
| WorkflowCallExpr    | name, args                       | Collapsed node (drill-in)    |
| TemplateLiteralExpr | parts, expressions               | Node (purple)                |
| StringLiteralExpr   | value                            | Inline label                 |
| NumberLiteralExpr   | value                            | Inline label                 |
| BooleanLiteralExpr  | value                            | Inline label                 |
| NullLiteralExpr     |                                  | Inline label                 |
| ArrayLiteralExpr    | elements                         | Inline label                 |
| ObjectLiteralExpr   | fields                           | Inline label                 |
| DottedNameExpr      | parts                            | Edge label                   |
| BinaryExpr          | op, left, right                  | Inline in condition/value    |
| UnaryExpr           | op, operand                      | Inline in condition/value    |
| TernaryExpr         | condition, consequent, alternate | Diamond + two edges          |
| IfStatement         | condition, thenBody, elseBody?   | Branch group                 |
| SwitchStatement     | discriminant, arms, default?     | Multi-branch group           |
| ThrowStatement      | value                            | Terminal node (red, error)   |
| ReturnStatement     | value                            | Terminal node (red)          |
| RetryNode           | count, body, fallback?           | "retry" group (green border) |
| MapNode             | collection, param, body          | "map" group (blue border)    |
| FilterNode          | collection, param, body          | "filter" group (teal border) |
| ParallelNode        | bodies, bindings                 | Side-by-side group           |
| ParallelMapNode     | collection, param, body          | "parallel map" group         |

Every AST node carries a `pos` field with source location (`{ line, column,
offset }`). This enables:

- **Text editor:** squiggly underlines on type errors, "go to definition"
- **Visual editor:** click a node to highlight the corresponding source line
- **Error messages:** `"line 12, col 5: cannot compare number with string"`

### Comments

The AST preserves comments. Each node has an optional `leadingComments` array
of `Comment { text, pos }` attached to the following AST node. Comments are:

- `//` line comments
- `/* */` block comments

The text serializer (AST to source) emits comments in their original positions.
The visual editor can display comments as annotations or tooltips on the
associated visual element. This ensures round-tripping (source to AST to source)
preserves comments. _(from principle 6: AST is canonical)_

No ArrowFunction in the AST: the parser dissolves arrow function syntax into
the parent built-in node's `body` field directly.

---

## 7. Compiler changes from v1

### 7.1 Lexer

Add tokens:

- `Arrow` (`=>`) for arrow functions
- `QuestionMark` (`?`) for ternary
- `Colon` (`:`) already exists, used in ternary and switch arms
- `Switch`, `Case`, `Default` keywords
- `Break` keyword (only valid in switch arms)
- `Throw` keyword
- Comparison operators: `===`, `!==`, `>`, `<`, `>=`, `<=`
- Logical operators: `&&`, `||`, `!`
- Arithmetic operators: `+`, `-`, `*`, `/`, `%`
- `==` and `!=` are recognized by the lexer but produce a compile error:
  `"use === instead of == (no implicit coercion)"`

Remove tokens:

- `Let`, `While`, `For`, `Of`, `Try`, `Catch`, `Continue`

### 7.2 Parser

Add parsing:

- Arrow function expressions: `(param, ...) => { body }` and `() => expr`
- Built-in call recognition: after parsing a call expression, check if callee
  is in `{ retry, map, filter, parallel, parallelMap }`. If so, restructure
  into dedicated AST node.
- Ternary expressions: `expr ? expr : expr`
- Binary expressions with precedence: `expr op expr` for comparison, logical,
  and arithmetic operators. Standard TS precedence rules.
- Unary expressions: `!expr`, `-expr`
- Switch statement: `switch (expr) { case lit: stmts break ... default: stmts break }`
- Destructuring const: `const [a, b, c] = expr`
- Throw statement: `throw expr`

Remove parsing:

- `let` declarations
- `while` loops
- `for..of` loops
- `try/catch` blocks
- `continue` statements
- `break` in loops (break is retained for switch arms only)
- Assignment statements (`x = expr`)

### 7.3 Type checker (new phase)

A new compiler phase between parsing and emission. Walks the AST and assigns
a type to every expression. Reports errors for type mismatches.

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
  `retry` returns the body's type (or `body | fallback` if fallback returns
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

- BinaryExpr / UnaryExpr: most operators lower to task nodes (e.g., `===`
  becomes `compare.equals`, `+` becomes `math.add`). `&&` and `||` lower
  to branch nodes for short-circuit evaluation (same pattern as ternary).
  Syntactic sugar only; invisible to the workflow author.
- RetryNode: emit loop node with onError edges and attempt counter
  (same machinery as v1's while+try/catch lowering, factored into a
  dedicated emitter method)
- MapNode: emit loop node with index/length/compare/check_done
  (same as v1's for..of lowering, without explicit accumulator)
- FilterNode: emit loop with branch + `list.append` (see §3.3 IR lowering)
- ParallelNode: emit `fork` node (ir-v2) with named branches per arrow function
  and optional `maxConcurrency`
- ParallelMapNode: emit `forkMap` node (ir-v2) with collection, body sub-scope,
  and optional `maxConcurrency`
- TernaryExpr: emit branch node with condition and two output edges
- SwitchStatement: emit multi-way branch node
- WorkflowCallExpr: emit sub-workflow invocation (inline or reference)
- ThrowStatement: emits an `error.fail` built-in task node
  ([ir-v2.md](../ir/ir-v2.md) §3.5). The preceding node's `next` points
  to `error.fail`; `error.fail` has `next: null` (terminal). The engine
  executes `error.fail` and produces a failure result with the thrown
  value, which triggers the enclosing scope's error propagation. In a
  retry fallback body, this causes the fallback handler to fail per v1
  §3.8 recovery-failure semantics. At workflow top level, it fails the
  workflow. No new IR node kind is needed: `error.fail` is a regular
  task node with `kind: "task"`.

### 7.5 Graph extractor

Already walks the AST. New node types need handlers:

- RetryNode -> GraphGroup { kind: "retry" }
- MapNode -> GraphGroup { kind: "map" }
- FilterNode -> GraphGroup { kind: "filter" }
- ParallelNode -> GraphGroup { kind: "parallel" }
- ParallelMapNode -> GraphGroup { kind: "parallelMap" }
- TernaryExpr -> GraphNode { kind: "branch" } with two edges

---

## 8. Migration from v1

v1 `.wf` files can be mechanically translated:

| v1 pattern                                   | v2 equivalent                                  |
| -------------------------------------------- | ---------------------------------------------- |
| `let x = expr`                               | `const x = expr`                               |
| `for (item of coll) { ... list.append ... }` | `const results = map(coll, (item) => { ... })` |
| `while (true) { try { ... } catch { ... } }` | `const result = retry(n, () => { ... })`       |
| `match (x) { ... }`                          | `switch (x) { ... }`                           |
| Variables assigned in if/else                | `const x = cond ? a : b` or sub-workflow       |

v1 `.wf` files can be mechanically migrated before switching to the v2
compiler. The v1 compiler is replaced, not kept alongside.

---

## 9. Open questions

1. ~~**Sub-workflow compilation.** Inline at compile time, or compile as separate
   IR workflows with a call mechanism? Inlining is simpler but may bloat IR.~~
   **Resolved:** Inlined at compile time. Sub-workflows use arrow function
   syntax `() => { ... }` and are expanded into the calling workflow's IR.
   Simpler for the engine; IR bloat is acceptable for now. Post-v2: add
   separate compilation (like functions) with imports across files.

2. ~~**Error handling beyond retry.** `retry` handles "try N times". What about
   "on error, do X instead" (fallback)? Could extend: `retry(n, body, fallback)`.~~
   **Resolved:** `retry(n, body, fallback)` with optional third argument.
   Fallback receives the error, can return a substitute value or `throw` to
   propagate. `throw` is a new statement (valid TS syntax, no deviation).
   Cleanup-then-rethrow pattern: do cleanup in fallback, then `throw err`.
   Saga/compensation patterns are post-v2. See sections 2.10 and 3.1.

3. ~~**Built-in extensibility.** Is the set `{ retry, map, filter, parallel,
parallelMap }` closed, or should users be able to define custom built-ins?
   Recommendation: closed for now. Add new built-ins as needed.~~
   **Resolved:** Closed set. New built-ins are added to the compiler as
   needed. Users cannot define custom built-ins.

4. ~~**Type inference.** v1 required explicit types on uninitialized `let`. With
   SSA, types can be inferred from the initializer expression in most cases.
   Should type annotations be optional on `const`?~~
   **Resolved:** Type annotations are optional. The compiler infers types from
   initializer expressions. Explicit annotations are allowed for documentation
   or to constrain the type. See section 7.3.

5. ~~**Ternary vs if-expression.** We chose ternary for value selection. If
   ternary arms grow complex, the guidance is "use a sub-workflow." Is this
   sufficient, or will users want multi-line ternary arms?~~
   **Resolved:** Ternary arms are intentionally limited to single expressions.
   Complex branches go into sub-workflows (principle 5). Multi-line ternary
   arms would undermine that principle and create visual clutter.

6. ~~**Switch arm syntax.** Using `=>` for switch arms (same as TS). Should arms
   support blocks (`"email" => { stmt1; stmt2; return expr }`) or only single
   expressions?~~
   **Resolved:** Using standard TS `case/break/default` syntax. Each arm
   can contain multiple statements. Every arm must end with `break` or
   `return` (compile error if missing). Fallthrough is supported by omitting
   `break`. `break` is structural (not rendered in the visual editor).
   See section 2.9.
