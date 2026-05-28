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

// ---- Schema template type (JSON Schema extended with $typeParam markers) ----

/**
 * A reference to a type parameter, used as a placeholder in schema templates.
 * Resolved by `resolveTypeParams()` before runtime use.
 */
export interface TypeParamRef {
    $typeParam: string;
}

/** Type guard: narrows a SchemaTemplate node to a $typeParam reference. */
export function isTypeParamRef(
    schema: SchemaTemplate | null | undefined,
): schema is TypeParamRef {
    return (
        typeof schema === "object" &&
        schema !== null &&
        !Array.isArray(schema) &&
        "$typeParam" in schema &&
        typeof schema.$typeParam === "string"
    );
}

/**
 * A single schema node that may be either a concrete schema definition or a
 * type parameter reference. This is the recursive building block of
 * {@link SchemaTemplate}.
 *
 * Includes `JSONSchema` in the union so that plain JSON Schema values
 * are directly assignable without casts.
 */
export type SchemaTemplateNode =
    | SchemaTemplateDefinition
    | TypeParamRef
    | boolean
    | JSONSchema;

/**
 * JSON Schema extended to allow `{ "$typeParam": "T" }` markers at any
 * sub-schema position. Used for task schema declarations that have generic
 * type parameters.
 *
 * After resolution via `resolveTypeParams()`, the result is a plain
 * {@link JSONSchema} (no markers remain).
 *
 * Inherits all scalar fields from `JSONSchema7` and overrides only the
 * sub-schema-bearing fields to accept `SchemaTemplateNode`.
 */

/** Fields in JSONSchema7 that contain sub-schema references. */
type SchemaRefKeys =
    | "items"
    | "additionalItems"
    | "contains"
    | "properties"
    | "patternProperties"
    | "additionalProperties"
    | "dependencies"
    | "propertyNames"
    | "if"
    | "then"
    | "else"
    | "allOf"
    | "anyOf"
    | "oneOf"
    | "not"
    | "definitions";

export interface SchemaTemplateDefinition
    extends Omit<JSONSchema7, SchemaRefKeys> {
    // §6.4 - array
    items?: SchemaTemplateNode | SchemaTemplateNode[];
    additionalItems?: SchemaTemplateNode;
    contains?: SchemaTemplateNode;

    // §6.5 - object
    properties?: Record<string, SchemaTemplateNode>;
    patternProperties?: Record<string, SchemaTemplateNode>;
    additionalProperties?: SchemaTemplateNode;
    dependencies?: Record<string, SchemaTemplateNode | string[]>;
    propertyNames?: SchemaTemplateNode;

    // §6.6 - conditional
    if?: SchemaTemplateNode;
    then?: SchemaTemplateNode;
    else?: SchemaTemplateNode;

    // §6.7 - composition
    allOf?: SchemaTemplateNode[];
    anyOf?: SchemaTemplateNode[];
    oneOf?: SchemaTemplateNode[];
    not?: SchemaTemplateNode;

    // §9 - definitions (legacy)
    definitions?: Record<string, SchemaTemplateNode>;
}

/**
 * A JSON Schema that may contain `{ "$typeParam": "T" }` markers at any
 * nesting level. Used in task schema declarations for generic tasks.
 *
 * Assignable from plain JSON Schema objects (a `SchemaTemplateDefinition`
 * is a strict superset of valid `JSONSchema7` shapes minus `boolean`).
 */
export type SchemaTemplate = SchemaTemplateNode;

/**
 * Template: any JSON value the engine evaluates recursively.
 *
 * At runtime, objects with a `$from` key are references, objects with a
 * `$literal` key are literal escapes, and everything else evaluates
 * element-wise (arrays) or property-wise (plain objects).
 */

/** A `$from` reference resolved by the engine at runtime. */
export interface TemplateFromRef {
    $from: "input" | "constant" | "scope" | "state" | "recovery";
    name: string;
    path?: (string | number)[];
}

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type Template =
    | string
    | number
    | boolean
    | null
    | Template[]
    | TemplateFromRef
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
     * shape to `ForkBranch` (ir-v0.2 §2.1). Arms are full sub-scopes
     * — not bare node IDs — so a branch composes exactly like
     * fork/forkMap/loop body.
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
     * does not contribute to onError.
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
     * boolean-typed.
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

// ---- Workflow call (sub-workflow invocation) ----

/**
 * Reference to a workflow. Cross-file imports are resolved at compile time
 * by the fileLoader into the artifact bundle; all IR references therefore use
 * `source: "bundle"`.
 */
export interface WorkflowRef {
    /** Name of the referenced workflow (key in `WorkflowIR.workflows`). */
    name: string;
    /**
     * Resolution source. `"bundle"` means the referenced workflow lives in the
     * same artifact's `workflows` table. Omitted defaults to `"bundle"`.
     */
    source?: "bundle";
}

/**
 * A node that invokes another workflow as a sub-workflow.
 *
 * Note: the discriminant is `"workflowCall"`, not `"workflow"`, to avoid
 * confusion with the artifact-level `kind: "workflow"` discriminant.
 *
 * The `inputSchema` and `outputSchema` mirror the referenced workflow's body
 * and are authoritatively populated by the emitter; the validator verifies they
 * match the resolved body's schemas.
 */
export interface WorkflowCallNode {
    kind: "workflowCall";
    workflowRef: WorkflowRef;
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
    inputs: Record<string, Template>;
    next?: string;
    onError?: string;
    bind?: string;
    timeoutMs?: number;
}

export type WorkflowNode =
    | TaskNode
    | BranchNode
    | LoopNode
    | ForkNode
    | ForkMapNode
    | WorkflowCallNode;

// ---- Top-level IR ----

export interface ConstantDef {
    schema: JSONSchema;
    value: unknown;
}

/**
 * Body of a single workflow: structurally identical to a loop body / fork
 * branch scope, but used as a top-level entry in `WorkflowIR.workflows`.
 *
 * Currently aliased to `WorkflowScope`; kept as a distinct named type so the
 * workflows-table semantics are visible at the API surface.
 */
export type WorkflowBody = WorkflowScope;

/**
 * Top-level workflow artifact.
 *
 * Multiple workflows live in the `workflows` table keyed by name. The `entry`
 * field names the workflow that runs when this artifact is invoked at the top
 * level. Other workflows in the table are reachable via `WorkflowCallNode`
 * (the call graph is required to be acyclic).
 */
export interface WorkflowIR {
    kind: "workflow";
    version: string;
    description?: string;
    types?: Record<string, JSONSchema>;
    constants?: Record<string, ConstantDef>;
    /** Name of the entry workflow (must be a key in `workflows`). */
    entry: string;
    /** Workflow definitions, keyed by name. */
    workflows: Record<string, WorkflowBody>;
}
