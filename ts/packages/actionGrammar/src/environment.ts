// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
    | ActionExpression; // { actionName: "...", parameters: { ... } }

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
 * Evaluate a compiled value expression using the environment's slot values
 * The expression should have been compiled with compileValueExpression first,
 * so variable references have slotIndex instead of variableName.
 */
export function evaluateExpression(
    expr: ValueExpression,
    env: Environment,
): any {
    switch (expr.type) {
        case "variable": {
            // Use compiled slotIndex directly
            if (expr.slotIndex !== undefined) {
                return env.slots[expr.slotIndex];
            }
            // Fallback for uncompiled expressions (shouldn't happen in normal flow)
            throw new Error(
                `Variable ${expr.variableName} was not compiled to slot index`,
            );
        }

        case "literal":
            return expr.value;

        case "array":
            return expr.elements.map((elem) => evaluateExpression(elem, env));

        case "object": {
            const result: Record<string, any> = {};
            for (const [key, value] of expr.properties) {
                result[key] = evaluateExpression(value, env);
            }
            return result;
        }

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

        case "array":
            return {
                type: "array",
                elements: expr.elements.map((elem) =>
                    compileValueExpression(elem, slotMap, typeMap),
                ),
            };

        case "object": {
            const props = new Map<string, ValueExpression>();
            for (const [key, value] of expr.properties) {
                props.set(key, compileValueExpression(value, slotMap, typeMap));
            }
            return {
                type: "object",
                properties: props,
            };
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

        default:
            return expr;
    }
}

/**
 * Parse a value expression from the grammar's action value format.
 * The grammar parser produces ValueNode objects with the following structure:
 * - { type: "literal", value: ... }
 * - { type: "object", value: { [key: string]: ValueNode } }
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
        switch (value.type) {
            case "variable":
                // ValueNode format: { type: "variable", name: "varName" }
                return { type: "variable", variableName: value.name };

            case "literal":
                // ValueNode format: { type: "literal", value: ... }
                return { type: "literal", value: value.value };

            case "array":
                // ValueNode format: { type: "array", value: ValueNode[] }
                return {
                    type: "array",
                    elements: value.value.map(parseValueExpression),
                };

            case "object": {
                // ValueNode format: { type: "object", value: { [key: string]: ValueNode } }
                const objValue = value.value as Record<string, any>;

                // Check if it's an action object
                if (
                    "actionName" in objValue &&
                    objValue.actionName.type === "literal"
                ) {
                    const params = new Map<string, ValueExpression>();
                    const parametersNode = objValue.parameters;
                    if (
                        parametersNode &&
                        parametersNode.type === "object" &&
                        parametersNode.value
                    ) {
                        for (const [key, paramValue] of Object.entries(
                            parametersNode.value,
                        )) {
                            params.set(key, parseValueExpression(paramValue));
                        }
                    }
                    return {
                        type: "action",
                        actionName: objValue.actionName.value,
                        parameters: params,
                    };
                }

                // Generic object
                const props = new Map<string, ValueExpression>();
                for (const [key, propValue] of Object.entries(objValue)) {
                    props.set(key, parseValueExpression(propValue));
                }
                return {
                    type: "object",
                    properties: props,
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
            const params = new Map<string, ValueExpression>();
            if (value.parameters) {
                for (const [key, paramValue] of Object.entries(
                    value.parameters,
                )) {
                    params.set(key, parseValueExpression(paramValue));
                }
            }
            return {
                type: "action",
                actionName: value.actionName,
                parameters: params,
            };
        }

        // Generic object
        const props = new Map<string, ValueExpression>();
        for (const [key, propValue] of Object.entries(value)) {
            props.set(key, parseValueExpression(propValue));
        }
        return {
            type: "object",
            properties: props,
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
