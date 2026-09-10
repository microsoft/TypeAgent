# TypeAgent-Copilot Structured Action Invocation

**Status:** Draft
**Last Updated:** 2026-09-10

## Revision Notes

2026-09-10: Added input, discovery, and execution safeguards from the earlier shortcut design, while keeping this document's architecture and open interface questions.

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

Start with compact summaries, then load the selected action's complete contract, including referenced types and required constraints. A caller that already knows the action should be able to fetch its contract directly; a caller with a current contract should not need to repeat discovery.

Contracts may be reused within the same server and session/permission scope. TypeAgent must detect an outdated contract before execution and ask the caller to refresh it. The compatibility mechanism remains an open question.

Discovery must respect the caller's permissions. It neither enables actions nor grants permission to execute them. No match or an ambiguous match should lead to clarification or natural-language handling, not guessed action parameters.

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

## Open Questions

1. How should TypeAgent actions be exposed through the existing MCP plugin model?
2. Should action discovery be a callable MCP tool, or should action metadata participate directly in Copilot's native tool-discovery mechanism?
3. What is the appropriate granularity of discovery: server, capability, action, or full schema?
4. How should action versioning and schema compatibility be handled?
5. Which authorization and confirmation checks must occur when Copilot directly invokes an action?
6. How should multi-step TypeAgent actions or plans be represented?
7. Can the structured action contract be shared across the Direct and MCP integration modes?
