// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * JSON Schema type. Uses a permissive shape so the engine can pass it
 * directly to ajv without an intermediate mapping layer.
 */
export type JSONSchema = Record<string, unknown>;

/**
 * A flat dictionary mapping task input field names to data source paths.
 *
 * Paths follow one of three patterns:
 *   - `input.<field>`              - workflow input
 *   - `variables.<name>`           - workflow variable
 *   - `nodes.<nodeId>.output.<field>` - output of a prior node
 */
export type InputMap = Record<string, string>;

/**
 * A single node in the workflow graph.
 */
export interface WorkflowNode {
    /** Name of the registered task to execute. */
    task: string;

    /**
     * Flat mapping of task input fields to data source paths.
     * When omitted, the predecessor's full output is piped as input
     * (pipeline mode). Load-time validation checks schema compatibility.
     */
    inputMap?: InputMap;

    /**
     * Transition to the next node(s).
     *   - `string`: unconditional transition to a single node.
     *   - `Record<string, string>`: decision map; keys are branch labels
     *     returned by the task, values are target node ids.
     *   - omitted: terminal node (workflow ends after this node).
     */
    next?: string | Record<string, string>;

    /**
     * Node to transition to if this node's task fails (returns `kind: "fail"`
     * or throws an exception). The error node receives engine-constructed
     * input: `{ message: string, data?: unknown, nodeId: string, taskName: string }`.
     */
    onError?: string;
}

/**
 * Workflow specification (the IR).
 *
 * This is the execution-time artifact. It is serialized as JSON and
 * designed to be machine-friendly. Authoring sugar belongs in a future
 * DSL that compiles to this format.
 */
export interface WorkflowSpec {
    /** IR format version. Engine uses this to select the right parser/validator. */
    specVersion: number;

    /** Workflow name. */
    name: string;

    /** Content version, author-managed. Informational; engine does not interpret it. */
    version: string;

    /** JSON Schema describing the workflow's input. */
    input: JSONSchema;

    /** JSON Schema describing the workflow's output. */
    output: JSONSchema;

    /** Named constants. Referenced in inputMap paths as `variables.<name>`. */
    variables?: Record<string, unknown>;

    /**
     * Maximum total node executions per run. Prevents runaway loops.
     * Default: 1000.
     */
    maxIterations?: number;

    /** Id of the first node to execute. Must be a key in `nodes`. */
    entry: string;

    /** The workflow graph. Keys are node ids. */
    nodes: Record<string, WorkflowNode>;
}
