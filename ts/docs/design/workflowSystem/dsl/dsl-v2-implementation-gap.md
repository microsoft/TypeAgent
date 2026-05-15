# DSL v2 Implementation Gaps

Tracked items where the DSL spec (dsl-v2.md) describes features that are
not yet fully wired end-to-end.

## Sub-workflow calls

**Spec:** dsl-v2.md section 4. Multiple workflows in a single file;
sub-workflows are called by name and inlined at compile time.

**Current state:**

- Parser: works. Single-segment calls (`sendEmail(message)`) produce
  `WorkflowCallExpr` AST nodes.
- Type checker: partially works. Resolves return type from the called
  workflow's declaration, but `compile()` only passes a single workflow
  to the checker (`TypeChecker` constructor defaults `workflows` to `[]`).
  Cross-workflow calls produce "Unknown workflow" unless the caller
  explicitly provides sibling workflows.
- Emitter: does not inline. Emits a `TaskNode` with
  `task: "workflow.<name>"` and empty schemas (see implementation-decisions
  3.4).
- Runtime: fails. `workflow.<name>` tasks are not registered in the
  engine.

**What needs to happen:**

1. `compile()` should pass all parsed workflows to the type checker so
   cross-workflow references resolve.
2. The emitter should inline sub-workflow bodies into the calling
   workflow's IR (as the spec says), or alternatively, register
   `workflow.<name>` tasks in the engine at runtime.
3. Add integration tests that compile and execute a multi-workflow file.

**Related items:** implementation-decisions.md 2.3 (recursive calls),
3.4 (sub-workflow emit strategy).

## Parallel branch names are synthetic

**Spec:** dsl-v2.md section 3.4. Destructuring bindings become branch
names: `const [text, image] = parallel(...)` should produce branches
named `text` and `image`.

**Current state:** The emitter uses `branch_0`, `branch_1`, etc. The
fork node's output is keyed by these positional names, not the
user-visible destructuring variable names.

**What needs to happen:**

1. Pass destructuring names from `DestructuringConst` through to the
   fork branch emitter so branches are named after the user's bindings.
2. Update fork output resolution to use these names.

**Related items:** implementation-decisions.md 3.5.

## Parallel branches missing IR schema fields

**Spec:** ir-v2.md specifies fork branches have the same sub-scope
contract as loop bodies: `inputs`, `inputSchema`, `entry`, `nodes`,
`output`, `outputSchema`.

**Current state:** The emitter only generates `{ entry, nodes }` per
branch, omitting the schema and I/O fields. The IR validator may reject
this if it enforces the full branch sub-scope contract.

**What needs to happen:**

1. Emit `inputSchema`, `outputSchema`, `inputs`, and `output` for each
   fork branch.
2. Validate that emitted fork IR passes the IR validator.

**Related items:** implementation-decisions.md 3.6.

## TypeScript-style type definitions

**Spec:** TypeScript allows named type aliases (`type Foo = { ... }`) and
interfaces that can be referenced by name in annotations.

**Current state:** The DSL has no `type` or `interface` keyword. All
object types must be written inline as `{ field: type, ... }` in every
annotation where they appear. The type checker recognizes primitive
keywords (`string`, `number`, `integer`, `boolean`, `never`, `unknown`)
and inline object literals, but rejects any other identifier as
"Unknown type".

**What needs to happen:**

1. Add `type` declarations to the parser grammar (e.g.,
   `type Message = { role: string, content: string }`).
2. Store named types in a type environment that the type checker consults
   when resolving type expressions.
3. Report an error when a type annotation references an undefined type
   name (already works via the "Unknown type" error, but the message
   should distinguish "did you mean to define a type?" from a typo).
4. Consider whether types should be exportable across workflows.

## `llm.generateJson` needs generics for output typing

**Spec:** `llm.generateJson` produces structured output, but its JSON
schema is only known at the call site, not from the task's static
signature.

**Current state:** The builtin's output schema is `{}` (empty object),
so the type checker infers `unknown` for its return value. Callers
cannot access fields on the result without a type error ("Cannot access
property on unknown type"). The only workaround is to assign the result
to a variable and pass it opaquely to another task.

**What needs to happen:**

1. Add generic type parameter support so callers can write something like
   `llm.generateJson<{ summary: string }>(prompt)` and the checker
   infers the return type from the type argument.
2. The emitter should use the type argument to populate the task node's
   `outputSchema` in the IR, replacing the `{}` default.
3. This requires parser support for `<Type>` syntax on call expressions,
   type checker support for resolving generic instantiations, and emitter
   support for threading the resolved type into the schema.
