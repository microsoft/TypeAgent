---
name: typeagent-macros
description: "Discover, inspect, validate, and run TypeAgent tool-composed macros. Use when a user asks to repeat a recorded workflow or run, adapt, repair, or manage a TypeAgent macro."
---

# TypeAgent Macros

Use the `typeagent-macros` MCP server for macro catalog and lifecycle work.

## Run A Macro

1. Use `search_macros` or `list_macros` to find the macro.
2. Use `inspect_macro` and `get_macro_requirements` before execution. Collect
   all required inputs without exposing secret values in chat.
   Inputs may fill nested argument-template fields, and later steps may bind
   values from earlier results.
3. Call `run_macro` with `preference: "auto"`.
4. For `completed`, report the sanitized result. For `failed` or `cancelled`,
   report the structured failure without inventing a repair. A
   `postconditionFailed` result means the live tool output no longer has the
   shape captured by the approved procedure.
5. For `agentRequired`, invoke the `TypeAgent Macro Runner` agent with the
   complete returned `launch` object. Do not manually paraphrase or reconstruct
   the launch payload.

Deterministic replay and agent-guided execution are whole-macro choices. Never
replay a prefix before handing the remaining steps to the runner.

## Adaptation

The runner may submit a changed successful procedure through
`submit_macro_candidate`. Candidate submission creates a separately reviewable
draft. It never changes or approves the source version. Permission denial,
cancellation, and timeout are terminal outcomes, not adaptation signals.

## Lifecycle

- For inspection-only requests, inspect an existing candidate; do not create one
  when the catalog is empty. Report that no candidate is available and obtain
  the recording/learning status before proposing another operation.
- A recording token from `armed` or `claimed` is not a trace ID. Only use the
  saved trace ID from a completed recording with `create_macro_from_trace`.
  Selected learning prepares its own candidate; do not bypass a pending or
  failed learning job by creating another draft.
- Create drafts only from explicitly captured traces.
- Validate drafts before asking the user to approve them.
- Selected completed recordings automatically enter recipe extraction, generalized
  building, grammar validation, and registration. Do not rerun the task to teach it.
- The workspace preference is Off, Prepare, Read-only, or All. Prepare requires
  review; Read-only auto-approves read-only procedures; All auto-approves valid
  procedures including writes. Never change that preference for the user.
- Newly learned macros execute through the live macro runner. Macro approval does
  not grant tool permission; denial and cancellation remain terminal.
- Use `get_macro_run` only for sanitized persisted deterministic run evidence.
