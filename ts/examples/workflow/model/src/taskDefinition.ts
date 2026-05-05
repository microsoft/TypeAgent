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

    /** Execute the task with validated input. */
    execute(input: I, ctx: TaskContext): Promise<TaskResult<O>>;
}
