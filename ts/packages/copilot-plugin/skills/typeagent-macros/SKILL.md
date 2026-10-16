---
name: typeagent-macros
description: "Discover, inspect, validate, run, and manage recorded TypeAgent program macros. Use when a user asks to repeat a recorded workflow or manage a macro."
---

# TypeAgent Program Macros

Use the `typeagent-macros` MCP server for macro catalog and lifecycle work.

## Run A Macro

1. If the macro reference is not already known, use `search_macros` or
   `list_macros` to find it.
2. If required inputs are not known, use `get_macro_requirements`. Collect
   required inputs without exposing secret values in chat.
3. Call `run_macro` with the macro reference and current inputs. The server
   resolves and validates the current approved immutable program revision;
   do not call `inspect_macro` as an execution prerequisite.
4. For `completed`, deliver the actual output without inventing or rewriting it.
   For `failed` or `cancelled`, report the structured failure. Inspect
   `get_macro_run` for durable dispatch/uncertainty evidence.

Never launch a planning agent to replay steps, reconstruct a program, or retry
an accepted failed, cancelled, denied, or uncertain run through another provider.
Symbolic programs make no model calls; hybrid programs call only declared,
bounded semantic functions. Backend authorization remains authoritative.

## Lifecycle

- Use `inspect_macro` for explicit catalog inspection and draft review, not as
  a prerequisite for execution.
- For inspection-only requests, inspect an existing candidate; do not create one
  when the catalog is empty. Report that no candidate is available and obtain
  recording/learning status before proposing another operation.
- A recording token from `armed` or `claimed` is not a trace ID. Selected
  successful recordings enter program learning automatically; do not bypass a
  pending or failed job by making a step-only draft or rerunning the task.
- Learning derives independent fixtures, validates source and executable,
  and publishes under the workspace preference: Off, Prepare, Read-only, or All.
  Prepare requires review; Read-only and All can auto-publish validated programs.
  Never change that preference for the user.
- Validate staged programs before explicit approval. Approval never runs a
  program and does not grant backend permission.
- The current production adapter supports read-only MCP tools available to
  TypeAgent. Native-only tools, writes, and unsupported semantic provenance
  requirements fail explicitly; they do not fall back to a runner.
