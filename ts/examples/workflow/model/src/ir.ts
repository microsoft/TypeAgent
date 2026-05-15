// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * IR v1 type definitions for the workflow intermediate representation.
 *
 * These types mirror the spec in ir-v1.md. The engine loads a WorkflowIR
 * document (parsed JSON), validates it structurally, then executes it.
 */

import type { JSONSchema7 } from "json-schema";

/** JSON Schema Draft 7 type, re-exported from @types/json-schema. */
export type JSONSchema = JSONSchema7;

/**
 * Template: any JSON value the engine evaluates recursively.
 *
 * At runtime, objects with a `$from` key are references, objects with a
 * `$literal` key are literal escapes, and everything else evaluates
 * element-wise (arrays) or property-wise (plain objects).
 */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type Template =
    | string
    | number
    | boolean
    | null
    | Template[]
    | { [key: string]: Template };

// ---- Node types ----

export interface TaskNode {
    kind: "task";
    task: string;
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
    inputs: Record<string, Template>;
    next?: string;
    onError?: string;
    bind?: string;
    timeoutMs?: number;
}

export interface BranchNode {
    kind: "branch";
    selector: Template;
    selectorSchema: JSONSchema;
    cases: Record<string, string>;
    default: string;
}

export interface LoopStateVar {
    schema: JSONSchema;
    initial: Template;
}

// ---- Scope: the common sub-workflow contract ----

/**
 * A self-contained execution scope: a sequence of nodes with declared
 * inputs and a declared output. Used for loop bodies, fork branches,
 * forkMap bodies, and the top-level workflow.
 */
export interface WorkflowScope {
    /** Schema describing what this scope expects as input. */
    inputSchema: JSONSchema;

    /** First node to execute. */
    entry: string;

    /** The nodes in this scope. */
    nodes: Record<string, WorkflowNode>;

    /** Template that produces this scope's output value. Resolved in
     *  the scope's own binding context after execution completes. */
    output: Template;

    /** Schema of the output value. */
    outputSchema: JSONSchema;
}

export interface LoopNode {
    kind: "loop";
    inputs: Record<string, Template>;
    body: WorkflowScope;
    state: Record<string, LoopStateVar>;
    iterateState: Record<string, Template>;
    maxIterations?: number;
    next?: string;
    onError?: string;
    bind?: string;
    timeoutMs?: number;
}

export interface ForkBranch {
    inputs: Record<string, Template>;
    scope: WorkflowScope;
}

export interface ForkNode {
    kind: "fork";
    branches: Record<string, ForkBranch>;
    outputSchema: JSONSchema;
    maxConcurrency?: number;
    next?: string;
    onError?: string;
    bind?: string;
}

export interface ForkMapNode {
    kind: "forkMap";
    collection: Template;
    collectionSchema: JSONSchema;
    elementParam: string;
    inputs?: Record<string, Template>;
    body: WorkflowScope;
    outputSchema: JSONSchema;
    maxIterations?: number;
    maxConcurrency?: number;
    next?: string;
    onError?: string;
    bind?: string;
}

export type WorkflowNode =
    | TaskNode
    | BranchNode
    | LoopNode
    | ForkNode
    | ForkMapNode;

// ---- Top-level IR ----

export interface ConstantDef {
    schema: JSONSchema;
    value: unknown;
}

export interface WorkflowIR extends WorkflowScope {
    kind: "workflow";
    name: string;
    description?: string;
    version: string;
    types?: Record<string, JSONSchema>;
    constants?: Record<string, ConstantDef>;
}
