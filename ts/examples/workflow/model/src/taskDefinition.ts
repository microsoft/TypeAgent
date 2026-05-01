// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { JSONSchema } from "./workflowSpec.js";

/**
 * The result of executing a task.
 */
export type TaskResult<O = unknown> =
    | { kind: "ok"; output: O }
    | { kind: "branch"; branch: string; output?: O }
    | { kind: "fail"; error: { message: string; data?: unknown } };

/**
 * Provides workflow-scoped shared secrets. Injected by the caller
 * when starting a run; the engine does not dictate the backend.
 */
export interface SecretProvider {
    get(name: string): Promise<string | undefined>;
}

/**
 * Pluggable structured logger. Injected by the caller; the engine
 * provides a default no-op implementation.
 */
export interface WorkflowLogger {
    log(level: string, msg: string, data?: unknown): void;
}

/**
 * Context passed to a task's `execute` function.
 */
export interface TaskContext {
    /** Unique identifier for the current workflow run. */
    runId: string;

    /** Id of the node being executed within the workflow. */
    nodeId: string;

    /** Signal for cooperative cancellation. */
    signal: AbortSignal;

    /** Workflow-scoped shared secrets. */
    secrets: SecretProvider;

    /** Structured logging. */
    log(level: string, msg: string, data?: unknown): void;
}

/**
 * A registered task type. Declares schemas, optional branch labels,
 * and an execute function.
 */
export interface TaskDefinition<I = unknown, O = unknown> {
    /** Unique task name, e.g. "http.get". */
    name: string;

    /** JSON Schema for the task's input. */
    inputSchema: JSONSchema;

    /** JSON Schema for the task's output. */
    outputSchema: JSONSchema;

    /**
     * Declared branch labels for decision tasks.
     * If present, the task is expected to return `kind: "branch"` with
     * one of these labels. The engine validates at load time that every
     * label has a corresponding entry in the node's `next` object.
     */
    branchLabels?: string[];

    /** Execute the task with validated input. */
    execute(input: I, ctx: TaskContext): Promise<TaskResult<O>>;
}
