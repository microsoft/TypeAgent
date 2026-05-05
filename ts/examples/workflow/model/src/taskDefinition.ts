// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { JSONSchema } from "./ir.js";

/**
 * The result of executing a task.
 *
 * In IR v1, branches are separate nodes (kind: "branch"). Tasks always
 * return ok or fail; there is no "branch" result kind.
 */
export type TaskResult<O = unknown> =
    | { kind: "ok"; output: O }
    | { kind: "fail"; error: { message: string; data?: unknown } };

/**
 * Context passed to a task's `execute` function.
 */
export interface TaskContext {
    /** Unique identifier for the current workflow run. */
    runId: string;

    /** Id of the node being executed within the workflow. */
    nodeId: string;

    /** Scope path for observability (e.g., ["workflow", "loop.body"]). */
    scopePath: string[];

    /** Signal for cooperative cancellation. */
    signal: AbortSignal;
}

/**
 * A registered task implementation.
 */
export interface TaskDefinition<I = unknown, O = unknown> {
    /** Unique task name, e.g. "email.fetchUnread". */
    name: string;

    /** JSON Schema for the task's input. */
    inputSchema: JSONSchema;

    /** JSON Schema for the task's output. */
    outputSchema: JSONSchema;

    /**
     * Whether this task has side effects (network, filesystem, shell, etc.).
     * When true, the engine's task policy is consulted before execution.
     *
     * NOTE: This is a temporary, minimal guardrail. A formal capability/
     * permission model should be designed when there is a concrete trigger
     * (e.g., multi-user execution, untrusted workflow sources, or a
     * plugin ecosystem).
     */
    sideEffects?: boolean;

    /** Execute the task with validated input. */
    execute(input: I, ctx: TaskContext): Promise<TaskResult<O>>;
}

/**
 * Policy for controlling execution of side-effecting tasks.
 *
 * - "allow": execute without prompting (default for tasks without sideEffects)
 * - "prompt": call the approval callback before executing
 * - "deny": fail immediately without executing
 *
 * NOTE: Temporary guardrail. See TaskDefinition.sideEffects.
 */
export type TaskPolicyMode = "allow" | "prompt" | "deny";
export type TaskPolicy = Record<string, TaskPolicyMode>;

/**
 * Callback invoked when a task with sideEffects=true is about to execute
 * and its policy is "prompt". Return true to allow, false to deny.
 */
export type ApprovalFn = (
    taskName: string,
    inputs: unknown,
) => Promise<boolean>;
