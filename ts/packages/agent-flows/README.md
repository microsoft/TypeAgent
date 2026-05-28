# @typeagent/agent-flows

Shared workflow infrastructure for TypeAgent flow agents.

## Why this package exists

Several TypeAgent agents (`excel`, `powershell`, `taskflow`, `browser`) each implement a "flow" abstraction — a persisted, user-defined, parameterized TypeScript script that the dispatcher can invoke through natural language. They independently re-derived the same supporting machinery: AST-based script validation, sandboxed execution, dynamic schema/grammar generation, LLM-response parsing, free-form-name slugification, and so on.

`@typeagent/agent-flows` collects the **pure, agent-agnostic** parts of that machinery into one package so behavior stays uniform across agents and individual agents shrink to their domain-specific glue.

**Architectural posture:**

- **Zero runtime dependencies** beyond `typescript`. This is load-bearing — the package is consumed by agents with very different dependency surfaces and any new transitive dep would propagate widely. Helpers that need `@typeagent/agent-sdk` (e.g. anything that touches `Storage` or `ActionContext`) live in the consuming agent, not here.
- **Generic over caller types.** Parameter shapes differ between agents (Excel's `ExcelFlowParameter` has `range`/`sheetName`/`columnLetter`/…; PowerShell's is different again). Utilities take the caller's type as a generic and the caller supplies a type-narrowing validator.
- **Curated data stays at the caller.** Things like alias dictionaries for common LLM hallucinations, reserved-action-name predicates, and dynamic-schema allow-lists are agent-specific and pass in as options — they're not baked into the library.

## Module index

Each module is documented in detail at the top of its source file; this index points you at the right one.

### Runtime — script validation + execution

| Module                                                                  | Exports                                                                                                                    | What it does                                                                                                                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`types`](./src/types.ts)                                               | `ValidationError`, `ValidationResult`, `ScriptResult`, `FlowParameterDefinition`, `FlowSchemaEntry`, `FlowSchemaParameter` | Shared TypeScript shapes for validator output, parameter declarations, and runtime results.                                                                                     |
| [`validation/scriptValidator`](./src/validation/scriptValidator.ts)     | `createScriptValidator`, `transpileScript`, `BLOCKED_IDENTIFIERS`, `ALLOWED_GLOBALS`                                       | AST-based static check for sandbox violations (blocked identifiers, disallowed dynamic constructs, unsafe globals) before a script is allowed to run.                           |
| [`execution/scriptExecutor`](./src/execution/scriptExecutor.ts)         | `createScriptExecutor`                                                                                                     | Runs a validated script with a caller-provided sandbox API, parameter bindings, and timeout. Wraps the result in a `ScriptResult` so failure modes are uniform across agents.   |
| [`sandbox/declarationGenerator`](./src/sandbox/declarationGenerator.ts) | `createSandboxDeclarationGenerator`                                                                                        | Generates the `.d.ts` shown to the LLM (and to TS validation) describing the sandbox API the script can call — so the same surface drives authoring, validation, and execution. |

### Schema + grammar generation

| Module                                                      | Exports                                                                                                          | What it does                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`schema/schemaBuilder`](./src/schema/schemaBuilder.ts)     | `generateFlowActionTypes`, `buildUnionType`                                                                      | Emits TypeScript action union types from a flow registry so the dispatcher's TypeChat layer can dispatch user-defined flows alongside built-in actions.                                                                                       |
| [`grammar/grammarBuilder`](./src/grammar/grammarBuilder.ts) | `generateGrammarRuleText`, `extractRuleNames`, `buildStartRule`, `assembleDynamicGrammar`, `GrammarPatternInput` | Composes the dynamic action grammar from per-flow pattern definitions. Accepts both bare-string patterns and `{ pattern, isAlias }` records.                                                                                                  |
| [`grammar/triggerPhrase`](./src/grammar/triggerPhrase.ts)   | `computeTriggerPhrase`, `generateDefaultGrammarPatterns`                                                         | Derives default `(run \| execute \| apply) <displayName> $(p1:wildcard) $(p2:number)?` patterns from a flow's display name + parameter list. Trigger verbs are configurable; auto-resolvable parameter types are caller-supplied via options. |

### Flow authoring + persistence helpers

| Module                                      | Exports                                                                               | What it does                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`naming`](./src/naming.ts)                 | `tokenizeForTriggerPhrase`, `slugifyFlowName`, `resolveUniqueActionName`              | Convert a free-form `displayName` ("Bold Test Box!") into a safe camelCase `actionName` (`boldTestBox`), then disambiguate against existing flows + an injected reserved-name set. Strips diacritics; falls back to `unnamedFlow` for symbolic-only input.                                                                                         |
| [`jsonHelpers`](./src/jsonHelpers.ts)       | `tryParseJsonArray` (strict), `parseOptionalJsonArray` (permissive), `ParseResult`    | Two array-of-JSON parsers with deliberately different policies: strict for load-bearing fields where silent failure would persist a broken flow (`parameters`, `grammarPatterns`); permissive for cosmetic fields where dropping malformed input is fine (`tags`).                                                                                 |
| [`llmResponse`](./src/llmResponse.ts)       | `parseFlowLLMResponse`, `FlowLLMResponse`, `FlowLLMResponseOptions`                   | Tolerant parser for LLM "flow + metadata" emit shapes. Walks the observed fallthrough order (` ```json ` → plain ` ``` ` JSON object → raw `{…}` slice → ` ```ts ` bare script). Generic over the caller's parameter type with an injectable type-narrowing validator and optional `debug` sink (defaults to no-op so the package stays dep-free). |
| [`markdown`](./src/markdown.ts)             | `INDENT`, `SECTION_BREAK`, `escapeMarkdown`, `escapeCodeSpan`, `formatTimestamp`      | Formatting primitives for `ActionResult` markdown so list / show views render consistently across agents and renderers (entity-escaped non-breaking spaces, friendly timestamps, escaped specials).                                                                                                                                                |
| [`actionCatalog`](./src/actionCatalog.ts)   | `parseActionCatalog`, `makeRegistry`, `ActionRegistry`, `ActionCatalogOptions`        | Parse the LLM-facing API catalog comment block into an `ActionRegistry` of `(schemaName, actionName)` pairs. The single source of truth for "what does the agent know how to call." Block + inline catalog formats both supported; the two regexes are overridable for non-standard catalogs.                                                      |
| [`unknownActions`](./src/unknownActions.ts) | `findUnknownActionCalls`, `formatUnknownActionError`, `closestActions`, `levenshtein` | Static scan for `api.callAction("schema", "action", …)` sites whose pair isn't in the registry — catches invented action names at validation time so the repair loop can fix them before persistence. Suggestions blend a caller-supplied alias dictionary (highest signal) with substring/Levenshtein fuzzy matching.                             |

## Composition pattern

The Excel agent illustrates the intended composition: thin wrappers that bind the generic library functions to Excel-specific data.

```ts
// excelActionRegistry.ts (sketch)
import {
  parseActionCatalog,
  findUnknownActionCalls as _findUnknownActionCalls,
  type ActionRegistry,
} from "@typeagent/agent-flows";

// Excel-specific config — the catalog source, the alias dictionary, and
// the dynamic-schema allow-list — stays here, not in the library.
const DYNAMIC_SCHEMAS = new Set(["excel-flow"]);
const KNOWN_ALIASES: Record<string, string[]> = {
  setrangeitalic: ["setFont"],
  setcellcolor: ["setFillColor"],
  // …
};

let registry: ActionRegistry | undefined;
function getRegistry() {
  registry ??= parseActionCatalog(buildExcelApiCatalog());
  return registry;
}

export function findUnknownActionCalls(script: string) {
  return _findUnknownActionCalls(script, getRegistry(), {
    dynamicSchemas: DYNAMIC_SCHEMAS,
    aliases: KNOWN_ALIASES,
  });
}
```

The same shape applies to `parseFlowLLMResponse` (caller passes an `isValidFooParameters` validator + an agent-local `debug` instance), `resolveUniqueActionName` (caller passes the agent's `isReservedActionName` predicate), and `generateDefaultGrammarPatterns` (caller passes the set of auto-resolvable parameter types).

## Adoption status across TypeAgent flow agents

| Module                                                                                          | Excel | PowerShell                                 | TaskFlow       | WebFlows                         |
| ----------------------------------------------------------------------------------------------- | ----- | ------------------------------------------ | -------------- | -------------------------------- |
| Runtime: `validation`, `execution`, `sandbox`, `schema/schemaBuilder`, `grammar/grammarBuilder` | ✅    | ✅                                         | ✅             | ✅                               |
| `markdown`                                                                                      | ✅    | adoption-ready                             | adoption-ready | adoption-ready                   |
| `jsonHelpers`                                                                                   | ✅    | adoption-ready                             | adoption-ready | adoption-ready                   |
| `naming`                                                                                        | ✅    | adoption-ready                             | adoption-ready | adoption-ready                   |
| `grammar/triggerPhrase`                                                                         | ✅    | LLM-authored patterns (different approach) | LLM-authored   | LLM-authored                     |
| `llmResponse`                                                                                   | ✅    | narrow variant in `ScriptAnalyzer`         | not needed     | uses TypeChat translator instead |
| `actionCatalog`                                                                                 | ✅    | not applicable                             | not applicable | not applicable                   |
| `unknownActions`                                                                                | ✅    | not applicable                             | not applicable | not applicable                   |

✅ = active consumer · _adoption-ready_ = same need today, replacing the ad-hoc implementation with this module is a mechanical change · _different approach_ = the agent solves the same problem with a different strategy (TypeChat translators, LLM-authored grammar) that is not strictly worse — adoption is optional · _not applicable_ = the agent doesn't have this need given its sandbox/dispatch model.

### When to reach for `llmResponse` vs TypeChat

`parseFlowLLMResponse` is the right tool when an LLM emits free-form text that contains a script + metadata in one of several known shapes (fenced JSON, raw JSON object, bare code block). It exists because Excel's create/edit/repair loop talks to multiple model backends whose emit shapes drift over time.

If the LLM call lives behind a stable schema, prefer a [TypeChat](https://github.com/microsoft/TypeChat) translator instead — it gives you structured output with validation up front rather than tolerant parsing after the fact. WebFlows takes this approach in `scriptGenerator.mts` and it's the better choice when applicable.

### When to reach for `actionCatalog` + `unknownActions`

These two modules are Office-family-shaped: they assume the agent has a curated catalog of `(schemaName, actionName)` pairs the LLM must call from, embedded in a comment-block alongside the prompt so authoring + validation share one source of truth. Excel uses this pattern; sibling Office agents (WordFlow, PowerPointFlow) will inherit it.

Agents that dispatch through TypeScript unions (WebFlows) or generate their action surface as TS schema (TaskFlow) don't need these modules. There is no penalty for not adopting them.

### Future direction

A `generateDynamicSchemaText()` helper is on the near-term roadmap — all four current flow agents have isomorphic code that orchestrates `generateFlowActionTypes` + `buildUnionType` on top of their flow store. A shared `FlowStore` (persistence + indexing) is the largest single remaining extraction candidate but is gated on a dependency-posture decision (whether the package can take `@typeagent/agent-sdk` as a peer dep). Tracked in the internal design doc.

## Adding a new utility

The library only accepts patterns that are:

1. **Pure** — no I/O, no Storage, no dispatcher imports, no LLM-client imports.
2. **Stable across agents** — at least two existing agents either already use this pattern or would benefit if they adopted it. If only one agent uses it, leave it in that agent.
3. **Dependency-free at runtime** — if you need a logger, debug sink, or storage, accept it as an injected option (default to no-op or in-memory).
4. **Generic over caller types** — don't hard-code one agent's parameter / definition shape. Take it as a `<T>` with a validator passed in.

When extending:

1. Add the new module under `./src/`. Document the contract in a top-of-file comment (the library's primary documentation surface).
2. Export the public names from [`./src/index.ts`](./src/index.ts).
3. If the lifted code is currently in a consuming agent, replace the agent's copy with a thin wrapper that imports from `@typeagent/agent-flows` and binds the agent-specific data. Keep the wrapper's name + signature stable so existing call sites and tests don't churn.
4. Run a full build of the package and a build + test pass of each downstream consumer to verify behavioral equivalence.

## Documentation companion

The companion file [`README.AUTOGEN.md`](./README.AUTOGEN.md) is regenerated daily by the `docs-generate.yml` workflow from this README + the package source. Don't hand-edit it. Update this file (or the in-source doc comments) and the regen will pick the changes up on the next cycle.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
