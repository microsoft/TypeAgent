# DSL v2 / IR v2 Implementation Plan

Status: **Complete.** All phases implemented and committed.

Implements [dsl-v0.1.md](dsl/dsl-v0.1.md) and [ir-v2.md](ir/ir-v2.md).
Replaces the v1 compiler; engine and model are extended (not replaced).

---

## Phase 0: IR model + engine extensions (no DSL changes)

Add v2 IR types and engine support independently of the DSL compiler.
This phase has no v1 breakage: existing IR and workflows keep working.

### 0.1 Model: IR types (`model/src/ir.ts`)

- Add `ForkNode` interface: `kind: "fork"`, `branches`, `outputSchema`,
  `maxConcurrency?`, `next`, `onError?`, `bind?`
- Add `ForkMapNode` interface: `kind: "forkMap"`, `collection`,
  `collectionSchema`, `elementParam`, `body`, `outputSchema`,
  `maxIterations?`, `maxConcurrency?`, `next`, `onError?`, `bind?`
- Extend `WorkflowNode` union: `TaskNode | BranchNode | LoopNode | ForkNode | ForkMapNode`

### 0.2 Model: validation (`model/src/validate.ts`)

- Add `fork` validation: branches >= 2, each sub-scope passes existing
  loop-body validation (dominator, scope closure, type compat), no
  cross-branch data refs, outputSchema property per branch name.
- Add `forkMap` validation: collectionSchema is `type: "array"`, body
  passes loop-body validation, no `$from: "state"` in body, outputSchema
  is `type: "array"` with compatible items.
- Handle `maxConcurrency` (positive integer if present).
- Wire into existing `validateWorkflowIR()` switch on `node.kind`.

### 0.3 Engine: new built-in tasks (`engine/src/builtinTasks.ts`)

Add tasks from ir-v2 sections 3.1-3.5:

| Task                     | Implementation                           |
| ------------------------ | ---------------------------------------- |
| `compare.equals`         | `left === right`                         |
| `compare.notEquals`      | `left !== right`                         |
| `compare.greaterThan`    | `left > right`                           |
| `compare.lessThan`       | `left < right`                           |
| `compare.greaterOrEqual` | `left >= right`                          |
| `compare.lessOrEqual`    | `left <= right`                          |
| `bool.and`               | `left && right`                          |
| `bool.or`                | `left \|\| right`                        |
| `bool.not`               | `!value`                                 |
| `math.add`               | `left + right`                           |
| `math.subtract`          | `left - right`                           |
| `math.multiply`          | `left * right`                           |
| `math.divide`            | `left / right` (error on zero)           |
| `math.modulo`            | `left % right`                           |
| `error.fail`             | Always returns `{ kind: "fail", value }` |

Register all in `standardLibraryTasks`. Keep `int.add` and
`int.lessThan` as aliases during transition (ir-v2 section 3.6).

### 0.4 Engine: fork/forkMap execution (`engine/src/runner.ts`)

- Add `executeFork()`: start all branches (up to `maxConcurrency`),
  collect outputs into keyed object, cancel-on-first-failure, wire
  `partial` into onError handler inputs.
- Add `executeForkMap()`: read collection, spawn N body instances
  (up to `maxConcurrency`), collect outputs into ordered array,
  cancel-on-first-failure, `partial` array with nulls for
  failed/cancelled entries.
- Wire both into the main `executeNode()` switch.
- Add events: `forkStarted`, `forkCompleted`, `forkFailed`,
  `forkMapIterationStarted`, `forkMapIterationCompleted`.

### 0.5 Tests for Phase 0

- Unit tests for each new built-in task.
- Validation tests: valid fork/forkMap IR accepted, invalid rejected
  (< 2 branches, missing schemas, `$from: "state"` in forkMap body).
- Engine tests: hand-crafted IR with fork/forkMap nodes, verify
  concurrent execution, output shape, cancellation, onError + partial.

**Milestone:** Engine can execute IR containing fork/forkMap nodes
produced by hand (or later by the v2 emitter). No DSL changes yet.

### 0.6 Review and commit

1. **Code review (subagent).** Use a subagent to review all Phase 0
   changes (ir.ts, validate.ts, builtinTasks.ts, runner.ts, events.ts,
   and tests). Address any feedback before proceeding.
2. **Test gap analysis (subagent).** Use a subagent to review Phase 0
   changes and identify missing test coverage (edge cases, error paths,
   boundary conditions). Write tests to close gaps.
3. **Commit.** Stage and commit all Phase 0 changes with a descriptive
   message summarizing what was added.

---

## Phase 1: AST + lexer + parser (v2 surface syntax)

Replace the v1 surface syntax. After this phase the parser produces v2
ASTs but the emitter and type checker are not yet updated.

### 1.1 AST types (`dsl/src/ast.ts`)

Remove:

- `LetStatement`, `AssignmentStatement`, `ForOfStatement`,
  `WhileStatement`, `TryStatement`, `BreakStatement` (as loop control),
  `ContinueStatement`, `MatchStatement`, `MatchCase`

Add:

- `BinaryExpr { op, left: Expr, right: Expr, pos }`
- `UnaryExpr { op, operand: Expr, pos }`
- `TernaryExpr { condition: Expr, consequent: Expr, alternate: Expr, pos }`
- `SwitchStatement { discriminant: Expr, arms: SwitchArm[], default?: Statement[], pos }`
- `SwitchArm { value: Expr, body: Statement[], pos }`
- `ThrowStatement { value: Expr, pos }`
- `RetryNode { count: Expr, body: Statement[], fallback?: { param: string, body: Statement[] }, pos }`
- `MapNode { collection: Expr, param: string, body: Statement[], pos }`
- `FilterNode { collection: Expr, param: string, body: Statement[], pos }`
- `ParallelNode { bodies: { bindings: string[], body: Statement[] }[], maxConcurrency?: Expr, pos }`
- `ParallelMapNode { collection: Expr, param: string, body: Statement[], maxConcurrency?: Expr, pos }`
- `WorkflowCallExpr { name: string, args: TaskArg[], pos }`
- `DestructuringConst { names: string[], value: Expr, pos }`
- Add `leadingComments?: Comment[]` to base node, `Comment { text, pos }`

Update `Statement` and `Expr` union types.

### 1.2 Lexer (`dsl/src/lexer.ts`)

Remove token kinds: `Let`, `While`, `For`, `Of`, `Try`, `Catch`, `Continue`.

Add token kinds:

- `Switch`, `Case`, `Default`, `Break`, `Throw`
- `TripleEquals` (`===`), `NotTripleEquals` (`!==`)
- `DoubleEquals` (`==`), `NotEquals` (`!=`) - recognized but produce error
- `GreaterThan`, `LessThan`, `GreaterOrEqual`, `LessOrEqual`
- `And` (`&&`), `Or` (`||`), `Not` (`!`)
- `Plus`, `Minus`, `Star`, `Slash`, `Percent`

Note: `Arrow` (`=>`) and `QuestionMark` (`?`) already exist in v1 lexer.

### 1.3 Parser (`dsl/src/parser.ts`)

Remove:

- `parseLetStatement()`, `parseForOfStatement()`,
  `parseWhileStatement()`, `parseTryStatement()`,
  `parseMatchStatement()`, `parseContinueStatement()`,
  `parseAssignmentStatement()`
- `parseBreakStatement()` in loop context

Add:

- `parseSwitchStatement()`: `switch (expr) { case lit: stmts break ... }`
- `parseThrowStatement()`: `throw expr`
- `parseDestructuringConst()`: `const [a, b] = expr`
- `parseArrowFunction()`: `(params) => { body }` or `() => expr`
- `parseBuiltinCall()`: after parsing a call identifier, check if name
  is in `{ retry, map, filter, parallel, parallelMap }` and restructure
  into the corresponding AST node
- `parseBinaryExpr()` with precedence climbing: handles `===`, `!==`,
  `>`, `<`, `>=`, `<=`, `&&`, `||`, `+`, `-`, `*`, `/`, `%`
- `parseUnaryExpr()`: `!expr`, `-expr`
- `parseTernaryExpr()`: `expr ? expr : expr` (as a suffix of
  `parseBinaryExpr`)
- Reject `==` and `!=` with error message

Refactor `parseExpression()` to route through precedence-climbing
binary/unary/ternary parsing.

### 1.4 Tests for Phase 1

- Lexer: new tokens, removed tokens produce errors, `==`/`!=` error.
- Parser: each new construct round-trips to AST. Built-in recognition.
  Arrow function parsing. Destructuring. Switch. Throw.
- Parser rejection: `let`, `while`, `for..of`, `try/catch`, `continue`,
  assignment, `break` outside switch.

**Milestone:** Parser produces v2 ASTs from `.wf` source. No IR output yet.

### 1.5 Review and commit

1. **Code review (subagent).** Use a subagent to review all Phase 1
   changes (ast.ts, lexer.ts, parser.ts, and tests). Address any
   feedback before proceeding.
2. **Test gap analysis (subagent).** Use a subagent to review Phase 1
   changes and identify missing test coverage (edge cases in parsing,
   error recovery, boundary tokens). Write tests to close gaps.
3. **Commit.** Stage and commit all Phase 1 changes.

---

## Phase 2: Type checker (new compiler phase)

New file: `dsl/src/typeChecker.ts`. Runs between parse and emit.

### 2.1 Type representation

- Internal type system: `TypeInfo` = `{ kind: "primitive", name }` |
  `{ kind: "object", fields }` | `{ kind: "array", element }` |
  `{ kind: "tuple", elements }` | `{ kind: "unknown" }`
- Converter from `TypeExpr` (AST) and `JSONSchema` (task schemas)
  to `TypeInfo`.

### 2.2 Type inference

- Walk AST top-down. Maintain scope map: `name -> TypeInfo`.
- Workflow params: from declared types.
- `ConstStatement`: infer from initializer, check against annotation if
  present.
- Task calls: look up return type from task schema registry.
- Workflow calls: look up return type from workflow declarations in file.
- Dotted access: field lookup in object type.
- Literals: inferred directly.
- Template literals: always `string`.
- Operators: apply rules from dsl-v2 section 2.6 type table.
- Ternary: both arms same type.
- Built-ins: `map`/`filter` -> `array<body type>`, `retry` -> `body type`,
  `parallel` -> `tuple<...>`, `parallelMap` -> `array<body type>`.

### 2.3 Type errors

- Mixed-type operators (e.g., `number + string`).
- Non-boolean conditions in `if`, ternary, `&&`/`||`.
- Ternary arms with different types.
- Unknown variable references.
- Unknown task/workflow names.
- Field access on non-object types.

### 2.4 Integration

- Wire into `compile()` in `compiler.ts`: lex -> parse -> **typeCheck** -> emit.
- Type errors are `CompileError` with source location.

### 2.5 Tests for Phase 2

- Each operator combination: valid and invalid types.
- Type inference through task calls, dotted access, built-ins.
- Ternary arm mismatch detection.
- Unknown references.

**Milestone:** Compiler catches type errors before emission.

### 2.6 Review and commit

1. **Code review (subagent).** Use a subagent to review all Phase 2
   changes (typeChecker.ts, compiler.ts integration, and tests).
   Address any feedback before proceeding.
2. **Test gap analysis (subagent).** Use a subagent to review Phase 2
   changes and identify missing test coverage (type inference edge
   cases, nested expressions, built-in return types). Write tests
   to close gaps.
3. **Commit.** Stage and commit all Phase 2 changes.

---

## Phase 3: Emitter (AST to IR)

Rewrite `dsl/src/emitter.ts`. The v1 emitter is 1754 lines. Much of the
scope/name-resolution/constant/template machinery is reusable. The node
lowering methods change.

### 3.1 Reusable from v1

- Scope management (name resolution, `bind` tracking)
- Constant emission (`emitConstant()`)
- Template resolution (`emitTemplate()`)
- Task node emission (`emitTaskNode()`)
- `$from` reference generation
- Schema generation from type info
- `next` edge threading

### 3.2 Replace: control flow lowering

Remove:

- `emitForOf()` -> replaced by `emitMap()`
- `emitWhile()` -> replaced by `emitRetry()`
- `emitTryCatch()` -> subsumed by `emitRetry()` with fallback
- `emitMatch()` -> replaced by `emitSwitch()`
- `emitAssignment()` -> removed (SSA)
- `emitLet()` -> removed (all const)

Add:

- `emitRetry()`: loop node with onError, attempt counter, optional fallback.
  Reuses v1's while+try/catch IR pattern but generates it from RetryNode AST.
- `emitMap()`: loop node with index/length/compare/check_done. Reuses v1's
  for..of IR pattern but generates from MapNode AST (no explicit accumulator).
- `emitFilter()`: loop node + branch inside body + `list.append` on true
  branch. Accumulator via `iterateState`.
- `emitParallel()`: fork node. Each body becomes a named branch sub-scope.
  Names from destructuring bindings.
- `emitParallelMap()`: forkMap node. Collection ref + body sub-scope.
- `emitSwitch()`: multi-arm branch node. Chain of condition checks
  (one per case arm) with `next` edges to the merge point.
- `emitTernary()`: branch node with condition, two single-node sub-scopes.
- `emitThrow()`: emit `error.fail` task node, set `next: null`.
- `emitBinaryExpr()`: emit the corresponding built-in task node
  (e.g., `===` -> `compare.equals` task node).
- `emitUnaryExpr()`: emit `bool.not` or negate task node.
- `emitWorkflowCall()`: inline the sub-workflow body into the current scope.

### 3.3 Tests for Phase 3

- Each built-in (retry, map, filter, parallel, parallelMap): compile a
  minimal `.wf` file, verify IR structure.
- Operators: verify they lower to correct task nodes.
- Switch: verify multi-arm branch structure.
- Ternary: verify branch node with two edges.
- Throw: verify `error.fail` task node.
- Sub-workflow inlining: verify body expansion.
- End-to-end: rewrite d1-standup-prep.wf and d8-summarize-url.wf in v2
  syntax, compile, verify IR matches expected structure.

**Milestone:** `compile()` produces valid IR from v2 `.wf` source.
Full pipeline: lex -> parse -> typeCheck -> emit -> validate.

### 3.4 Review and commit

1. **Code review (subagent).** Use a subagent to review all Phase 3
   changes (emitter.ts rewrite, end-to-end tests). Focus on
   next-edge threading correctness and scope nesting. Address any
   feedback before proceeding.
2. **Test gap analysis (subagent).** Use a subagent to review Phase 3
   changes and identify missing test coverage (nested built-ins,
   operator lowering combinations, sub-workflow inlining edge cases).
   Write tests to close gaps.
3. **Commit.** Stage and commit all Phase 3 changes.

---

## Phase 4: Graph extractor + visualizer

### 4.1 Graph extractor (`dsl/src/graphExtractor.ts`)

Replace v1 AST walkers with v2 node handlers:

- Remove: `ForOfStatement`, `WhileStatement`, `TryStatement`,
  `MatchStatement`, `LetStatement`, `AssignmentStatement` handlers.
- Add: `RetryNode` -> `GraphGroup { kind: "retry" }`,
  `MapNode` -> `GraphGroup { kind: "map" }`,
  `FilterNode` -> `GraphGroup { kind: "filter" }`,
  `ParallelNode` -> `GraphGroup { kind: "parallel" }`,
  `ParallelMapNode` -> `GraphGroup { kind: "parallelMap" }`,
  `TernaryExpr` -> `GraphNode { kind: "branch" }`,
  `SwitchStatement` -> `GraphGroup { kind: "switch" }`,
  `ThrowStatement` -> `GraphNode { kind: "error" }`.

### 4.2 Visualizer (`dsl/src/visualize.ts`)

- Update layout engine for new group kinds (parallel = side-by-side layout).
- Update SVG renderer with colors/badges per group kind.

### 4.3 Tests for Phase 4

- Graph extraction for each new construct.
- Visual spot-check: generate HTML for v2 examples, manual review.

**Milestone:** Visual editor graph model works with v2 ASTs.

### 4.4 Review and commit

1. **Code review (subagent).** Use a subagent to review all Phase 4
   changes (graphExtractor.ts, visualize.ts, and tests). Address any
   feedback before proceeding.
2. **Test gap analysis (subagent).** Use a subagent to review Phase 4
   changes and identify missing test coverage (group nesting, edge
   extraction for new node types). Write tests to close gaps.
3. **Commit.** Stage and commit all Phase 4 changes.

---

## Phase 5: Migration + cleanup

### 5.1 Migrate v1 example workflows

Rewrite in v2 syntax:

| File                  | Key changes                                          |
| --------------------- | ---------------------------------------------------- |
| `d1-standup-prep.wf`  | `for..of` + `list.append` -> `map()`                 |
| `d8-summarize-url.wf` | `while`/`try`/`catch` -> `retry()`, `let` -> `const` |

### 5.2 Deprecate `int.*` built-ins

- Engine: register `int.add` and `int.lessThan` as aliases for `math.add`
  and `compare.lessThan`. Log deprecation warning on use.
- Emitter: always emit `math.*` and `compare.*` names.

### 5.3 Remove v1 compiler code

Once v2 is stable:

- Remove dead AST types (LetStatement, WhileStatement, etc.)
- Remove dead lexer tokens (Let, While, For, Of, Try, Catch, Continue)
- Remove dead parser methods
- Remove dead emitter methods
- Clean up tests that tested v1-only constructs

### 5.4 Update documentation

- Mark dsl-v0.1.md status as "Implemented."
- Mark ir-v2.md status as "Implemented."
- Update README in `examples/workflow/dsl/`.

### 5.5 Review and commit

1. **Code review (subagent).** Use a subagent to review all Phase 5
   changes (migrated .wf files, removed dead code, documentation
   updates). Address any feedback before proceeding.
2. **Test gap analysis (subagent).** Use a subagent to review Phase 5
   changes and identify any remaining test gaps (migrated workflows
   compile and validate, no dead code references). Write tests to
   close gaps.
3. **Commit.** Stage and commit all Phase 5 changes.

---

## Dependency graph

```
Phase 0 (model + engine)
    |
Phase 1 (AST + lexer + parser)
    |
Phase 2 (type checker)  -- can start in parallel with Phase 0
    |
Phase 3 (emitter)       -- depends on Phase 0 + 1 + 2
    |
Phase 4 (graph extractor) -- depends on Phase 1
    |
Phase 5 (migration)     -- depends on Phase 3 + 4
```

Phases 0 and 1 can proceed in parallel.
Phase 2 can start once Phase 1 AST types are defined (doesn't need Phase 0).
Phase 4 depends only on Phase 1 (AST types), not on the emitter.

---

## File change summary

| File                         | Action                                   | Phase |
| ---------------------------- | ---------------------------------------- | ----- |
| `model/src/ir.ts`            | Extend (add ForkNode, ForkMapNode)       | 0     |
| `model/src/validate.ts`      | Extend (fork/forkMap validation)         | 0     |
| `engine/src/builtinTasks.ts` | Extend (20 new tasks)                    | 0     |
| `engine/src/runner.ts`       | Extend (executeFork, executeForkMap)     | 0     |
| `engine/src/events.ts`       | Extend (fork/forkMap events)             | 0     |
| `dsl/src/ast.ts`             | Rewrite (remove v1, add v2 node types)   | 1     |
| `dsl/src/lexer.ts`           | Modify (remove 7 tokens, add ~15 tokens) | 1     |
| `dsl/src/parser.ts`          | Rewrite (remove v1, add v2 parsing)      | 1     |
| `dsl/src/typeChecker.ts`     | **New file**                             | 2     |
| `dsl/src/emitter.ts`         | Rewrite (v2 lowering methods)            | 3     |
| `dsl/src/compiler.ts`        | Modify (add typeCheck phase)             | 2-3   |
| `dsl/src/graphExtractor.ts`  | Rewrite (v2 AST handlers)                | 4     |
| `dsl/src/visualize.ts`       | Modify (new group layouts)               | 4     |
| `dsl/src/index.ts`           | Modify (export typeChecker)              | 2     |
| `dsl/examples/*.wf`          | Rewrite in v2 syntax                     | 5     |
| `dsl/test/compiler.spec.ts`  | Rewrite (v2 tests)                       | 1-3   |

---

## Risk areas

1. **Emitter complexity.** The v1 emitter is 1754 lines and the most
   complex file. The v2 emitter will be comparable. Main risk: getting
   `next`-edge threading and scope nesting right for nested built-ins
   (e.g., `retry` inside `map` inside `parallel`).
   Mitigation: build incrementally, one built-in at a time, with
   end-to-end compile+validate tests for each.

2. **Type checker coverage.** First time the compiler has a type phase.
   Risk of incomplete inference (especially for deeply nested dotted
   access on task output schemas).
   Mitigation: start with the simple cases (literals, direct task
   returns), add dotted-access and nested inference incrementally.

3. **Fork/forkMap engine concurrency.** Real concurrent execution
   (Promise.all or similar) in the engine is new. Risk of subtle
   ordering/cancellation bugs.
   Mitigation: start with sequential execution of "concurrent" branches
   (correct but slow), add real concurrency after tests pass.
