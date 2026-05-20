// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * IR v1 type definitions for the workflow intermediate representation.
 *
 * These types mirror the spec in ir-v0.1.md. The engine loads a WorkflowIR
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

export interface BranchArm {
    inputs: Record<string, Template>;
    scope: WorkflowScope;
}

export interface BranchNode {
    kind: "branch";
    selector: Template;
    selectorSchema: JSONSchema;
    /**
     * Each case maps a discriminant value to a `BranchArm`: an
     * `inputs` template wiring outer-scope values into the arm and a
     * `scope` (`WorkflowScope`) that runs in isolation. Identical in
     * shape to `ForkBranch` (ir-v0.2 §2.1). Per decision 0010, arms
     * are full sub-scopes - not bare node IDs - so a branch composes
     * exactly like fork/forkMap/loop body.
     */
    cases: Record<string, BranchArm>;
    /**
     * Arm taken when the selector matches no case.
     *
     * If omitted, the branch must be **exhaustive**: `selectorSchema` must
     * declare an `enum` and every value in the enum must have a matching
     * case key. Additionally the selector's resolved type must be provably
     * narrowed to a subset of the enum. The static validator rejects
     * non-exhaustive branches that omit `default`.
     */
    default?: BranchArm;
    /**
     * Type of the branch's output value (the selected arm's
     * `scope.output`). Required iff `bind` is declared. Every arm's
     * `scope.outputSchema` must be a structural subtype of this. MUST
     * NOT be declared without `bind` (an unbound branch is pure
     * control flow and has no outer-visible value to type).
     */
    outputSchema?: JSONSchema;
    next?: string;
    /**
     * Recovery target for arm-scope failure. Selector resolution is
     * statically unreachable (exhaustiveness + dominator passes) and
     * does not contribute to onError. Per decision 0010.
     */
    onError?: string;
    /** Hide-by-default per §8.15; publishes the branch's output value
     *  under this name in the enclosing scope. Requires `outputSchema`. */
    bind?: string;
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
    /**
     * Termination predicate. Resolved in the body's binding context at
     * body natural completion (i.e., after a body node with `next:
     * null` runs). When the resolved value is `true`, `iterateState`
     * is evaluated and the loop iterates; when `false`, the loop
     * exits with `body.output` as its output value. Must be
     * boolean-typed. Per decision 0010 (retires `@iterate`/`@exit`
     * sentinels).
     */
    continueWhen: Template;
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
