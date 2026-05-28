// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { JSONSchema, SchemaTemplate } from "./ir.js";

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
     * The dispatching node's declared output schema. Tasks may use it
     * to shape their computation (e.g. schema-guided LLM responses, per
     * copilot.invoke).
     *
     * Always present: TaskNode.outputSchema is required by the IR contract
     * (`model/src/ir.ts`) and the static validator rejects task nodes that
     * omit it, so the runner can — and does — pass it unconditionally.
     *
     * The schema is a JSON Schema 7 value. A typical schema-guided task
     * dispatches on its shape:
     *   - `{ type: "object", properties: { ... } }` — produce a structured
     *     JSON object matching the declared properties.
     *   - `{ type: "string" }` — produce free text; the returned value is a
     *     plain string.
     *   - `{}` (the top schema) — produce anything; the task is free to
     *     return any JSON value.
     *
     * NOTE: The engine always validates the task's return value against the
     *       output schema after execution. Tasks normally do not need to do this,
     *       unless the task uses the results internally.
     */
    outputSchema: JSONSchema;
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
 * Declares a generic type parameter on a task definition.
 */
export interface TaskTypeParameter {
    /** Parameter name (e.g. "T"). */
    name: string;
    /** Default schema used when the caller omits the type argument. */
    default?: JSONSchema;
}

/** Fields common to both concrete and generic task definitions. */
interface TaskDefinitionBase<I, O> {
    /** Unique task name, e.g. "email.fetchUnread". */
    name: string;

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

/** A task with fixed (non-generic) input and output schemas. */
export interface ConcreteTaskDefinition<I = unknown, O = unknown>
    extends TaskDefinitionBase<I, O> {
    /** JSON Schema for the task's input. */
    inputSchema: JSONSchema;

    /** JSON Schema for the task's output. */
    outputSchema: JSONSchema;
}

/** A task with generic type parameters and schema templates. */
export interface GenericTaskDefinition<I = unknown, O = unknown>
    extends TaskDefinitionBase<I, O> {
    /** Type parameters this task accepts. */
    typeParameters: TaskTypeParameter[];

    /** Schema template for the task's input (may contain $typeParam markers). */
    inputSchemaTemplate: SchemaTemplate;

    /** Schema template for the task's output (may contain $typeParam markers). */
    outputSchemaTemplate: SchemaTemplate;
}

/**
 * A registered task implementation: either a concrete task with fixed
 * schemas, or a generic task with type parameters and schema templates.
 */
export type TaskDefinition<I = unknown, O = unknown> =
    | ConcreteTaskDefinition<I, O>
    | GenericTaskDefinition<I, O>;

/** Type guard: narrows a TaskDefinition to its generic variant. */
export function isGenericTask(
    task: TaskDefinition,
): task is GenericTaskDefinition {
    return "typeParameters" in task;
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
