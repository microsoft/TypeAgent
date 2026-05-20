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

    /**
     * Engine-level constraints passed from RunOptions.
     * Task implementations should check these to enforce caller restrictions.
     */
    constraints?: TaskConstraints;

    /**
     * The dispatching node's declared output schema, if any. Tasks may use it
     * to shape their computation (e.g. schema-guided LLM responses, per
     * copilot.invoke).
     *
     * NOTE: The engine always validates the task's return value against the
     *       output schema after execution. Tasks normally do not need to do this,
     *       unless the task uses the results internally.
     */
    outputSchema?: JSONSchema;
}

/**
 * Engine-level restrictions that callers can set via RunOptions.
 * Tasks are responsible for reading and enforcing these.
 */
export interface TaskConstraints {
    /** If set, only these commands may be executed by shell.exec. */
    allowedCommands?: string[];
    /** Additional hostnames to block (extends the built-in SSRF blocklist). */
    blockedHosts?: string[];
    /** If set, only these hostnames may be accessed by http.get. */
    allowedHosts?: string[];
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
     * Defaults to true (secure-by-default): the engine's task policy is
     * consulted before execution unless this is explicitly set to false.
     * Pure computational tasks (arithmetic, string ops, list transforms)
     * should set sideEffects: false to bypass policy checks.
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
 * - "allow": execute without prompting
 * - "prompt": call the approval callback before executing (default)
 * - "deny": fail immediately without executing
 *
 * NOTE: Temporary guardrail. See TaskDefinition.sideEffects.
 */
export type TaskPolicyMode = "allow" | "prompt" | "deny";
export type TaskPolicy = Record<string, TaskPolicyMode>;

/**
 * Result of an approval decision.
 *
 * - "approved": caller explicitly allowed the task.
 * - "denied": caller explicitly rejected the task.
 * - "timed-out": approval request expired before a decision was made.
 */
export type ApprovalResult =
    | { kind: "approved" }
    | { kind: "denied" }
    | { kind: "timed-out" };

/**
 * Callback invoked when a task with sideEffects=true is about to execute
 * and its policy is "prompt". Return an ApprovalResult.
 */
export type ApprovalFn = (
    taskName: string,
    inputs: unknown,
) => Promise<ApprovalResult>;
