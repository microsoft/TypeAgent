---
name: typeagent-macros
description: "Discover, inspect, validate, run, and manage recorded TypeAgent program macros. Use when a user asks to repeat a recorded workflow or manage a macro."
---

# TypeAgent Program Macros

Use the `typeagent-macros` MCP server for macro catalog and lifecycle work.
Use the configured owner; never switch owners or learning preferences for the
user. Routing mode, owner and learning preference are separate settings.

## Run A Macro

1. If the macro reference is not already known, use `search_macros` or
   `list_macros` to find it.
2. If required inputs are not known, use `get_macro_requirements`. Collect
   required inputs without exposing secret values in chat.
3. Call `run_macro` with the macro reference and current inputs. The server
   resolves and validates the current approved immutable program revision;
   do not call `inspect_macro` as an execution prerequisite.
4. For `completed`, deliver the actual output without inventing or rewriting it.
   For any non-completed outcome, report its actual structured status without
   claiming success. Inspect `get_macro_run` for durable dispatch/uncertainty evidence.

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
  successful learning recordings enter program learning automatically; do not bypass a
  pending or failed job by making a step-only draft or rerunning the task.
- Native selected learning requires the actual token-bound root success receipt
  and subsequent final answer. Attest success only after the task succeeds;
  the receipt is not independent correctness verification. `awaitingAuthor`
  is not ready. New user work may preempt a child with a recoverable lease;
  Off/Cancel rejects late work rather than authorizing another provider.
- Learning derives independent fixtures, validates source and executable,
  and publishes under the workspace preference: Off, Prepare, Read-only, or All.
  Prepare requires review; Read-only and All can auto-publish validated programs.
  Never change that preference for the user.
- Validate staged programs before explicit approval. Approval never runs a
  program and does not grant backend permission.
- If the user identifies a problem during review, call `revise_macro` with the
  exact current draft version and their plain-language feedback. Do not edit
  stored artifacts or approve the old draft. Check `get_macro_learning_job`;
  `queued`, `building` and `awaitingAuthor` are not ready. Once `needsReview`,
  inspect and validate the returned new version, explain the correction, and
  obtain explicit approval before calling `approve_macro`. Revisions always
  require review, even under Read-only or All. Failed corrections do not
  publish; report the error and request another correction only if the user
  wants one. Changes must stay within the captured tool contracts.

## Owner-specific capabilities

- `typeagent` (default): the initial broker supports read-only MCP tools
  available to TypeAgent; native-only tools fail explicitly.
- `plugin` (opt-in): supports native `view`, `rg`, `glob` and exact explicitly
  classified read-only MCP identities. Optional TypeAgent action support requires
  the selected action's read-only contract, not blanket classification of the
  generic execute tool.
- `off`: recipe routing/learning is disabled; do not select another owner.

Both production brokers reject writes and unsupported schemas/provenance.
Read-effect classification and publication do not grant permission. Normal
native hooks, content exclusions and backend authorization remain authoritative.
All does not enable writes. A clean pre-acceptance miss may stay native; an
accepted/ambiguous failure must never be repeated through a native/planner route.
