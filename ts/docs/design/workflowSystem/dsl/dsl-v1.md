# Workflow DSL v1

Status: **Implemented (v1).** Package at `examples/workflow/dsl/`.

Compile target: [ir-v1.md](../ir/ir-v1.md).
Language style decision: [decisions/0001-language-style.md](decisions/0001-language-style.md).

---

## 1. Overview

The workflow DSL is a TypeScript-like language that compiles to
[workflow IR JSON](../ir/ir-v1.md). Its purpose is to absorb the IR's
verbosity tax so that workflow authors write familiar imperative code
while the compiler handles schema restatement, `$from` reference
objects, `next` edge threading, and loop machinery.

The compiler pipeline is: **lex -> parse -> emit**, implemented across
four source files:

| File          | Role                                        |
| ------------- | ------------------------------------------- |
| `lexer.ts`    | Tokenizer with position tracking            |
| `parser.ts`   | Recursive-descent parser producing an AST   |
| `emitter.ts`  | AST-to-IR lowering with scope-based binding |
| `compiler.ts` | Public API orchestrating the three phases   |

All compile errors carry `{ phase, message, line, col }` for
source-position diagnostics. An optional `validate` flag runs the
IR validator after emit.

---

## 2. Syntax

### 2.1 Workflow declaration

```
workflow NAME(PARAM: TYPE, ...): RETURN_TYPE {
    STATEMENTS
}
```

Parameters are positional. Each becomes a property in the IR's
`inputSchema`. The return type becomes `outputSchema`.

### 2.2 Type expressions

| Surface syntax                   | IR JSON Schema                                       |
| -------------------------------- | ---------------------------------------------------- |
| `string`                         | `{ "type": "string" }`                               |
| `number`                         | `{ "type": "number" }`                               |
| `integer`                        | `{ "type": "integer" }`                              |
| `boolean`                        | `{ "type": "boolean" }`                              |
| `string[]`                       | `{ "type": "array", "items": { "type": "string" } }` |
| `{ name: string, age: integer }` | Object schema with `required` + `properties`         |

### 2.3 Statements

| Statement              | Syntax                                                 |
| ---------------------- | ------------------------------------------------------ |
| `let` (with init)      | `let NAME = EXPR;`                                     |
| `let` (typed, no init) | `let NAME: TYPE;` (declares an output variable)        |
| `const`                | `const NAME = EXPR;`                                   |
| Assignment             | `NAME = EXPR;`                                         |
| `for..of`              | `for (VAR of EXPR) { ... }`                            |
| `while`                | `while (EXPR) { ... }` (only `while (true)` supported) |
| `if`/`else`            | `if (EXPR) { ... } else { ... }`                       |
| `try`/`catch`          | `try { ... } catch { ... }`                            |
| `break`                | `break;`                                               |
| `continue`             | `continue;`                                            |
| `return`               | `return EXPR;`                                         |

### 2.4 Expressions

| Expression       | Example                                     |
| ---------------- | ------------------------------------------- |
| Task call        | `http.get({ url: u })` or `llm.generate(p)` |
| Dotted name      | `fetchResult.body`, `author`                |
| String literal   | `"hello\nworld"`                            |
| Template literal | `` `--author=${author}` ``                  |
| Number literal   | `42`, `3.14`                                |
| Boolean literal  | `true`, `false`                             |
| Null literal     | `null`                                      |
| Array literal    | `["a", "b"]`                                |
| Object literal   | `{ key: value, k2: v2 }`                    |

Task calls accept positional or named arguments. Positional arguments
map to schema property names in declaration order. A single object
literal argument is unwrapped into named inputs.

---

## 3. Scope model

The emitter uses a chain of `ScopeContext` objects with parent pointers
for lexical scoping. Each scope tracks:

- `nodes`: emitted IR nodes in this scope
- `nodeOrder`: insertion order (used for `next` threading)
- `bindings`: `Map<string, Binding>` mapping names to resolution info
- `parent`: enclosing scope (walked for name lookup)

### 3.1 Binding kinds

| Kind              | Resolves to         | Origin                              |
| ----------------- | ------------------- | ----------------------------------- |
| `"node"`          | `$from: "scope"`    | `let x = task.call(...)` binding    |
| `"param"`         | `$from: "input"`    | Workflow parameter                  |
| `"constant"`      | `$from: "constant"` | `const` declaration                 |
| `"state"`         | `$from: "state"`    | Loop state variable                 |
| `"loopInput"`     | `$from: "input"`    | Value captured into loop body scope |
| `"literal"`       | Inlined value       | `let x = 0;`, `let x = [];`         |
| `"uninitialized"` | (deferred)          | `let x: type;` (no initializer)     |

Name resolution walks the scope chain from innermost to outermost.
There is no `input.` prefix in the DSL: parameter names resolve
directly (e.g., `url` not `input.url`).

### 3.2 Auto-projection

When a node binding is referenced without a field path (e.g., `joined`
instead of `joined.text`), the emitter auto-projects through
single-field output schemas. If the task's `outputSchema` has exactly
one property, the emitter inserts that property name as the path
automatically.

---

## 4. Lowering rules

### 4.1 let with task call -> TaskNode

```
let greeting = text.template("Hello {{name}}", { name: name });
```

Lowers to a `TaskNode` with `bind: "greeting"`. The task schema is
looked up to fill `inputSchema` and `outputSchema`. Arguments are
resolved via `exprToTemplate`.

### 4.2 let with template literal -> text.template TaskNode

```
let authorArg = `--author=${author}`;
```

Desugars to `text.template(template_string, { vars })` where
interpolated expressions become template variables.

### 4.3 const -> IR constants

```
const maxRetries = 2;
```

Lowers to the IR's top-level `constants` section. Referenced via
`$from: "constant"`. Only literal values (strings, numbers, booleans,
null) are supported.

### 4.4 for..of -> LoopNode with index machinery

```
for (repo of repos) {
    let result = shell.exec({ command: "git", ... , cwd: repo });
    sections = list.append(sections, result);
}
```

Desugars to a `LoopNode` with:

- **State:** `i` (index counter, initial `0`), plus any accumulator
  variables assigned inside the body (e.g., `sections`)
- **Body nodes:** `pick_VAR` (`list.elementAt`), user task nodes,
  state update nodes (`assign_VAR` via `list.append` etc.),
  `step_i` (`int.add`), `compute_length` (`list.length`),
  `compare_index` (`int.lessThan`), `check_done` (boolean branch
  to `@iterate` or `@exit`)
- **Outer refs:** bindings from the enclosing scope are captured as
  loop `inputs`

### 4.5 while(true) -> LoopNode with state/break/continue

```
while (true) {
    try { ... break; }
    catch { ... continue; }
}
```

Only `while (true)` is supported (enforced at emit time). The emitter
analyzes the loop body to discover:

- **State vars:** variables declared before the while with literal
  initializers and assigned inside the body
- **Output vars:** variables declared before the while with no
  initializer (`let x: type;`) and assigned inside the body
- **Outer refs:** bound names read inside the body

`break` lowers to a branch node targeting `@exit`.
`continue` lowers to a branch node targeting `@iterate`.

### 4.6 if/else -> BranchNode (boolean)

```
if (int.lessThan(attempt, maxRetries)) {
    continue;
} else {
    break;
}
```

Lowers to a `BranchNode` with `selectorSchema: { type: "boolean" }`
and cases `{ "true": THEN_ENTRY, "false": ELSE_ENTRY }`.

If the condition is a task call expression, the emitter auto-emits it
as an implicit task node before the branch, and references its result
as the selector.

At top-level (outside while), then/else branches are emitted into
separate sub-scopes and merged with `then_`/`else_` prefixed node IDs.

Inside while bodies, branches are emitted inline into the shared body
scope.

### 4.7 try/catch -> onError edges

```
try {
    let fetchResult = http.get({ url: url });
    pageContent = fetchResult.body;
    break;
} catch {
    attempt = int.add(attempt, 1);
    ...
}
```

Each task node in the try block gets an `onError` edge pointing to
its own recovery entry in the catch block.

**Single trigger (one task in try):** The task's `onError` points
directly to the first catch node.

**Multiple triggers (multiple tasks in try):** The catch body is
cloned per trigger (suffixed `_t0`, `_t1`, ...) so that each task
gets a unique recovery entry. This satisfies the IR's single-trigger
rule (ir-v1.md, section 3.8, rule 2). Internal references within each clone
(`next`, branch `cases`/`default`) are remapped to the cloned IDs.

### 4.8 return -> output

```
return joined;
```

Sets the IR's `output` field. Auto-projection applies (section 3.2).

Object returns are supported:

```
return { path: writeResult.path, summary: summaryResult.text };
```

Each field value is resolved via `exprToTemplate`, producing an object
template in the IR's `output`.

### 4.9 Conditional bind

The emitter tracks which node bindings are actually referenced
downstream (via a `referencedNodes` set). After emission,
`stripUnreferencedBinds` removes the `bind` field from task nodes
whose names are never used. This keeps the IR minimal without
requiring the author to think about it.

### 4.10 next threading

After all nodes in a scope are emitted, `threadNext` walks
`nodeOrder` and sets `next` on each task/loop node to point to
the following node, unless `next` is already set. Branch nodes
are skipped (they use `cases`/`default`).

---

## 5. Divergences from TypeScript

The DSL looks like TypeScript but is not TypeScript. Key differences:

| Surface               | DSL behavior                                        | TypeScript behavior            |
| --------------------- | --------------------------------------------------- | ------------------------------ |
| `let` semantics       | Single assignment per scope frame (SSA)             | Mutable                        |
| `while`               | Only `while (true)` supported                       | Arbitrary conditions           |
| `try`/`catch`         | No error binding (`catch (e)` not supported)        | Error variable in catch clause |
| Task calls            | `namespace.task(args)` dispatches to workflow tasks | Regular function calls         |
| Assignment in loops   | Lowers to loop state or output variables            | Mutable variable update        |
| Type annotations      | Map to JSON Schema (no generics, unions, etc.)      | Full TypeScript type system    |
| `match`               | Parsed but not yet lowered (see section 7)          | No `match` in TypeScript       |
| No `function`/`class` | Only `workflow` declarations                        | Full language                  |

These divergences are intentional: the DSL is a thin authoring surface
over the IR, not a general-purpose language. The design principle is
"as close to TS as possible, justified divergence only where the IR
requires it."

---

## 6. Examples

### d1-standup-prep

```typescript
workflow standupPrep(repos: string[], author: string): string {
    let authorArg = `--author=${author}`;
    let sections: string[] = [];
    for (repo of repos) {
        let gitResult = shell.exec({ command: "git", args: ["log", "--since=yesterday", authorArg, "--oneline"], cwd: repo });
        let section = `## ${repo}\n${gitResult.stdout}`;
        sections = list.append(sections, section);
    }
    let joined = string.join(sections, "\n\n");
    return joined;
}
```

Exercises: template literals, for..of with accumulator, auto-projection.

### d8-summarize-url

```typescript
workflow summarizeUrl(url: string, outputPath: string): { path: string, summary: string } {
    const summaryPrompt = "Summarize the following ...";
    const maxRetries = 2;
    let attempt = 0;
    let pageContent: string;
    while (true) {
        try {
            let fetchResult = http.get({ url: url });
            pageContent = fetchResult.body;
            break;
        } catch {
            attempt = int.add(attempt, 1);
            if (int.lessThan(attempt, maxRetries)) {
                continue;
            } else {
                break;
            }
        }
    }
    let prompt = `${summaryPrompt}${pageContent}`;
    let summaryResult = llm.generate(prompt);
    let writeResult = file.write({ path: outputPath, content: summaryResult });
    return { path: writeResult.path, summary: summaryResult.text };
}
```

Exercises: const, while(true), try/catch, if/else with task-call
condition, break/continue, object return, auto-projection.

---

## 7. Not yet implemented

The following are parsed but not yet lowered:

- **`match` statement.** The parser accepts `match expr { "case": { ... } else { ... } }` but the emitter does not handle it. Intended to lower to a `BranchNode` with string/enum selectors.

---

## 8. Issues to revisit

### 8.1 try/catch clone duplication

When a `try` block contains multiple task nodes, the emitter clones the
entire catch body per trigger to satisfy the IR's single-trigger rule
(ir-v1.md, section 3.8, rule 2). This is correct but produces IR that
grows linearly with the number of tasks in the try block.

The IR spec anticipates this will be addressed post-v1 by **block
scope** (ir-v1.md, section 8.7; sketch in
[post-v1/block-scope.md](../ir/post-v1/block-scope.md)): a single
`onError` over a region of nodes. When block scope lands in the IR,
the emitter should be updated to emit a single recovery target
instead of cloning.

Until then, the clone approach follows the spec's own recommendation:
"Codegen can also duplicate a logical recovery into per-trigger copies
if neither mechanism is available" (ir-v1.md, section 10 summary table,
Recovery-task reuse row).

**What to watch for:** IR size growth in workflows with large try blocks
(many tasks). If this becomes a practical problem before block scope
ships, consider flattening the clone by extracting shared catch logic
into a separate scope or revisiting the single-trigger restriction.

### 8.2 Engine-injected error/trigger inputs

The IR spec (ir-v1.md, section 3.8) requires that recovery nodes declare
`error` and `trigger` in their `inputSchema`, and the engine injects
these fields before resolving other inputs. The DSL's `catch` block
currently does not expose the error value or trigger inputs to user
code. A future `catch (e)` syntax could bind the error, but this
requires deciding how `trigger` (the failing task's resolved inputs)
maps to a DSL-level concept.
