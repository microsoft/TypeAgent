# DSL Comparative Analysis

Comparing five DSL styles across 14 workflow constructs to evaluate which
best serves both human readability and visual editor authoring.

## The Five Options

| Option                | Shorthand                      | Core idea                                                                                                                                                                                                                                                                           |
| --------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. TS-like**        | Current DSL                    | Imperative, familiar syntax, general-purpose control flow                                                                                                                                                                                                                           |
| **B. Pipeline**       | Declarative steps              | Each step is a declaration with properties/modifiers                                                                                                                                                                                                                                |
| **C. Hybrid**         | Pipeline + workflow primitives | Linear readability, domain-specific constructs (`retry`, `map`, `parallel`)                                                                                                                                                                                                         |
| **D. Dataflow**       | Node + wire                    | Explicit nodes with constraints/conditions, order-independent                                                                                                                                                                                                                       |
| **E. TS + built-ins** | Current DSL + lambda built-ins | TS syntax with compiler-recognized built-in functions (`retry`, `map`, `parallel`) that take arrow functions. SSA (all bindings are `const`). No general-purpose loops. `if/else` and `switch` are statements (side effects only). `?:` and sub-workflow calls for value selection. |

---

## Construct 1: Linear Pipeline

The baseline: A calls B calls C.

**A. TS-like**

```
let a = text.extract(document)
let b = llm.summarize(a)
let c = file.write(path: outputPath, content: b)
return c
```

**B. Pipeline**

```
a = text.extract(document)
b = llm.summarize(a)
c = file.write(path: outputPath, content: b)
return c
```

**C. Hybrid**

```
a = text.extract(document)
b = llm.summarize(a)
c = file.write(path: outputPath, content: b)
return c
```

**D. Dataflow**

```
node a = text.extract(document)
node b = llm.summarize(a)
node c = file.write(path: outputPath, content: b)
output c
```

**E. TS + built-ins**

```
const a = text.extract(document)
const b = llm.summarize(a)
const c = file.write({ path: outputPath, content: b })
return c
```

**Verdict:** Nearly identical. All options handle this well. `const` and `node` keywords are noise here.

---

## Construct 2: Named Arguments

Passing specific fields to a task.

**A. TS-like**

```
let result = http.get({ url: url, headers: authHeaders })
```

**B. Pipeline**

```
result = http.get(url: url, headers: authHeaders)
```

**C. Hybrid**

```
result = http.get(url: url, headers: authHeaders)
```

**D. Dataflow**

```
node result = http.get(url: url, headers: authHeaders)
```

**E. TS + built-ins**

```
const result = http.get({ url: url, headers: authHeaders })
```

**Verdict:** A and E use `{ }` wrappers (TS object literal syntax). B/C/D use bare named args.
E matches TS syntax, keeping the DSL a strict TS subset except for the `workflow` keyword.

---

## Construct 3: Template / Interpolation

Assembling strings from data.

**A. TS-like**

```
let prompt = `Hello ${name}, order ${orderId} is ready`
```

**B. Pipeline**

```
prompt = template("Hello ${name}, order ${orderId} is ready")
```

**C. Hybrid**

```
prompt = `Hello ${name}, order ${orderId} is ready`
```

**D. Dataflow**

```
node prompt = template("Hello {name}, order {orderId} is ready")
  bind name = name
  bind orderId = orderId
```

**E. TS + built-ins**

```
const prompt = `Hello ${name}, order ${orderId} is ready`
```

**Verdict:** A/C/E's backtick syntax is natural. B wraps in `template()` which is fine. D's explicit
binds are verbose for a common operation.

---

## Construct 4: Constants

Static configuration values.

**A-D: All the same**

```
const maxRetries = 2
const baseUrl = "https://api.example.com"
```

**Verdict:** No difference. Universal syntax. E is identical.

---

## Construct 5: Retry on Error

Fetch a URL, retry up to N times on failure.

**A. TS-like**

```
let attempt = 0
let result: string
while (true) {
    try {
        result = http.get({ url: url })
        break
    } catch {
        attempt = int.add(attempt, 1)
        if (int.lessThan(attempt, maxRetries)) {
            continue
        } else {
            break
        }
    }
}
```

**B. Pipeline**

```
result = http.get(url: url)
  retry: 2
```

**C. Hybrid**

```
result = retry(2) {
    http.get(url: url)
}
```

**D. Dataflow**

```
node result = http.get(url: url)
  on_error: retry(max: 2)
```

**E. TS + built-ins**

```
const result = retry(2, () => {
    http.get({ url: url })
})
```

**Verdict:** A is 14 lines for what is conceptually a 1-2 line idea. B is the most concise
(modifier on the step). E is 3 lines with familiar arrow function syntax. C makes the retry
scope explicit as a block. D uses a property. All of B/C/D/E are dramatically better than A.

**Visual editor:** B renders as a single node with a "retry: 2" badge. C/E render as a "retry"
group containing one node. D renders as a node with an on_error annotation.

---

## Construct 6: Conditional Branch

Route to different tasks based on a value.

**A. TS-like**

```
let check = validator.check(data)
if (check.isValid) {
    let result = processor.accept(data)
} else {
    let result = processor.reject(data)
}
```

**B. Pipeline**

```
check = validator.check(data)
branch check.isValid:
  true:
    result = processor.accept(data)
  false:
    result = processor.reject(data)
```

**C. Hybrid**

```
check = validator.check(data)
if (check.isValid) {
    result = processor.accept(data)
} else {
    result = processor.reject(data)
}
```

**D. Dataflow**

```
node check = validator.check(data)
node accepted = processor.accept(data)
  when check.isValid = true
node rejected = processor.reject(data)
  when check.isValid = false
```

**E. TS + built-ins**

Side effects only (statement):

```
const check = validator.check(data)
if (check.isValid) {
    processor.accept(data)
} else {
    processor.reject(data)
}
```

Value selection (ternary):

```
const check = validator.check(data)
const result = check.isValid ? processor.accept(data) : processor.reject(data)
```

Complex branches (sub-workflow):

```
const check = validator.check(data)
const result = check.isValid ? handleAccepted(data) : handleRejected(data)
```

**Verdict:** A and C use if/else for everything. E separates concerns: `if/else` for side effects,
`?:` for value selection, sub-workflows for complex branches. No variable reassignment needed.
B introduces `branch` keyword. D puts conditions on nodes.

**Visual editor:** A/C render as a "branch" group with two sub-groups. E's ternary renders as
a diamond (condition) with two edges to task nodes. B renders similarly to A/C.
D renders as two independent nodes with condition badges.

---

## Construct 7: Map Over Collection

Process each item and collect results.

**A. TS-like**

```
let results: string[] = []
for (item of items) {
    let processed = text.process(item)
    results = list.append(results, processed)
}
```

**B. Pipeline**

```
results = text.process(item) for item in items
```

**C. Hybrid**

```
results = map(items) { item =>
    text.process(item)
}
```

**D. Dataflow**

```
node results = text.process(item)
  for item in items
```

**E. TS + built-ins**

```
const results = map(items, (item) => {
    text.process(item)
})
```

**Verdict:** A needs an explicit accumulator and `list.append` call, which is boilerplate. B/D are
the most concise (inline modifier). C and E both use block syntax for multi-step map bodies.
E uses arrow function syntax which is TS-familiar. B/D would need different syntax if the
map body has multiple steps.

**Multi-step map body (3 tasks per item):**

**B. Pipeline**

```
results = each items as item:
  extracted = text.extract(item)
  analyzed = llm.analyze(extracted)
  text.format(analyzed)
```

**C. Hybrid**

```
results = map(items) { item =>
    extracted = text.extract(item)
    analyzed = llm.analyze(extracted)
    text.format(analyzed)
}
```

**D. Dataflow**

```
group processItem for item in items:
  node extracted = text.extract(item)
  node analyzed = llm.analyze(extracted)
  node formatted = text.format(analyzed)
node results = collect(processItem.formatted)
```

**E. TS + built-ins**

```
const results = map(items, (item) => {
    const extracted = text.extract(item)
    const analyzed = llm.analyze(extracted)
    text.format(analyzed)
})
```

C and E handle multi-step naturally. B and D need to shift syntax when the body grows.

---

## Construct 8: Filter Collection

Keep only items matching a condition.

**A. TS-like**

```
let filtered: Item[] = []
for (item of items) {
    let check = validator.isValid(item)
    if (check.result) {
        filtered = list.append(filtered, item)
    }
}
```

**B. Pipeline**

```
filtered = filter items where validator.isValid(item)
```

**C. Hybrid**

```
filtered = filter(items) { item =>
    validator.isValid(item)
}
```

**D. Dataflow**

```
node checks = validator.isValid(item)
  for item in items
node filtered = select(items, checks)
```

**E. TS + built-ins**

```
const filtered = filter(items, (item) => {
    validator.isValid(item)
})
```

**Verdict:** A is verbose (7 lines for a filter). B reads most naturally. C and E are both
familiar from functional programming (E uses arrow syntax). D decomposes into check + select,
which is closer to how it executes but less intuitive.

---

## Construct 9: Parallel / Fork-Join

Run independent tasks concurrently, wait for all.

**A. TS-like**

```
// Not expressible. No parallel construct.
// Would need to run sequentially:
let a = text.analyze(document)
let b = image.analyze(document)
let c = metadata.extract(document)
```

**B. Pipeline**

```
parallel:
  a = text.analyze(document)
  b = image.analyze(document)
  c = metadata.extract(document)
```

**C. Hybrid**

```
[a, b, c] = parallel {
    text.analyze(document)
    image.analyze(document)
    metadata.extract(document)
}
```

**D. Dataflow**

```
node a = text.analyze(document)
node b = image.analyze(document)
node c = metadata.extract(document)
// parallel by default: no data dependency between a, b, c
```

**E. TS + built-ins**

```
const [a, b, c] = parallel(
    () => text.analyze(document),
    () => image.analyze(document),
    () => metadata.extract(document)
)
```

**Verdict:** A cannot express parallelism at all. D gets it for free from the dataflow model
(no dependencies = parallel). B, C, and E need explicit syntax. C and E both use destructuring
for named results. E's syntax is closest to `Promise.all()`, which TS developers already know.
D is arguably the most elegant here: parallelism is structural, not declared.

**Visual editor:** B/C/E render as a "parallel" group with three nodes side-by-side. D renders as
three independent nodes at the same level, which is naturally what the graph looks like.

---

## Construct 10: Conditional Skip

Only execute a step if a condition is met. No else branch.

**A. TS-like**

```
if (config.shouldNotify) {
    let notification = notify.send(message)
}
```

**B. Pipeline**

```
notification = notify.send(message)
  when: config.shouldNotify
```

**C. Hybrid**

```
if (config.shouldNotify) {
    notification = notify.send(message)
}
```

**D. Dataflow**

```
node notification = notify.send(message)
  when config.shouldNotify = true
```

**E. TS + built-ins**

```
if (config.shouldNotify) {
    notify.send(message)
}
```

**Verdict:** B/D are concise (condition is a modifier on the step). A/C/E use a block for what
is really a guard on a single node. B/D are better for visual editors: the node exists but
has a condition badge, rather than being wrapped in a group. In E, the task call inside the
if block has no `const` binding since it's a side-effect-only statement.

---

## Construct 11: Fan-Out (Dynamic Parallel Map)

Process each item in a collection concurrently.

**A. TS-like**

```
// Not expressible. for..of is sequential.
```

**B. Pipeline**

```
results = text.process(item) for item in items
  parallel: true
```

**C. Hybrid**

```
results = parallel map(items) { item =>
    text.process(item)
}
```

**D. Dataflow**

```
node results = text.process(item)
  for item in items
  parallel: true
```

**E. TS + built-ins**

```
const results = parallel(map(items, (item) => {
    text.process(item)
}))
```

Or as a dedicated built-in:

```
const results = parallelMap(items, (item) => {
    text.process(item)
})
```

**Verdict:** A cannot express this. B/D add a parallel modifier to the iteration. C composes
`parallel` and `map` as orthogonal modifiers. E can either nest `parallel(map(...))` (verbose)
or provide a dedicated `parallelMap` built-in (clean).

---

## Construct 12: Output Shaping

Assembling the return value from multiple sources.

**A. TS-like**

```
return { path: writeResult.path, summary: summaryResult.text }
```

**B. Pipeline**

```
return { path: writeResult.path, summary: summaryResult.text }
```

**C. Hybrid**

```
return { path: writeResult.path, summary: summaryResult.text }
```

**D. Dataflow**

```
output path = writeResult.path
output summary = summaryResult.text
```

**E. TS + built-ins**

```
return { path: writeResult.path, summary: summaryResult.text }
```

**Verdict:** A/B/C/E are identical and natural. E uses `const` for all bindings but `return`
is the same across options. D decomposes into per-field outputs, which is
more explicit but verbose for multi-field returns.

---

## Construct 13: Nested Error Scopes

Map over items, retry each item on failure, skip items that exhaust retries.

**A. TS-like**

```
let results: string[] = []
for (item of items) {
    let attempt = 0
    let processed: string
    while (true) {
        try {
            processed = risky.process(item)
            break
        } catch {
            attempt = int.add(attempt, 1)
            if (int.lessThan(attempt, 3)) {
                continue
            } else {
                break
            }
        }
    }
    results = list.append(results, processed)
}
```

**B. Pipeline**

```
results = risky.process(item) for item in items
  retry: 3
  on_exhaust: skip
```

**C. Hybrid**

```
results = map(items) { item =>
    retry(3) {
        risky.process(item)
    } catch {
        skip
    }
}
```

**D. Dataflow**

```
node results = risky.process(item)
  for item in items
  on_error: retry(max: 3, fallback: skip)
```

**Verdict:** A is 17 lines of deeply nested imperative code. B/D are concise modifiers.
C is explicit about nesting (map > retry > catch) but still readable.

**E. TS + built-ins**

```
const results = map(items, (item) => {
    retry(3, () => {
        risky.process(item)
    }, () => {
        skip
    })
})
```

Or with a named `onExhaust` parameter:

```
const results = map(items, (item) => {
    retry(3, () => risky.process(item), { onExhaust: skip })
})
```

A is clearly the worst here. B/D collapse the pattern into properties, which is concise
but may be hard to extend if the error handling gets more complex (e.g., different behavior
on different error types). C's nesting is a natural extension point. E composes `map` and
`retry` via nesting (familiar from nested function calls), but the multiple arrow function
arguments to `retry` start to get noisy.

---

## Construct 14: Match / Switch

Route to different handlers based on a categorical value.

**A. TS-like**

```
match (category) {
    "email" => email.send(data)
    "slack" => slack.post(data)
    _ => log.warn("unknown category")
}
```

**B. Pipeline**

```
switch category:
  "email": result = email.send(data)
  "slack": result = slack.post(data)
  default: result = log.warn("unknown category")
```

**C. Hybrid**

```
match (category) {
    "email" => email.send(data)
    "slack" => slack.post(data)
    _ => log.warn("unknown category")
}
```

**D. Dataflow**

```
node emailResult = email.send(data)
  when category = "email"
node slackResult = slack.post(data)
  when category = "slack"
node warnResult = log.warn("unknown category")
  when category = default
```

**E. TS + built-ins**

Side effects only (statement):

```
switch (category) {
    "email" => email.send(data)
    "slack" => slack.post(data)
    _ => log.warn("unknown category")
}
```

Value selection (sub-workflow):

```
workflow dispatch(category: string, data: Data): Result {
    switch (category) {
        "email" => return email.send(data)
        "slack" => return slack.post(data)
        _ => return fallback.handle(data)
    }
}
const result = dispatch(category, data)
```

**Verdict:** A and C use `match`. E uses `switch` (TS keyword). All are statement-only in E;
for value selection, E uses a sub-workflow with `return` in each arm. B uses keyword +
indentation. D decomposes into guarded nodes, which again avoids grouping but means the
mutual exclusivity is only implicit.

---

## Summary Matrix

Scoring: how well does each option express the construct?
`++` = excellent, `+` = good, `~` = adequate, `-` = poor/verbose, `x` = not expressible

| #   | Construct              | A (TS-like) | B (Pipeline) | C (Hybrid) | D (Dataflow) | E (TS + built-ins) |
| --- | ---------------------- | :---------: | :----------: | :--------: | :----------: | :----------------: |
| 1   | Linear pipeline        |      +      |      +       |     +      |      +       |         +          |
| 2   | Named arguments        |      ~      |      +       |     +      |      +       |         +          |
| 3   | Template/interpolation |     ++      |      +       |     ++     |      -       |         ++         |
| 4   | Constants              |      +      |      +       |     +      |      +       |         +          |
| 5   | Retry on error         |      -      |      ++      |     +      |      ++      |         +          |
| 6   | Conditional branch     |      +      |      +       |     +      |      +       |         +          |
| 7   | Map over collection    |      -      |      +       |     ++     |      ~       |         ++         |
| 8   | Filter collection      |      -      |      +       |     +      |      ~       |         +          |
| 9   | Parallel / fork-join   |      x      |      +       |     +      |      ++      |         +          |
| 10  | Conditional skip       |      ~      |      ++      |     ~      |      ++      |         ~          |
| 11  | Fan-out (parallel map) |      x      |      +       |     +      |      +       |         +          |
| 12  | Output shaping         |      +      |      +       |     +      |      ~       |         +          |
| 13  | Nested error scopes    |      -      |      +       |     +      |      +       |         ~          |
| 14  | Match / switch         |      +      |      +       |     +      |      ~       |         +          |

**Totals (rough):**

| Option                | Strengths                                                                                                                                                         | Weaknesses                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. TS-like**        | Familiar, readable linear flow, templates                                                                                                                         | Cannot express parallelism. Retry/map/filter are verbose boilerplate.                                                                                                  |
| **B. Pipeline**       | Concise modifiers for workflow patterns. Flat structure maps well to visual.                                                                                      | Multi-step bodies need different syntax. Modifier stacking may get complex.                                                                                            |
| **C. Hybrid**         | Best of both: readable linear flow + domain primitives. Nesting handles complex cases.                                                                            | More keywords to learn. Need to define the primitive set.                                                                                                              |
| **D. Dataflow**       | Parallelism is free. Conditions as node properties = natural graph mapping.                                                                                       | Verbose templates. Implicit ordering. Multi-step groups need explicit `group` syntax. Mutual exclusivity is implicit.                                                  |
| **E. TS + built-ins** | TS familiarity preserved. Fixes A's biggest gaps (retry, map, parallel). Arrow functions are a single extension mechanism. No new keywords beyond function names. | Nested compositions get noisy (`map` + `retry` = nested arrows). Conditional skip unchanged from A. Modifier stacking requires nested calls, not orthogonal modifiers. |

## Key Observations

1. **A (TS-like) is weakest for workflow-specific patterns.** Retry, map, filter, and parallel
   are either impossible or require verbose imperative boilerplate. The familiarity advantage
   doesn't compensate for 14 lines of retry logic.

2. **E (TS + built-ins) fixes A's biggest gaps while preserving TS familiarity.** Arrow
   functions are a single, well-understood extension mechanism. `retry(2, () => ...)`,
   `map(items, (item) => ...)`, `parallel(...)` are all just function calls. No new syntax
   categories, no new keywords. Developers who know `Array.map()` and `Promise.all()` can
   read this immediately.

3. **E's weakness is composition depth.** When you nest `map` + `retry` + error handling, you
   get nested arrow functions with multiple arguments. `retry(3, () => ..., () => ...)`
   is readable; `map(items, (item) => { retry(3, () => ..., () => ...) })` starts to strain.
   C handles this more gracefully because each primitive is a block, not a function argument.

4. **B (Pipeline) and D (Dataflow) are most "visual-editor-native."** They map closest to
   what the graph looks like: nodes with properties. But they struggle with multi-step
   compositions (a map body with 3 tasks, a retry with complex fallback logic).

5. **C (Hybrid) is the most extensible.** Block syntax handles simple and complex cases
   uniformly. `map(items) { ... }` works whether the body is 1 task or 10. `retry(n) { ... }`
   can grow a `catch { ... }` clause. New primitives (e.g., `race`, `timeout`) follow the
   same `keyword(args) { body }` pattern.

6. **D (Dataflow) has the best parallel story.** Parallelism is structural, not declared.
   But the cost is that sequential ordering becomes implicit (from data dependencies), which
   can be confusing when reading.

7. **For visual editors:** B and D map most directly to "node + properties panel" UIs. C and
   E map to "nested groups" which is what our current visualizer already produces. A maps
   poorly because imperative control flow creates empty visual containers. E maps the same
   as C for built-in calls, since the compiler recognizes them and extracts group structure.

8. **E vs C tradeoff: familiarity vs clarity.** E looks like TS and requires no new syntax.
   C looks slightly unfamiliar (`map(items) { item => ... }` vs `map(items, (item) => {...})`)
   but reads cleaner at depth. The difference is small for simple cases and grows with
   composition complexity.

## Open Questions

- **E vs C: does the familiarity advantage of arrow functions outweigh the readability
  cost at composition depth?** For simple cases (`retry`, `map` alone) E is arguably better.
  For nested cases (`map` + `retry` + error handling) C may be cleaner.

- **Can C and B be combined?** Use block syntax for multi-step bodies, property syntax for
  single-step modifiers. E.g., `result = http.get(url) | retry(2)` for simple cases,
  `retry(2) { ... }` for multi-step.

- **Can E and B be combined?** E.g., `let result = http.get(url) | retry(2)` for the
  single-step case, `retry(2, () => { ... })` for multi-step. This would give E the same
  conciseness as B for the common case.

- **What is the primitive set for C/E?** At minimum: `retry`, `map`, `filter`, `parallel`.
  Possibly: `race`, `timeout`, `gate`. Is this set closed or user-extensible?

- **Does D's implicit parallelism cause problems?** If the author writes two tasks that
  happen to share no data dependency but should run sequentially (e.g., for rate limiting),
  how do they express ordering?

- **Implementation cost.** E requires adding arrow function expressions to the existing
  parser/AST and teaching the emitter to recognize built-in names. This is incremental.
  C requires replacing the parser's block syntax (new keywords like `map`, `retry` as
  statement heads). B and D require a fundamentally different parser. E is the cheapest
  path from where we are today.

---

## Visual Mapping Analysis

### DSL to Visual: can every construct render as a visual element?

The visual editor has five primitives: **node** (box), **edge** (wire), **group** (container),
**badge** (annotation on a node), **port** (input/output connection point).

| DSL construct      | Visual element     | A         | B        | C        | D            | E        |
| ------------------ | ------------------ | --------- | -------- | -------- | ------------ | -------- |
| Task call          | Node               | 1:1       | 1:1      | 1:1      | 1:1          | 1:1      |
| Variable reference | Edge               | implicit  | implicit | implicit | implicit     | implicit |
| Constant           | Badge/label        | 1:1       | 1:1      | 1:1      | 1:1          | 1:1      |
| Template           | Node               | 1:1       | 1:1      | 1:1      | 1:1          | 1:1      |
| Retry              | Group or badge     | **noise** | badge    | group    | badge        | group    |
| Map/iteration      | Group              | **noise** | group    | group    | group        | group    |
| If/else            | Branch group       | group     | group    | group    | **no group** | group    |
| Match              | Multi-branch group | group     | group    | group    | **no group** | group    |
| Parallel           | Group              | **N/A**   | group    | group    | **implicit** | group    |
| Conditional skip   | Badge or group     | group     | badge    | group    | badge        | group    |
| Return             | Terminal node      | 1:1       | 1:1      | 1:1      | per-field    | 1:1      |

"noise" = the DSL produces visual elements with no author-meaningful purpose (accumulators,
attempt counters, break nodes, empty if/else containers).

### Phantom elements: DSL constructs with no meaningful visual representation

| Option | Phantom elements                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------ |
| A      | `break`, `continue`, uninitialized `let`, `list.append` accumulator, `while(true)` loop machinery, attempt counter |
| B      | None                                                                                                               |
| C      | None                                                                                                               |
| D      | None                                                                                                               |
| E      | Arrow function delimiters (`() => {}`), but compiler dissolves them into dedicated AST nodes, so effectively none  |

A is the only option that generates visual noise. B/C/D/E all have a clean 1:1 or near-1:1
mapping from DSL constructs to visual elements.

### Problematic forward mappings

1. **Uninitialized `let` (A/C/E)** - `let pageContent: string` has no visual representation
   until assigned inside a block. The variable "appears" when a node outputs to it. Fine if
   variables are implicit (edge labels), but the DSL has an explicit declaration.

2. **Arbitrary expressions in conditions (A/C/E)** - `if (int.lessThan(attempt, maxRetries))`
   requires a task call to produce the boolean. Visually this is a node feeding into the
   branch's condition port. The visual needs to distinguish "condition node" from "body node."

3. **Variable reassignment / state mutation (A/E)** - `attempt = int.add(attempt, 1)` is a
   feedback edge (output feeds back as input to next iteration). Visually clear in a loop
   context, but implies the variable has two definitions (initial + updated).

4. **Scope merging after branches (A/C/E)** - `let result` defined in both if-then and if-else
   branches. Both bind to the same name. The visual needs to show these merge after the
   branch. This is a phi-node concept the DSL hides.

5. **D's implicit mutual exclusivity** - Multiple `when` guards on the same variable are
   semantically exclusive, but the AST doesn't encode this. The visual editor must infer
   that guarded nodes form a branch group.

### Visual to DSL: can every visual edit produce valid DSL?

| Visual edit             | DSL change                              | Issues                                                        |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------- |
| Add a task node         | Insert task call statement              | Need insertion point, need schema for args                    |
| Delete a task node      | Remove the statement                    | Must also remove/fix downstream references                    |
| Connect output to input | Add/change argument in target task call | Clean if types match                                          |
| Disconnect an edge      | Remove argument from task call          | May leave required arg missing                                |
| Wrap nodes in retry     | Wrap statements in retry construct      | Need to adjust variable scoping                               |
| Wrap nodes in map       | Wrap in map construct                   | Need collection source, rename references                     |
| Unwrap a group          | Remove retry/map wrapper, keep body     | Straightforward tree transform                                |
| Reorder nodes           | Move statement to new position          | Only valid if data dependencies allow it                      |
| Add a branch            | Insert if/else around statements        | Need condition source, split downstream                       |
| Move node into group    | Move statement into group body          | Changes scoping: vars inside may not be visible outside       |
| Move node out of group  | Move statement out of group body        | Must check that moved node doesn't reference group-local vars |

### Hard visual-to-DSL edits

- **Moving nodes across scope boundaries.** Variables defined inside a retry/map arrow
  function aren't visible outside. The visual editor must enforce this or show consequences.

- **Creating feedback loops.** Connecting a node's output back to an earlier node's input
  implies a loop (retry, map), requiring a group wrapper. The visual can't just add an edge.

- **Merging branches.** Using a variable defined in both branches after an if/else requires
  understanding scoping rules, not just graph topology.

These are solvable but require the visual editor to understand scoping, not just wiring.

---

## AST-Based Editing Analysis

The visual editor should work on the AST (or CST) directly, not splice text:

```
Visual edit -> find AST node -> transform AST -> pretty-print -> new source text
```

This reframes the comparison: the question is not "how easy is the text manipulation" but
"how complex is the AST and how easy is it to transform?"

### AST complexity: node types per option

| Option | Approx. node types | Notes                                                                                                                 |
| ------ | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| A      | ~15                | Let, Const, If, While, For, Try, Match, Return, Break, Continue, Assignment, TaskCall, Template, Literals, DottedName |
| B      | ~8                 | Step, Modifier, Branch, Switch, Template, Literal, Return, Const. Flat: steps have modifier lists.                    |
| C      | ~12                | Let, Const, If, Match, Return, TaskCall, Template, Literals, RetryBlock, MapBlock, ParallelBlock, FilterBlock         |
| D      | ~6                 | Node, Group, Output, Const, Template, Literal. Minimal.                                                               |
| E      | ~12                | Let, Const, If, Match, Return, TaskCall, Template, Literals, AttemptsNode, MapNode, ParallelNode, FilterNode          |

Key insight for E: the parser recognizes built-in names (`attempts`, `map`, `parallel`, `filter`)
and produces **dedicated AST node types**, not generic CallExpr nodes. The syntax looks like
`attempts(2, () => { ... })` but the AST is:

```
AttemptsNode {
    count: 2,
    body: [TaskCallStatement { task: "http.get", args: { url: url } }]
}
```

Not:

```
CallExpr {
    callee: "retry",
    args: [NumberLiteral(2), ArrowFunction { body: [...] }]
}
```

This means C and E have **identical AST structure** for workflow primitives. The only
difference is the surface syntax the pretty-printer emits.

### AST shape predictability: can the visual editor assume structure?

| Operation                     | B                          | C                    | D                             | E                 |
| ----------------------------- | -------------------------- | -------------------- | ----------------------------- | ----------------- |
| Find "retry" in AST           | Step with `retry` modifier | RetryBlock node type | Node with `on_error` property | AttemptsNode type |
| Find "map" in AST             | Step with `for` modifier   | MapBlock node type   | Group with `for` property     | MapNode type      |
| Find group body               | Indented children          | `.body` array        | `.children` array             | `.body` array     |
| Distinguish groups from tasks | Modifier presence          | Node type            | Node vs Group                 | Node type         |

All four options now encode structure in the AST, not just in names. E's dedicated AST nodes
make it equivalent to C for programmatic manipulation.

### Wrap/unwrap operations: AST transform comparison

"Wrap node X in retry(2)":

| Option | AST transform                                                    |
| ------ | ---------------------------------------------------------------- |
| B      | Add `{ type: "retry", count: 2 }` to X's modifier list           |
| C      | Create `RetryBlock { count: 2, body: [X] }`, replace X with it   |
| D      | Add `{ onError: { type: "retry", max: 2 } }` to X's properties   |
| E      | Create `AttemptsNode { count: 2, body: [X] }`, replace X with it |

With AST manipulation, these are all trivial tree operations. B/D add a property. C/E wrap
in a parent node. The difference is negligible.

### Pretty-printer complexity

| Option | Pattern                                    | Difficulty |
| ------ | ------------------------------------------ | ---------- |
| B      | Step per line, indent modifiers below      | Easy       |
| C      | `keyword(args) {\n    body\n}`             | Medium     |
| D      | Node per line, indent properties below     | Easy       |
| E      | `keyword(args, (param) => {\n    body\n})` | Medium     |

C and E are close. E has slightly more punctuation (arrow syntax, comma between args and
lambda) but the patterns are regular and predictable.

### Round-trip fidelity: reprint scope after an edit

| Option | Reprint scope for "add retry around node X"                            |
| ------ | ---------------------------------------------------------------------- |
| B      | Reprint X's line only (append modifier). Rest of file untouched.       |
| C      | Reprint the new RetryBlock + its body. Lines before/after untouched.   |
| D      | Reprint X's declaration only (append property). Rest untouched.        |
| E      | Reprint the new AttemptsNode expression. Lines before/after untouched. |

B and D are the most local (line-level). C and E reprint a block (the new wrapper + body).
With CST-preserving transforms, all options can preserve formatting outside the edit region.

### Variable binding behavior on wrap

| Option | What happens to `result = http.get(url: url)` wrapped in retry?                        |
| ------ | -------------------------------------------------------------------------------------- |
| B      | `result = http.get(url: url)` + `retry: 2` modifier. Binding stays.                    |
| C      | `result = retry(2) { http.get(url: url) }`. Binding moves to wrapper.                  |
| D      | `node result = http.get(url: url)` + `on_error: retry(...)`. Binding stays.            |
| E      | `const result = retry(2, () => { http.get({ url: url }) })`. Binding moves to wrapper. |

B/D keep the variable on the original node. C/E move it to the wrapper. Both are valid;
the visual editor needs to handle whichever convention the DSL uses.

### AST editing summary

| Dimension                   | B (Pipeline)        | C (Hybrid)           | D (Dataflow)        | E (TS + built-ins)   |
| --------------------------- | ------------------- | -------------------- | ------------------- | -------------------- |
| AST complexity              | Low (~8)            | Medium (~12)         | Lowest (~6)         | Medium (~12)         |
| Structure encodes semantics | Yes (modifiers)     | Yes (node types)     | Yes (properties)    | Yes (node types)     |
| Find group in AST           | Property lookup     | Node type match      | Property lookup     | Node type match      |
| Wrap/unwrap transform       | Add/remove modifier | Create/remove parent | Add/remove property | Create/remove parent |
| Pretty-print difficulty     | Easy                | Medium               | Easy                | Medium               |
| Reprint scope               | Line-local          | Block                | Line-local          | Block                |
| Variable binding on wrap    | Stays put           | Moves to wrapper     | Stays put           | Moves to wrapper     |

**C and E are equivalent for AST editing** since both use dedicated node types for workflow
primitives. The only difference is surface syntax.

**B and D have simpler ASTs and more local edits** but struggle with multi-step group bodies
(syntax shifts when the body grows beyond one step).

### The C vs E bottom line

Since the parser produces the same AST structure for both, the choice between C and E is
purely about **surface syntax preference**:

- E: `retry(2, () => { ... })` - more punctuation, looks like TS, familiar to JS developers
- C: `retry(2) { ... }` - less punctuation, trailing-block syntax (like Ruby, Kotlin, Swift)

For the visual editor, it makes no difference. Both produce identical AST nodes, identical
graph extraction, and identical visual rendering. The user only sees the syntax difference
when switching to text view.

E's implementation advantage: the base grammar stays the same (function calls with arrow
function arguments). The parser adds a name check after parsing a call expression: "is the
callee in the built-in set? If so, restructure into a dedicated AST node." No new keywords
or statement-level grammar rules needed.
