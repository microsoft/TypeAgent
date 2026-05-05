# Task Policy: Temporary Guardrail

**Status:** Temporary / minimal implementation.
**Implemented in:** workflow-engine runner + CLI.

## What exists today

A lightweight approval mechanism that gates side-effecting tasks before
execution:

- `TaskDefinition.sideEffects?: boolean` marks tasks that touch the outside
  world (shell, filesystem, network, LLM).
- `TaskPolicy` (per-task map of `"allow" | "prompt" | "deny"`) controls what
  happens when a side-effecting task is reached.
- `ApprovalFn` callback lets the host (CLI, GUI, test harness) decide
  interactively.
- Default for side-effecting tasks with no explicit policy: `"prompt"`.
- CLI supports `--dry-run` (sets all side-effecting tasks to `"deny"`).

## What this is NOT

This is not a security boundary. It is a development-time convenience that
makes it easier to test and review workflows without accidentally running
shell commands, writing files, or calling LLMs.

## When to design the real thing

A formal capability/permission model should be designed when one of these
triggers occurs:

1. **Multi-user execution** - workflows run on behalf of users other than
   the author.
2. **Untrusted workflow sources** - loading workflows from a registry,
   marketplace, or external contributors.
3. **Plugin ecosystem** - third-party tasks that the engine operator has not
   reviewed.
4. **Audit requirements** - need to log who approved what and when.

At that point, the design should consider: capability categories (filesystem,
network, shell, LLM), per-workflow permission grants, signed workflows,
sandboxing, and audit trails.
