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

export interface LoopNode {
    kind: "loop";
    inputs: Record<string, Template>;
    inputSchema: JSONSchema;
    state: Record<string, LoopStateVar>;
    body: {
        entry: string;
        nodes: Record<string, WorkflowNode>;
    };
    iterateState: Record<string, Template>;
    output: Template;
    outputSchema: JSONSchema;
    maxIterations: number;
    next?: string;
    onError?: string;
    bind?: string;
}

export type WorkflowNode = TaskNode | BranchNode | LoopNode;

// ---- Top-level IR ----

export interface ConstantDef {
    schema: JSONSchema;
    value: unknown;
}

export interface WorkflowIR {
    kind: "workflow";
    name: string;
    description?: string;
    version: string;
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
    types?: Record<string, JSONSchema>;
    constants?: Record<string, ConstantDef>;
    nodes: Record<string, WorkflowNode>;
    entry: string;
    output: Template;
}
