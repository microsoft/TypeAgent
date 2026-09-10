# TypeAgent-Copilot Structured Action Invocation

**Status:** Draft
**Last Updated:** 2026-09-10

## Revision Notes

2026-09-10: Resolved the structured action interface questions, including MCP exposure, progressive discovery, contract versioning, authorization, multi-step behavior, and sharing across integration modes.

2026-09-10: Added input, discovery, and execution safeguards from the earlier shortcut design.

## Summary

TypeAgent's Copilot integration should support two distinct execution paths depending on where the intent originates:

- User-originated natural-language requests should continue to flow through TypeAgent's natural-language interface, allowing TypeAgent to perform intent and action resolution.
- Actions selected by Copilot during its own orchestration or reasoning should invoke TypeAgent through a structured action interface, avoiding an unnecessary natural-language-to-action-resolution model call inside TypeAgent.

This separates reasoning and intent resolution from action execution, allowing Copilot and TypeAgent to each own the part of the workflow where they provide the most value.

## Current Problem

In the MCP integration, Copilot can invoke TypeAgent by providing a natural-language request.

When Copilot is itself orchestrating a multi-step tool chain, this can result in an unnecessary second model call:

```text
User
 ↓
Copilot reasoning
 ↓
Copilot decides TypeAgent is needed
 ↓
Natural-language request
 ↓
TypeAgent model
 ↓
Natural language → TypeAgent action resolution
 ↓
Action execution
```

Copilot has already performed the reasoning necessary to determine what operation is required. Asking TypeAgent to interpret that decision again can add latency, cost, and another potential point of ambiguity.

The flow above shows the case that needs model translation. TypeAgent can also resolve natural language through grammar or its construction cache without a model call, so structured invocation is not always faster.

## Proposed Design

Expose TypeAgent through two complementary interfaces over MCP.

### Natural-Language Request

Used when the user's intent should be interpreted by TypeAgent.

```text
Copilot
  │
  │ Natural language
  ▼
TypeAgent
  │
  │ Intent/action resolution
  ▼
Action
  │
  ▼
Execution
```

**Example:** "Schedule a meeting with Alice tomorrow afternoon."

TypeAgent remains responsible for determining the appropriate action and parameters.

Requests with unresolved references or missing context should stay on this path or be clarified before constructing an action. Recording and development directives such as `learn:`, `dev:`, and `record:` must remain on the natural-language path, with their prefixes preserved exactly.

### Structured Action Invocation

Used when Copilot has already selected the action during orchestration.

```text
Copilot
  │
  │ Structured action + arguments
  ▼
TypeAgent
  │
  │ Action validation / dispatch
  ▼
Execution
```

**Conceptually:**

```json
{
  "action": "Calendar.CreateEvent",
  "parameters": {
    "title": "Meeting with Alice",
    "start": "...",
    "end": "..."
  }
}
```

TypeAgent should validate and dispatch this action without performing another natural-language interpretation step.

Copilot must know the current action contract and have concrete inputs before using this path. Keep lists, IDs, and paths as structured values rather than converting them to prose. Selecting an action alone does not resolve missing inputs or references such as "it" or "that one."

## Action Discovery

To make structured invocation practical, TypeAgent should expose its action model as a discoverable capability surface.

Discovery should provide enough information for Copilot to determine:

- What actions TypeAgent supports
- What each action does
- The action's stable identifier
- Required and optional parameters
- Input schema
- Relevant constraints
- Expected outputs and any authorization, confirmation, or interaction requirements
- Whether the action is currently available, and what setup is missing if it is not

**Conceptually:**

```text
                   TypeAgent
                      │
                Action Discovery
                      │
            ┌─────────┴─────────┐
            │                   │
     Calendar.CreateEvent   Email.Send
            │                   │
        input schema        input schema
```

For large action catalogs, discovery should preferably support search and progressive disclosure rather than requiring the entire TypeAgent action catalog to be loaded into Copilot's context.

Use two required levels of progressive disclosure:

1. **Action summary:** Search or list compact action identifiers, descriptions, and current availability.
2. **Action contract:** Retrieve one closed, self-contained contract with its parameters, referenced types, constraints, outputs, and interaction requirements.

Server status and capability or schema names may be returned as metadata and search filters, but they should not be mandatory retrieval stages. Treating them as required levels would add round trips without improving the contract boundary. The action is the unit of selection, caching, and compatibility.

The normal flow is:

```text
search actions → get selected action contract → execute action
```

A caller that already knows the action should be able to fetch its contract directly; a caller with a current contract should not need to repeat discovery. A contract must include referenced enums and nested types without loading unrelated actions from the same schema.

Contracts may be reused within the same server and session/permission scope. TypeAgent must detect an outdated contract before execution and ask the caller to refresh it using the exact-match mechanism below.

Discovery must respect the caller's permissions. It neither enables actions nor grants permission to execute them. No match or an ambiguous match should lead to clarification or natural-language handling, not guessed action parameters.

### Contract Versioning

Discovery responses include a protocol version for the structured-action envelope and an opaque fingerprint for each action contract. Execution must supply the fingerprint returned with the selected contract.

TypeAgent compares the supplied fingerprint with the current contract before any effect is possible. A mismatch returns `contract_stale` without executing the action. The caller must fetch the current contract and construct a new request; TypeAgent must not reinterpret parameters under the changed contract.

The initial implementation may conservatively use the existing schema source hash. The target fingerprint should hash a canonical representation of the selected action's execution-relevant contract, including parameter types, required fields, constraints, referenced definitions, outputs, and interaction shape. Descriptions and transient availability, authentication, permission, and readiness state must not affect the fingerprint.

Version 1 uses exact fingerprint matching rather than attempting semantic compatibility between arbitrary schema changes. This intentionally favors a safe refresh over complex compatibility rules for unions, nested types, constraints, and interaction results.

## MCP Interface

Expose a small, fixed set of operations through the existing TypeAgent MCP server:

- Search or list action summaries.
- Retrieve one complete action contract.
- Execute one action against that contract.
- Continue or cancel a pending interaction when the transport cannot represent that interaction directly.

These operations are normal MCP tools. Individual TypeAgent actions remain data returned by discovery rather than being registered as separate MCP tools. This keeps a large, dynamic, permission-sensitive catalog out of Copilot's native tool list and allows enabled actions to change during a session. Native per-action tools may be reconsidered if Copilot supports reliable dynamic tool-list refresh and large catalogs without excessive context use.

Use the existing `schemaName` and `actionName` as the action identity. Keep them as separate request fields even if discovery also provides a joined display identifier.

The MCP package is a transport adapter over a shared structured-action service in the dispatcher or agent server. Discovery, contract generation, fingerprinting, validation, readiness checks, execution, and interaction state do not belong in the MCP adapter.

## Responsibility Boundaries

The resulting architecture establishes a clear division of responsibilities:

| Scenario                                       | Intent resolution | TypeAgent interface |
| ---------------------------------------------- | ----------------- | ------------------- |
| User asks TypeAgent to perform something       | TypeAgent         | Natural language    |
| Copilot decides a TypeAgent action is required | Copilot           | Structured action   |
| Action validation and execution                | TypeAgent         | Action dispatcher   |

The structured path therefore does not bypass TypeAgent. TypeAgent remains responsible for the action contract, validation, authorization, routing, and execution.

What it bypasses is only the redundant natural-language-to-action-interpretation step.

Both paths should use the existing dispatcher execution engine, rather than a separate executor in the Copilot integration. A discovered contract does not replace live availability, authorization, or confirmation checks.

Structured calls also need clear results for the next step: machine-readable data and stable IDs where available, plus readable text. Distinguish completion, failure, cancellation, and required interaction. Never silently answer a required choice or report completion while confirmation is pending. Define how an interaction resumes, or say when continuation is unsupported.

Bind calls to the intended conversation and make any use of prior-turn context explicit. After a timeout, disconnect, or cancellation, effects may already have occurred. Do not automatically replay the action unless it is known not to have executed or is safe to repeat.

For structured invocation, Copilot selecting an action does not count as user confirmation. Before execution, TypeAgent must:

1. Bind the request to the correct caller, TypeAgent session, and Copilot conversation.
2. Reject a stale contract.
3. Resolve the current action and validate its parameters.
4. Check that the schema and action are enabled.
5. Run agent readiness and setup checks.
6. Preserve authentication and resource authorization enforced by the owning service.
7. Request user confirmation for destructive, external, costly, or sensitive effects.

A required choice or form returns `requires_interaction` with an opaque, session-bound, single-use interaction ID. A later call submits the user's response or cancels the interaction. The integration must not choose a default answer on the user's behalf. Completion, failure, cancellation, `contract_stale`, unavailability, and uncertain execution after a disconnect or timeout must remain distinct result states.

## Multi-Step Behavior

Version 1 exposes only single structured action calls:

- Copilot invokes individual actions in sequence when it owns the orchestration.
- A registered TypeAgent flow may be exposed as one action while its internal steps remain private.
- A request that still requires interpretation or planning uses the natural-language path.

Do not expose a general-purpose structured plan API in version 1. Such an API would require result bindings, partial-failure behavior, confirmation suspension, cancellation, retry, and rollback semantics that single action invocation does not need. If repeated calls later prove insufficient, a batch design can add those semantics explicitly without changing the initial action contract.

## Shared Integration Service

Direct and MCP integration modes share the same transport-neutral structured-action service. It owns discovery, action identity and contracts, fingerprints, validation, readiness and authorization checks, execution, structured results, and interaction and cancellation semantics.

MCP maps the service to MCP tools and structured content. Direct mode calls it through the dispatcher interface. This does not change ordinary Direct-mode prompts: user-originated natural language continues through TypeAgent's intent resolution, and only callers that already know the action and concrete parameters use the shared structured interface.

## Architectural Model

```text
                        ┌─────────────┐
                        │    User     │
                        └──────┬──────┘
                               │
                        Natural language
                               │
                               ▼
                        ┌─────────────┐
                        │   Copilot   │
                        │ Orchestrator│
                        └──────┬──────┘
                               │
               ┌───────────────┴────────────────┐
               │                                │
      User-originated intent          Copilot-selected action
               │                                │
       Natural-language path             Structured path
               │                                │
               ▼                                ▼
      ┌────────────────────────────────────────────┐
      │                  TypeAgent                 │
      │                                            │
      │  NL → Action Resolution    Action Dispatch │
      │            │                       │        │
      │            └───────────┬───────────┘        │
      │                        ▼                    │
      │                    Execution                │
      └────────────────────────┬───────────────────┘
                               │
                               ▼
                          Tool / Service
```

## Design Principle

The core principle is:

> The system that owns intent resolution should determine the action; the system that owns the action should execute it.

For user-originated requests, TypeAgent owns intent resolution.

For actions selected as part of Copilot's orchestration, Copilot owns intent resolution and TypeAgent should provide a structured execution boundary.

This avoids redundant reasoning while preserving TypeAgent's action abstraction, validation, and execution ownership.

## Expected Benefits

- **Lower latency:** Avoids a TypeAgent translation model call when the natural-language path would need one. Discovery adds work on the first use; contract reuse avoids repeated lookups.
- **Lower cost:** Avoids duplicate reasoning.
- **Higher determinism:** Structured action IDs and typed parameters remove ambiguity introduced by natural language, but do not make action results or external services deterministic.
- **Better orchestration:** Copilot can compose TypeAgent actions naturally with other tools.
- **Clear ownership:** Copilot handles orchestration; TypeAgent handles its action domain and execution.
- **Scalability:** Action discovery can support large TypeAgent catalogs without injecting every action schema into the model context.
- **Backward compatibility:** Clients that only understand natural language can continue using the existing TypeAgent path.
