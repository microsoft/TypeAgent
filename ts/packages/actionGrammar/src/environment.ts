// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { evaluateValueExpr } from "./grammarValueExprEvaluator.js";
import type {
    CompiledValueNode,
    CompiledValueExprNode,
} from "./grammarTypes.js";

/**
 * Environment-based Result Slots for NFA Matching
 *
 * This module provides data structures for tracking variable bindings during
 * NFA interpretation. Each NFA instantiation creates an environment with
 * slots for capturing variable values.
 *
 * Key concepts:
 * - ResultSlot: A slot that can hold a captured or computed value
 * - Environment: Array of slots with optional parent reference (for nested rules)
 * - SlotAssignment: Records which slot a transition should write to
 * - ValueExpression: Expression to evaluate at accept states
 */

/**
 * A slot in the environment that can hold a value
 * Values can be:
 * - string: captured text from wildcards
 * - number: parsed number from number wildcards
 * - object: computed value from nested rule evaluation (action objects, etc.)
 * - undefined: slot not yet filled
 */
export type SlotValue = string | number | object | undefined;

/**
 * Environment for a single NFA instantiation
 * Contains slots for all variables in the rule being matched
 */
export interface Environment {
    /**
     * Slots for variable values, indexed by slot number
     * Slots are allocated at compile time based on variable order in the rule
     */
    slots: SlotValue[];

    /**
     * Parent environment (for nested NFA instantiations)
     * When a nested rule completes, its result is written to a slot in the parent
     */
    parent?: Environment | undefined;

    /**
     * Slot index in parent environment where this instantiation's result should go
     * Only set when this environment is for a nested NFA instantiation
     */
    parentSlotIndex?: number | undefined;

    /**
     * SlotMap for this environment (variable name -> slot index)
     * Stored here so it can be restored when popping from nested environments
     */
    slotMap?: Map<string, number> | undefined;

    /**
     * ActionValue expression for this rule
     * Stored so it can be restored when popping from nested environments
     */
    actionValue?: any | undefined;
}

/**
 * Mapping from variable names to slot indices
 * Created at compile time for each rule
 */
export interface SlotMap {
    /**
     * Maps variable name to its slot index in the environment
     */
    variableToSlot: Map<string, number>;

    /**
     * Total number of slots needed for this rule
     */
    slotCount: number;
}

/**
 * Slot assignment info stored on transitions
 * Tells the interpreter which slot to write the captured value to
 */
export interface SlotAssignment {
    /**
     * Index of the slot to write to
     */
    slotIndex: number;

    /**
     * Whether to append to existing value (for multi-word wildcards)
     * If false, replaces any existing value
     */
    append: boolean;
}

/**
 * Value expression types that can appear in rules
 * These are evaluated at accept states using slot values
 */
export type ValueExpression =
    | VariableRef // $(varName) - reference to a slot
    | LiteralValue // literal string, number, boolean
    | ArrayExpression // [$(var1), $(var2), ...]
    | ObjectExpression // { key: value, ... }
    | ActionExpression // { actionName: "...", parameters: { ... } }
    | CompiledValueExprNode; // x+1, a?b:c, obj.prop, fn(), `t${x}`, ...spread

/**
 * Reference to a variable's slot value
 * At compile time, variableName is resolved to slotIndex
 */
export interface VariableRef {
    type: "variable";
    /** Variable name (used during parsing, before compilation) */
    variableName?: string | undefined;
    /** Slot index (set during compilation, used at runtime) */
    slotIndex?: number | undefined;
    /** Expected type (used for type conversion at evaluation time) */
    typeName?: string | undefined;
}

/**
 * Literal value (string, number, boolean)
 */
export interface LiteralValue {
    type: "literal";
    value: string | number | boolean;
}

/**
 * Array of expressions: [expr1, expr2, ...]
 */
export interface ArrayExpression {
    type: "array";
    elements: ValueExpression[];
}

/**
 * Object with expression values: { key: expr, ... }
 */
export interface ObjectExpression {
    type: "object";
    properties: Map<string, ValueExpression>;
}

/**
 * Action expression (the standard action format)
 * { actionName: "...", parameters: { ... } }
 */
export interface ActionExpression {
    type: "action";
    actionName: string;
    parameters: Map<string, ValueExpression>;
}

/**
 * Create a new environment with the specified number of slots
 */
export function createEnvironment(
    slotCount: number,
    parent?: Environment,
    parentSlotIndex?: number,
    slotMap?: Map<string, number>,
    actionValue?: any,
): Environment {
    return {
        slots: new Array(slotCount).fill(undefined),
        actionValue,
        parent,
        parentSlotIndex,
        slotMap,
    };
}

/**
 * Get a slot value from the environment
 */
export function getSlotValue(env: Environment, slotIndex: number): SlotValue {
    return env.slots[slotIndex];
}

/**
 * Set a slot value in the environment
 * If append is true and the slot already has a string value, concatenates with space
 */
export function setSlotValue(
    env: Environment,
    slotIndex: number,
    value: SlotValue,
    append: boolean = false,
): void {
    if (
        append &&
        typeof env.slots[slotIndex] === "string" &&
        typeof value === "string"
    ) {
        env.slots[slotIndex] = env.slots[slotIndex] + " " + value;
    } else {
        env.slots[slotIndex] = value;
    }
}

/**
 * Write a result to the parent environment's slot
 * Used when a nested NFA instantiation completes
 */
export function writeToParent(env: Environment, result: any): void {
    if (env.parent && env.parentSlotIndex !== undefined) {
        env.parent.slots[env.parentSlotIndex] = result;
    }
}

/**
 * Coerce a string slot value to number when the variable's typeName demands it.
 * Centralizes the rule that originally lived in dfaMatcher.evaluateActionValue.
 */
function coerceByTypeName(value: any, typeName: string | undefined): any {
    if (typeName === "number" && typeof value === "string") {
        const num = parseFloat(value);
        if (!isNaN(num)) {
            return num;
        }
    }
    return value;
}

/**
 * Evaluate one of the four base value-node shapes (literal, variable, object,
 * array) against the slot environment.  Handles BOTH the legacy ValueExpression
 * shape (VariableRef.variableName, ObjectExpression.properties: Map,
 * ArrayExpression.elements) AND the new CompiledValueNode shape
 * (CompiledVariableValueNode.name, CompiledObjectValueNode.value:
 * CompiledObjectElement[] with spreads, CompiledArrayValueNode.value with
 * spread elements).
 *
 * Used as the `evalBase` callback when delegating expression nodes to
 * `evaluateValueExpr`, and called directly by `evaluateExpression` for the
 * top-level base cases.
 */
function evaluateBaseAgainstSlots(node: any, env: Environment): any {
    switch (node.type) {
        case "literal":
            return node.value;

        case "variable": {
            if (node.slotIndex !== undefined) {
                return coerceByTypeName(
                    env.slots[node.slotIndex],
                    node.typeName,
                );
            }
            throw new Error(
                `Variable ${node.variableName ?? node.name} was not compiled to slot index`,
            );
        }

        case "array": {
            // Legacy: `elements`.  New: `value` with possible spreadElement entries.
            const items: any[] = node.elements ?? node.value;
            const out: any[] = [];
            for (const elem of items) {
                if (elem && elem.type === "spreadElement") {
                    const spread = evaluateExpression(elem.argument, env);
                    if (Array.isArray(spread)) {
                        out.push(...spread);
                    } else {
                        // Non-array spread: fall back to including the value
                        // directly.  Type-checker should have rejected this
                        // at compile time.
                        out.push(spread);
                    }
                } else {
                    out.push(evaluateExpression(elem, env));
                }
            }
            return out;
        }

        case "object": {
            // Legacy: `properties: Map<string, ValueExpression>`.
            // New: `value: CompiledObjectElement[]` with property + spread entries.
            const result: Record<string, any> = {};
            if (node.properties instanceof Map) {
                for (const [key, value] of node.properties) {
                    result[key] = evaluateExpression(value, env);
                }
                return result;
            }
            const elements: any[] = node.value ?? [];
            for (const elem of elements) {
                if (elem.type === "property") {
                    if (elem.value === null) {
                        // Shorthand `{ x }`: parser should have lowered this
                        // already, but be defensive.
                        result[elem.key] = env.slots[elem.slotIndex ?? -1];
                    } else {
                        result[elem.key] = evaluateExpression(elem.value, env);
                    }
                } else if (elem.type === "spread") {
                    const spread = evaluateExpression(elem.argument, env);
                    if (spread && typeof spread === "object") {
                        Object.assign(result, spread);
                    }
                }
            }
            return result;
        }
    }
    throw new Error(`Unknown base node type: ${node?.type}`);
}

/**
 * Evaluate a compiled value expression using the environment's slot values
 * The expression should have been compiled with compileValueExpression first,
 * so variable references have slotIndex instead of variableName.
 */
export function evaluateExpression(
    expr: ValueExpression | CompiledValueNode,
    env: Environment,
): any {
    switch (expr.type) {
        case "variable":
        case "literal":
        case "array":
        case "object":
            return evaluateBaseAgainstSlots(expr, env);

        case "action": {
            const params: Record<string, any> = {};
            for (const [key, value] of expr.parameters) {
                params[key] = evaluateExpression(value, env);
            }
            // Only include parameters if there are any (actions like pause/resume have none)
            if (Object.keys(params).length > 0) {
                return {
                    actionName: expr.actionName,
                    parameters: params,
                };
            }
            return {
                actionName: expr.actionName,
            };
        }

        // Expression nodes: delegate to the shared evaluator.
        case "binaryExpression":
        case "unaryExpression":
        case "conditionalExpression":
        case "memberExpression":
        case "callExpression":
        case "spreadElement":
        case "templateLiteral":
            return evaluateValueExpr(expr as CompiledValueNode, (base) =>
                evaluateBaseAgainstSlots(base, env),
            );

        default:
            throw new Error(`Unknown expression type: ${(expr as any).type}`);
    }
}

/**
 * Compile a value expression by resolving variable names to slot indices
 * This should be called at NFA compile time, not at runtime
 * @param expr The expression to compile
 * @param slotMap Maps variable names to slot indices
 * @param typeMap Optional map of variable names to their expected types (for type conversion)
 */
export function compileValueExpression(
    expr: ValueExpression,
    slotMap: Map<string, number>,
    typeMap?: Map<string, string>,
): ValueExpression {
    switch (expr.type) {
        case "variable": {
            if (expr.variableName === undefined) {
                return expr; // Already compiled or invalid
            }
            const slotIndex = slotMap.get(expr.variableName);
            if (slotIndex === undefined) {
                throw new Error(
                    `Cannot compile: unknown variable ${expr.variableName}`,
                );
            }
            const result: VariableRef = {
                type: "variable",
                variableName: expr.variableName, // Keep for debugging
                slotIndex,
            };
            // Add type information if available
            const typeName = typeMap?.get(expr.variableName);
            if (typeName) {
                result.typeName = typeName;
            }
            return result;
        }

        case "literal":
            return expr;

        case "array": {
            // Legacy shape: `elements`.  New-shape passthrough: `value`
            // (may contain spreadElement entries).
            if ((expr as any).elements !== undefined) {
                return {
                    type: "array",
                    elements: (expr as any).elements.map((elem: any) =>
                        compileValueExpression(elem, slotMap, typeMap),
                    ),
                };
            }
            return compileValueNode(expr, slotMap, typeMap);
        }

        case "object": {
            // Legacy shape: `properties: Map`.  New-shape passthrough: `value`
            // (CompiledObjectElement[] with possible spread entries).
            if (expr.properties instanceof Map) {
                const props = new Map<string, ValueExpression>();
                for (const [key, value] of expr.properties) {
                    props.set(
                        key,
                        compileValueExpression(value, slotMap, typeMap),
                    );
                }
                return {
                    type: "object",
                    properties: props,
                };
            }
            return compileValueNode(expr, slotMap, typeMap);
        }

        case "action": {
            const params = new Map<string, ValueExpression>();
            for (const [key, value] of expr.parameters) {
                params.set(
                    key,
                    compileValueExpression(value, slotMap, typeMap),
                );
            }
            return {
                type: "action",
                actionName: expr.actionName,
                parameters: params,
            };
        }

        // ── Expression nodes (CompiledValueNode subtypes) ─────────────────
        // Pass through with children compiled; annotate inner variable nodes
        // (which use `name`, not `variableName`) with slotIndex/typeName so
        // the shared evaluateValueExpr can resolve them via the evalBase
        // callback at runtime.
        case "binaryExpression":
            return {
                ...expr,
                left: compileValueNode(expr.left, slotMap, typeMap),
                right: compileValueNode(expr.right, slotMap, typeMap),
            };
        case "unaryExpression":
            return {
                ...expr,
                operand: compileValueNode(expr.operand, slotMap, typeMap),
            };
        case "conditionalExpression":
            return {
                ...expr,
                test: compileValueNode(expr.test, slotMap, typeMap),
                consequent: compileValueNode(expr.consequent, slotMap, typeMap),
                alternate: compileValueNode(expr.alternate, slotMap, typeMap),
            };
        case "memberExpression":
            return {
                ...expr,
                object: compileValueNode(expr.object, slotMap, typeMap),
                property:
                    typeof expr.property === "string"
                        ? expr.property
                        : compileValueNode(expr.property, slotMap, typeMap),
            };
        case "callExpression":
            return {
                ...expr,
                callee: compileValueNode(expr.callee, slotMap, typeMap),
                arguments: expr.arguments.map((a: any) =>
                    compileValueNode(a, slotMap, typeMap),
                ),
            };
        case "spreadElement":
            return {
                ...expr,
                argument: compileValueNode(expr.argument, slotMap, typeMap),
            };
        case "templateLiteral":
            return {
                ...expr,
                expressions: expr.expressions.map((e: any) =>
                    compileValueNode(e, slotMap, typeMap),
                ),
            };

        default:
            return expr;
    }
}

/**
 * Compile a CompiledValueNode (new-shape) by annotating variable references
 * with slotIndex/typeName and recursing into all child positions.  Used
 * when compiling expression-node subtrees, where children use the new
 * shape (`name`, `value`) rather than the legacy ValueExpression shape
 * (`variableName`, `elements`, `properties` Map).
 *
 * Returns a structurally equivalent node with `slotIndex` (and `typeName`,
 * if known) populated on each variable node.
 */
function compileValueNode(
    node: any,
    slotMap: Map<string, number>,
    typeMap?: Map<string, string>,
): any {
    if (node === null || typeof node !== "object" || !("type" in node)) {
        return node;
    }
    switch (node.type) {
        case "literal":
            return node;
        case "variable": {
            // CompiledValueNode shape uses `name`; legacy uses `variableName`.
            const varName: string | undefined = node.name ?? node.variableName;
            if (varName === undefined) {
                return node;
            }
            const slotIndex = slotMap.get(varName);
            if (slotIndex === undefined) {
                throw new Error(`Cannot compile: unknown variable ${varName}`);
            }
            const out: any = { ...node, slotIndex };
            const t = typeMap?.get(varName);
            if (t !== undefined) {
                out.typeName = t;
            }
            return out;
        }
        case "array": {
            // New shape: `value: CompiledValueNode[]`.  Legacy: `elements`.
            if (Array.isArray(node.elements)) {
                return {
                    ...node,
                    elements: node.elements.map((e: any) =>
                        compileValueNode(e, slotMap, typeMap),
                    ),
                };
            }
            return {
                ...node,
                value: (node.value ?? []).map((e: any) =>
                    compileValueNode(e, slotMap, typeMap),
                ),
            };
        }
        case "object": {
            // New shape: `value: CompiledObjectElement[]` (property/spread).
            // Legacy: `properties: Map<string, ValueExpression>`.
            if (node.properties instanceof Map) {
                const props = new Map<string, any>();
                for (const [k, v] of node.properties) {
                    props.set(k, compileValueNode(v, slotMap, typeMap));
                }
                return { ...node, properties: props };
            }
            return {
                ...node,
                value: (node.value ?? []).map((elem: any) => {
                    if (elem.type === "property") {
                        if (elem.value === null) {
                            // Shorthand `{ x }` → resolve to a variable ref
                            const slotIndex = slotMap.get(elem.key);
                            if (slotIndex === undefined) {
                                throw new Error(
                                    `Cannot compile shorthand: unknown variable ${elem.key}`,
                                );
                            }
                            const variableNode: any = {
                                type: "variable",
                                name: elem.key,
                                slotIndex,
                            };
                            const t = typeMap?.get(elem.key);
                            if (t !== undefined) {
                                variableNode.typeName = t;
                            }
                            return {
                                ...elem,
                                value: variableNode,
                            };
                        }
                        return {
                            ...elem,
                            value: compileValueNode(
                                elem.value,
                                slotMap,
                                typeMap,
                            ),
                        };
                    }
                    if (elem.type === "spread") {
                        return {
                            ...elem,
                            argument: compileValueNode(
                                elem.argument,
                                slotMap,
                                typeMap,
                            ),
                        };
                    }
                    return elem;
                }),
            };
        }
        // Expression nodes — recurse with the same helper.
        case "binaryExpression":
            return {
                ...node,
                left: compileValueNode(node.left, slotMap, typeMap),
                right: compileValueNode(node.right, slotMap, typeMap),
            };
        case "unaryExpression":
            return {
                ...node,
                operand: compileValueNode(node.operand, slotMap, typeMap),
            };
        case "conditionalExpression":
            return {
                ...node,
                test: compileValueNode(node.test, slotMap, typeMap),
                consequent: compileValueNode(node.consequent, slotMap, typeMap),
                alternate: compileValueNode(node.alternate, slotMap, typeMap),
            };
        case "memberExpression":
            return {
                ...node,
                object: compileValueNode(node.object, slotMap, typeMap),
                property:
                    typeof node.property === "string"
                        ? node.property
                        : compileValueNode(node.property, slotMap, typeMap),
            };
        case "callExpression":
            return {
                ...node,
                callee: compileValueNode(node.callee, slotMap, typeMap),
                arguments: node.arguments.map((a: any) =>
                    compileValueNode(a, slotMap, typeMap),
                ),
            };
        case "spreadElement":
            return {
                ...node,
                argument: compileValueNode(node.argument, slotMap, typeMap),
            };
        case "templateLiteral":
            return {
                ...node,
                expressions: node.expressions.map((e: any) =>
                    compileValueNode(e, slotMap, typeMap),
                ),
            };
        default:
            return node;
    }
}

/**
 * Helper function to parse object properties, handling shorthand syntax
 * Converts object entries to a Map of ValueExpression, where null values
 * are converted to variable references with the same name as the key
 */
function parseObjectProperties(
    entries: Record<string, any>,
): Map<string, ValueExpression> {
    const props = new Map<string, ValueExpression>();
    for (const [key, propValue] of Object.entries(entries)) {
        // Shorthand form: null means { key: key }
        if (propValue === null) {
            props.set(key, { type: "variable", variableName: key });
        } else {
            props.set(key, parseValueExpression(propValue));
        }
    }
    return props;
}

/**
 * Parse a value expression from the grammar's action value format.
 * The grammar parser produces ValueNode objects with the following structure:
 * - { type: "literal", value: ... }
 * - { type: "object", value: CompiledObjectElement[] }
 * - { type: "array", value: ValueNode[] }
 * - { type: "variable", name: string }
 *
 * This function converts ValueNode to ValueExpression for evaluation.
 */
export function parseValueExpression(value: any): ValueExpression {
    if (value === null || value === undefined) {
        return { type: "literal", value: "" };
    }

    // Check if it's already a typed ValueNode from the grammar parser
    if (typeof value === "object" && "type" in value) {
        // Expression-node passthrough.  These are CompiledValueExprNode
        // subtypes — pass them through unchanged.  Their children are also
        // CompiledValueNode shape; the compile/eval helpers handle that.
        if (
            value.type === "binaryExpression" ||
            value.type === "unaryExpression" ||
            value.type === "conditionalExpression" ||
            value.type === "memberExpression" ||
            value.type === "callExpression" ||
            value.type === "spreadElement" ||
            value.type === "templateLiteral"
        ) {
            return value as ValueExpression;
        }
        switch (value.type) {
            case "variable":
                // ValueNode format: { type: "variable", name: "varName" }
                return { type: "variable", variableName: value.name };

            case "literal":
                // ValueNode format: { type: "literal", value: ... }
                return { type: "literal", value: value.value };

            case "array":
                // ValueNode format: { type: "array", value: ValueNode[] }
                // If any element is a spreadElement, return new shape unchanged
                // (legacy ArrayExpression cannot carry spreads).
                if (
                    (value.value as any[]).some(
                        (e: any) => e?.type === "spreadElement",
                    )
                ) {
                    return value as ValueExpression;
                }
                return {
                    type: "array",
                    elements: value.value.map(parseValueExpression),
                };

            case "object": {
                // New format: { type: "object", value: CompiledObjectElement[] }
                const elements = value.value as any[];

                // If any element is a spread, return the new shape unchanged.
                // The legacy ObjectExpression shape (properties: Map) cannot
                // carry spreads; evaluateBaseAgainstSlots handles the new
                // shape directly.
                const hasSpread = elements.some(
                    (e: any) => e.type === "spread",
                );
                if (hasSpread) {
                    return value as ValueExpression;
                }

                // Helper to extract properties from elements array.
                const extractProps = (
                    elems: any[],
                ): Map<string, ValueExpression> => {
                    const props = new Map<string, ValueExpression>();
                    for (const elem of elems) {
                        if (elem.type === "property") {
                            if (elem.value === null) {
                                props.set(elem.key, {
                                    type: "variable",
                                    variableName: elem.key,
                                });
                            } else {
                                props.set(
                                    elem.key,
                                    parseValueExpression(elem.value),
                                );
                            }
                        }
                    }
                    return props;
                };

                // Check if it's an action object (has "actionName" property)
                const actionNameElem = elements.find(
                    (e: any) => e.type === "property" && e.key === "actionName",
                );
                if (
                    actionNameElem &&
                    actionNameElem.value?.type === "literal"
                ) {
                    const parametersElem = elements.find(
                        (e: any) =>
                            e.type === "property" && e.key === "parameters",
                    );
                    const params =
                        parametersElem?.value?.type === "object" &&
                        parametersElem.value.value
                            ? extractProps(parametersElem.value.value)
                            : new Map<string, ValueExpression>();

                    return {
                        type: "action",
                        actionName: actionNameElem.value.value,
                        parameters: params,
                    };
                }

                // Generic object
                return {
                    type: "object",
                    properties: extractProps(elements),
                };
            }
        }
    }

    // Fallback for plain JSON values (backwards compatibility)

    // Check if it's a variable reference string like "$(varName)"
    if (typeof value === "string") {
        const varMatch = value.match(/^\$\((\w+)\)$/);
        if (varMatch) {
            return { type: "variable", variableName: varMatch[1] };
        }
        return { type: "literal", value };
    }

    // Primitive types
    if (typeof value === "number" || typeof value === "boolean") {
        return { type: "literal", value };
    }

    // Arrays (plain JSON format)
    if (Array.isArray(value)) {
        return {
            type: "array",
            elements: value.map(parseValueExpression),
        };
    }

    // Objects (plain JSON format) - check if it's an action object
    if (typeof value === "object") {
        if ("actionName" in value && typeof value.actionName === "string") {
            const params = value.parameters
                ? parseObjectProperties(value.parameters)
                : new Map<string, ValueExpression>();

            return {
                type: "action",
                actionName: value.actionName,
                parameters: params,
            };
        }

        // Generic object
        return {
            type: "object",
            properties: parseObjectProperties(value),
        };
    }

    throw new Error(
        `Cannot parse value expression from: ${JSON.stringify(value)}`,
    );
}

/**
 * Create a slot map from a list of variable names
 * Variables are assigned slots in order
 */
export function createSlotMap(variableNames: string[]): SlotMap {
    const variableToSlot = new Map<string, number>();
    for (let i = 0; i < variableNames.length; i++) {
        variableToSlot.set(variableNames[i], i);
    }
    return {
        variableToSlot,
        slotCount: variableNames.length,
    };
}

/**
 * Clone an environment (shallow copy of slots)
 * Used during NFA interpretation to branch execution paths
 */
export function cloneEnvironment(env: Environment): Environment {
    return {
        slots: [...env.slots],
        parent: env.parent,
        parentSlotIndex: env.parentSlotIndex,
        slotMap: env.slotMap, // Preserve for debugging and restoration
        actionValue: env.actionValue, // Preserve for evaluation at accept
    };
}

/**
 * Deep clone an environment (clones entire parent chain and slot objects)
 * Used in writeToParent to ensure different execution paths don't share
 * any mutable state in the parent chain
 */
export function deepCloneEnvironment(env: Environment): Environment {
    // Deep clone slot values that are objects
    const clonedSlots = env.slots.map((slot) => {
        if (slot && typeof slot === "object") {
            // Deep clone objects to prevent shared mutations
            return JSON.parse(JSON.stringify(slot));
        }
        return slot;
    });

    // Recursively clone parent if it exists
    const clonedParent = env.parent
        ? deepCloneEnvironment(env.parent)
        : undefined;

    return {
        slots: clonedSlots,
        parent: clonedParent,
        parentSlotIndex: env.parentSlotIndex,
        slotMap: env.slotMap, // Keep reference (immutable)
        actionValue: env.actionValue, // Keep reference (immutable)
    };
}
