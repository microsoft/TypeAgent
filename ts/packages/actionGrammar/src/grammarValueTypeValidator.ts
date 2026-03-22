// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    CompiledValueNode,
    CompiledObjectValueNode,
    CompiledArrayValueNode,
    GrammarPart,
    GrammarRule,
} from "./grammarTypes.js";
import type {
    SchemaType,
    SchemaTypeDefinition,
    ActionParamObject as SchemaTypeObject,
    SchemaObjectField,
} from "@typeagent/action-schema";
import { SchemaCreator } from "@typeagent/action-schema";

// Sentinel for "any" — can't determine type
const ANY_TYPE: SchemaType = SchemaCreator.any();

/**
 * Sentinel for "error during type inference."
 * Distinct from ANY_TYPE by reference identity.  When a derive function
 * encounters a lookup failure (unknown variable, property, or method) it
 * pushes an error and returns ERROR_TYPE.  Compound nodes (ternary, ??, ||,
 * &&) propagate ERROR_TYPE so downstream operators skip validation and avoid
 * cascading error messages.
 */
const ERROR_TYPE: SchemaType = { type: "any" };

/**
 * A type-inference or operator-constraint error with a reference to the
 * specific sub-expression node that caused it.  The compiler converts these
 * to positioned `GrammarCompileError` via `valuePositions.get(error.node)`.
 */
export type ValueTypeError = {
    message: string;
    node: CompiledValueNode;
};

/**
 * Produce a human-readable label for a SchemaType.
 * Keeps union formatting terse (`string | number`).
 */
function formatSchemaType(t: SchemaType): string {
    switch (t.type) {
        case "type-union":
            return t.types.map(formatSchemaType).join(" | ");
        case "type-reference":
            return t.name;
        case "array":
            return `${formatSchemaType(t.elementType)}[]`;
        case "object":
            return "object";
        default:
            return t.type;
    }
}

/**
 * Collect supported method names for a given object type for error messages.
 */
function supportedMethodsForType(typeName: string): string[] {
    const methods: string[] = [];
    if (typeName === "string") {
        for (const s of [
            STRING_TO_STRING_METHODS,
            STRING_TO_NUMBER_METHODS,
            STRING_TO_BOOLEAN_METHODS,
            STRING_TO_ARRAY_METHODS,
        ]) {
            for (const m of s) methods.push(m);
        }
    } else if (typeName === "array") {
        for (const s of [
            ARRAY_TO_STRING_METHODS,
            ARRAY_TO_BOOLEAN_METHODS,
            ARRAY_TO_NUMBER_METHODS,
            ARRAY_TO_ARRAY_METHODS,
        ]) {
            for (const m of s) methods.push(m);
        }
    } else if (typeName === "number") {
        for (const m of NUMBER_TO_STRING_METHODS) methods.push(m);
    }
    return methods.sort();
}

/**
 * Check whether a type contains `undefined` (either is `undefined` directly,
 * or is a union with an `undefined` member).
 */
function containsUndefined(t: SchemaType): boolean {
    if (t.type === "undefined") return true;
    if (t.type === "type-union")
        return t.types.some((m) => containsUndefined(m));
    return false;
}

/**
 * Remove `undefined` from a type.  Returns the original type unchanged if
 * it doesn't contain `undefined`.  For a union, filters out `undefined`
 * members and simplifies (single remaining member → unwrap).
 */
function stripUndefined(t: SchemaType): SchemaType {
    if (t.type === "undefined") return ERROR_TYPE; // stripping leaves nothing
    if (t.type !== "type-union") return t;
    const remaining = t.types.filter((m) => m.type !== "undefined");
    if (remaining.length === 0) return ERROR_TYPE;
    if (remaining.length === 1) return remaining[0];
    return SchemaCreator.union(...remaining);
}

/** Value expression node types that are computed at runtime. */
const valueExprTypes = new Set([
    "binaryExpression",
    "unaryExpression",
    "conditionalExpression",
    "memberExpression",
    "callExpression",
    "spreadElement",
    "templateLiteral",
]);

function isValueExprNode(node: CompiledValueNode): boolean {
    return valueExprTypes.has(node.type);
}

// ── Method return type tables ─────────────────────────────────────────────────
// Used by deriveValueNodeType to infer return types for whitelisted method calls.

const STRING_TO_STRING_METHODS = new Set([
    "toLowerCase",
    "toUpperCase",
    "trim",
    "trimStart",
    "trimEnd",
    "slice",
    "substring",
    "repeat",
    "padStart",
    "padEnd",
    "replace",
    "replaceAll",
    "concat",
    "charAt",
    "at",
    "toString",
]);

const STRING_TO_NUMBER_METHODS = new Set([
    "indexOf",
    "lastIndexOf",
    "charCodeAt",
    "codePointAt",
    "search",
]);

const STRING_TO_BOOLEAN_METHODS = new Set([
    "includes",
    "startsWith",
    "endsWith",
]);

const ARRAY_TO_BOOLEAN_METHODS = new Set(["includes"]);

const ARRAY_TO_NUMBER_METHODS = new Set(["indexOf", "lastIndexOf"]);

/** Array methods that return an array of the same element type. */
const ARRAY_TO_ARRAY_METHODS = new Set([
    "slice",
    "reverse",
    "sort",
    "concat",
    "flat",
]);

/** String methods that return an array (special-cased for element type). */
const STRING_TO_ARRAY_METHODS = new Set(["split"]);

/** Array methods that return a string (special-cased). */
const ARRAY_TO_STRING_METHODS = new Set(["join"]);

/** Number methods that return a string. */
const NUMBER_TO_STRING_METHODS = new Set([
    "toFixed",
    "toString",
    "toPrecision",
    "toExponential",
]);

/**
 * All method return-type tables, exported so the runtime evaluator can derive
 * its safe-method whitelist from the same source of truth.
 */
export const METHOD_RETURN_TYPE_TABLES = {
    STRING_TO_STRING_METHODS,
    STRING_TO_NUMBER_METHODS,
    STRING_TO_BOOLEAN_METHODS,
    STRING_TO_ARRAY_METHODS,
    ARRAY_TO_BOOLEAN_METHODS,
    ARRAY_TO_NUMBER_METHODS,
    ARRAY_TO_ARRAY_METHODS,
    ARRAY_TO_STRING_METHODS,
    NUMBER_TO_STRING_METHODS,
} as const;

/** Counter for generating unique names for unnamed recursive rules. */
let ruleNameCounter = 0;

/**
 * Derives the output SchemaType of a compiled rule (GrammarRule[]).
 * Returns a SchemaType representing the rule's output, or the "any" sentinel
 * for rules whose type can't be determined.
 * Uses a cache to avoid recomputing for rules referenced by multiple parents.
 *
 * Recursive references are handled via type-references in a single pass:
 *   1. Seed the cache with an unresolved SchemaTypeReference before recursing.
 *   2. Derive the rule's type — recursive back-edges embed the ref.
 *   3. Classify the result:
 *      a. Ref not present → not recursive. Use the raw type.
 *      b. Ref appears only as a direct top-level union member → passthrough
 *         recursion (e.g. `<A> = string | <A>`). Strip the self-ref, yielding
 *         the base type.
 *      c. Ref appears nested inside objects/arrays → structural recursion
 *         (e.g. `<Tree> = string | { inner: <Tree> }`). Wrap in a
 *         SchemaTypeAliasDefinition to form a self-referential type graph.
 *
 * In all cases, ref.definition is set so that mutual recursion partners
 * that picked up our ref from the cache during derivation can resolve it.
 */
export function deriveRuleValueType(
    rules: GrammarRule[],
    cache: Map<GrammarRule[], SchemaType>,
    name?: string,
): SchemaType {
    const cached = cache.get(rules);
    if (cached !== undefined) {
        return cached;
    }

    // Create a type-reference as the provisional seed for this rule.
    // Any recursive back-references during derivation will embed this ref.
    const ruleName = name ?? `__rule_${ruleNameCounter++}`;
    const ref = SchemaCreator.ref(ruleName);
    cache.set(rules, ref);

    // Derive the rule's type in a single pass.
    const result = deriveRuleValueTypeOnce(rules, cache);

    if (result === ANY_TYPE || result === ref) {
        // Degenerate: all-ANY or pure self-reference (e.g. <A> = <A>).
        cache.set(rules, ANY_TYPE);
        return ANY_TYPE;
    }

    // Classify how the ref appears in the derived type.
    const refPos = findRefInType(result, ruleName);

    switch (refPos) {
        case "none":
            // Not recursive — use the raw result directly.
            // Set the ref's definition in case mutual recursion partners
            // picked up our ref from the cache during derivation.
            ref.definition = {
                alias: true as const,
                name: ruleName,
                type: result,
            };
            cache.set(rules, result);
            return result;

        case "top-union": {
            // Passthrough recursion (e.g. <A> = string | <A>).
            // Strip the self-referencing union members.
            const stripped = stripRefFromUnion(result, ruleName);
            // Set the ref's definition so external references (from mutual
            // recursion partners) resolve correctly through the ref.
            ref.definition = {
                alias: true as const,
                name: ruleName,
                type: stripped,
            };
            cache.set(rules, stripped);
            return stripped;
        }

        case "nested":
            // Structural recursion (e.g. <Tree> = string | { inner: <Tree> }).
            // Wrap in an alias and tie the knot.
            ref.definition = {
                alias: true as const,
                name: ruleName,
                type: result,
            };
            cache.set(rules, ref);
            return ref;
    }
}

/**
 * Single-pass derivation of a rule's output type.
 * ANY_TYPE alternatives are skipped (they contribute no type information).
 * Union results from rule references are flattened so that passthrough-
 * recursive refs surface as direct union members for findRefInType.
 */
function deriveRuleValueTypeOnce(
    rules: GrammarRule[],
    cache: Map<GrammarRule[], SchemaType>,
): SchemaType {
    const types: SchemaType[] = [];
    for (const rule of rules) {
        const altType = deriveAlternativeType(rule, cache);
        if (altType === ANY_TYPE || altType === ERROR_TYPE) {
            continue; // skip unknowable or error alternatives
        }
        // Flatten unions from nested rule references so passthrough-recursive
        // refs surface as direct union members for findRefInType.
        const alts = altType.type === "type-union" ? altType.types : [altType];
        for (const t of alts) {
            if (!types.some((existing) => schemaTypesEqual(existing, t))) {
                types.push(t);
            }
        }
    }

    if (types.length === 0) {
        return ANY_TYPE;
    } else if (types.length === 1) {
        return types[0];
    } else {
        return SchemaCreator.union(...types);
    }
}

/**
 * Checks whether a type-reference with the given name appears in a type,
 * and if so, whether it's a direct top-level union member or nested deeper.
 */
function findRefInType(
    type: SchemaType,
    refName: string,
): "none" | "top-union" | "nested" {
    if (type.type === "type-reference") {
        return type.name === refName ? "nested" : "none";
    }
    if (type.type === "type-union") {
        let foundAsDirectMember = false;
        for (const member of type.types) {
            if (member.type === "type-reference" && member.name === refName) {
                foundAsDirectMember = true;
            } else if (containsRef(member, refName)) {
                return "nested";
            }
        }
        return foundAsDirectMember ? "top-union" : "none";
    }
    return containsRef(type, refName) ? "nested" : "none";
}

/** Recursively checks whether a type contains a reference with the given name. */
function containsRef(type: SchemaType, refName: string): boolean {
    switch (type.type) {
        case "type-reference":
            return type.name === refName;
        case "type-union":
            return type.types.some((t) => containsRef(t, refName));
        case "array":
            return containsRef(type.elementType, refName);
        case "object":
            return Object.values(type.fields).some((f) =>
                containsRef(f.type, refName),
            );
        default:
            return false;
    }
}

/**
 * Removes type-reference members with the given name from a union type.
 * Returns a simplified type (single type if only one remains, union otherwise).
 */
function stripRefFromUnion(type: SchemaType, refName: string): SchemaType {
    if (type.type !== "type-union") return type;
    const remaining = type.types.filter(
        (t) => !(t.type === "type-reference" && t.name === refName),
    );
    if (remaining.length === 0) return ANY_TYPE;
    if (remaining.length === 1) return remaining[0];
    return SchemaCreator.union(...remaining);
}

function deriveAlternativeType(
    rule: GrammarRule,
    cache: Map<GrammarRule[], SchemaType>,
): SchemaType {
    if (rule.value !== undefined) {
        // Explicit value expression
        return deriveValueNodeType(rule.value, rule.parts, cache);
    }

    // Check for single-variable implicit (value IS the variable's capture)
    const variableParts = rule.parts.filter((p) => p.variable !== undefined);
    if (variableParts.length === 1) {
        return derivePartType(variableParts[0], cache);
    }

    // Single-part passthrough (bare rule ref, no variables)
    if (
        variableParts.length === 0 &&
        rule.parts.length === 1 &&
        rule.parts[0].type === "rules"
    ) {
        return deriveRuleValueType(
            rule.parts[0].rules,
            cache,
            rule.parts[0].name,
        );
    }

    // Multi-variable implicit: output is an object keyed by variable names
    if (variableParts.length > 1) {
        const fields: Record<string, SchemaObjectField> = {};
        for (const p of variableParts) {
            fields[p.variable!] = {
                type: derivePartType(p, cache),
                optional: p.optional || undefined,
            };
        }
        return SchemaCreator.obj(fields);
    }

    return ANY_TYPE;
}

function derivePartType(
    part: GrammarPart,
    cache: Map<GrammarRule[], SchemaType>,
): SchemaType {
    let baseType: SchemaType;
    switch (part.type) {
        case "wildcard":
            baseType = grammarTypeToSchemaType(part.typeName);
            break;
        case "number":
            baseType = SchemaCreator.number();
            break;
        case "rules":
            baseType = deriveRuleValueType(part.rules, cache, part.name);
            break;
        case "string":
        case "phraseSet":
            // These parts are literal text matchers without variables.
            // They can't capture values, so return string.
            baseType = SchemaCreator.string();
            break;
    }
    // Optional captures produce T | undefined at runtime
    if (part.optional) {
        return SchemaCreator.union(baseType, SchemaCreator.undefined_());
    }
    return baseType;
}

function deriveValueNodeType(
    value: CompiledValueNode,
    parts: GrammarPart[],
    cache: Map<GrammarRule[], SchemaType>,
    errors?: ValueTypeError[],
): SchemaType {
    switch (value.type) {
        case "literal":
            switch (typeof value.value) {
                case "string":
                    return SchemaCreator.string();
                case "number":
                    return SchemaCreator.number();
                case "boolean":
                    return SchemaCreator.boolean();
                default:
                    throw new Error(
                        `Unexpected literal typeof: ${typeof value.value}`,
                    );
            }
        case "variable": {
            // Look up the variable's type from the rule parts
            for (const part of parts) {
                if (part.variable === value.name) {
                    return derivePartType(part, cache);
                }
            }
            errors?.push({
                message: `Undefined variable '${value.name}'`,
                node: value,
            });
            return ERROR_TYPE;
        }
        case "object": {
            // Infer field types for the object
            const fields: Record<string, SchemaObjectField> = {};
            for (const [key, propValue] of Object.entries(value.value)) {
                const fieldValue =
                    propValue === null
                        ? ({ type: "variable", name: key } as CompiledValueNode)
                        : propValue;
                const fieldType = deriveValueNodeType(
                    fieldValue,
                    parts,
                    cache,
                    errors,
                );
                fields[key] = { type: fieldType };
            }
            return SchemaCreator.obj(fields);
        }
        case "array": {
            const arrNode = value;
            if (arrNode.value.length === 0) {
                return SchemaCreator.array(ANY_TYPE);
            }
            const elementTypes: SchemaType[] = [];
            for (const elem of arrNode.value) {
                const elemType = deriveValueNodeType(
                    elem,
                    parts,
                    cache,
                    errors,
                );
                if (elemType === ERROR_TYPE) {
                    return SchemaCreator.array(ERROR_TYPE);
                }
                if (!elementTypes.some((t) => schemaTypesEqual(t, elemType))) {
                    elementTypes.push(elemType);
                }
            }
            const unified =
                elementTypes.length === 1
                    ? elementTypes[0]
                    : SchemaCreator.union(...elementTypes);
            return SchemaCreator.array(unified);
        }

        // ── Value expression nodes ────────────────────────────────────────
        case "binaryExpression": {
            const leftType = deriveValueNodeType(
                value.left,
                parts,
                cache,
                errors,
            );
            const rightType = deriveValueNodeType(
                value.right,
                parts,
                cache,
                errors,
            );
            switch (value.operator) {
                case "===":
                case "!==":
                case "<":
                case ">":
                case "<=":
                case ">=":
                    return SchemaCreator.boolean();
                case "-":
                case "*":
                case "/":
                case "%":
                    return SchemaCreator.number();
                case "+":
                    if (
                        leftType.type === "string" ||
                        rightType.type === "string"
                    ) {
                        return SchemaCreator.string();
                    }
                    if (
                        leftType.type === "number" &&
                        rightType.type === "number"
                    ) {
                        return SchemaCreator.number();
                    }
                    return ERROR_TYPE;
                case "&&":
                case "||":
                    if (leftType === ERROR_TYPE || rightType === ERROR_TYPE)
                        return ERROR_TYPE;
                    return SchemaCreator.boolean();
                case "??": {
                    if (leftType === ERROR_TYPE || rightType === ERROR_TYPE)
                        return ERROR_TYPE;
                    const stripped = stripUndefined(leftType);
                    if (stripped === ERROR_TYPE) return rightType;
                    if (schemaTypesEqual(stripped, rightType)) return stripped;
                    return SchemaCreator.union(stripped, rightType);
                }
            }
            throw new Error(
                `Unhandled binary operator: ${(value as any).operator}`,
            );
        }
        case "unaryExpression":
            switch (value.operator) {
                case "-":
                    return SchemaCreator.number();
                case "!":
                    return SchemaCreator.boolean();
                case "typeof":
                    return SchemaCreator.string();
            }
            throw new Error(
                `Unhandled unary operator: ${(value as any).operator}`,
            );
        case "conditionalExpression": {
            const consequentType = deriveValueNodeType(
                value.consequent,
                parts,
                cache,
                errors,
            );
            const alternateType = deriveValueNodeType(
                value.alternate,
                parts,
                cache,
                errors,
            );
            if (consequentType === ERROR_TYPE || alternateType === ERROR_TYPE)
                return ERROR_TYPE;
            if (schemaTypesEqual(consequentType, alternateType))
                return consequentType;
            return SchemaCreator.union(consequentType, alternateType);
        }
        case "memberExpression": {
            let objectType = resolveType(
                deriveValueNodeType(value.object, parts, cache, errors),
            );
            if (objectType === ERROR_TYPE) return ERROR_TYPE;
            // Optional chaining: strip undefined before lookup, add back after
            const addUndefined =
                value.optional && containsUndefined(objectType);
            if (addUndefined) {
                objectType = resolveType(stripUndefined(objectType));
                if (objectType === ERROR_TYPE) return ERROR_TYPE;
            }
            let resultType: SchemaType | undefined;
            if (
                objectType.type === "object" &&
                !value.computed &&
                typeof value.property === "string"
            ) {
                const field = objectType.fields[value.property];
                if (field !== undefined) {
                    resultType = field.type;
                } else {
                    const available = Object.keys(objectType.fields).join(", ");
                    errors?.push({
                        message: `Property '${value.property}' does not exist on type '${formatSchemaType(objectType)}'. Available properties: ${available}.`,
                        node: value,
                    });
                    return ERROR_TYPE;
                }
            }
            if (
                resultType === undefined &&
                typeof value.property === "string"
            ) {
                if (
                    value.property === "length" &&
                    (objectType.type === "string" ||
                        objectType.type === "array")
                ) {
                    resultType = SchemaCreator.number();
                }
            }
            // Computed access with literal number on array → element type
            if (
                resultType === undefined &&
                value.computed &&
                objectType.type === "array" &&
                typeof value.property === "number"
            ) {
                resultType = objectType.elementType;
            }
            if (resultType !== undefined) {
                return addUndefined
                    ? SchemaCreator.union(
                          resultType,
                          SchemaCreator.undefined_(),
                      )
                    : resultType;
            }
            if (value.computed) {
                errors?.push({
                    message: `Computed access ([n]) is only supported on arrays. Use property access (.prop) for object properties.`,
                    node: value,
                });
            } else if (typeof value.property === "string") {
                const supported = supportedMethodsForType(objectType.type);
                errors?.push({
                    message: `Property '${value.property}' does not exist on type '${formatSchemaType(objectType)}'.${supported.length > 0 ? ` Available methods: ${supported.join(", ")}.` : ""}`,
                    node: value,
                });
            }
            return ERROR_TYPE;
        }
        case "callExpression": {
            if (
                value.callee.type !== "memberExpression" ||
                value.callee.computed
            ) {
                errors?.push({
                    message: `Free function calls are not supported. Use method syntax (value.method()) instead.`,
                    node: value,
                });
                return ERROR_TYPE;
            }
            if (typeof value.callee.property === "string") {
                const objectType = resolveType(
                    deriveValueNodeType(
                        value.callee.object,
                        parts,
                        cache,
                        errors,
                    ),
                );
                if (objectType === ERROR_TYPE) return ERROR_TYPE;
                const method = value.callee.property;
                if (objectType.type === "string") {
                    if (STRING_TO_STRING_METHODS.has(method))
                        return SchemaCreator.string();
                    if (STRING_TO_NUMBER_METHODS.has(method))
                        return SchemaCreator.number();
                    if (STRING_TO_BOOLEAN_METHODS.has(method))
                        return SchemaCreator.boolean();
                    if (STRING_TO_ARRAY_METHODS.has(method))
                        return SchemaCreator.array(SchemaCreator.string());
                }
                if (objectType.type === "array") {
                    if (ARRAY_TO_STRING_METHODS.has(method))
                        return SchemaCreator.string();
                    if (ARRAY_TO_BOOLEAN_METHODS.has(method))
                        return SchemaCreator.boolean();
                    if (ARRAY_TO_NUMBER_METHODS.has(method))
                        return SchemaCreator.number();
                    if (ARRAY_TO_ARRAY_METHODS.has(method))
                        return SchemaCreator.array(objectType.elementType);
                }
                if (objectType.type === "number") {
                    if (NUMBER_TO_STRING_METHODS.has(method))
                        return SchemaCreator.string();
                }
                const supported = supportedMethodsForType(objectType.type);
                errors?.push({
                    message: `Method '${method}' is not supported on type '${formatSchemaType(objectType)}'.${supported.length > 0 ? ` Supported methods: ${supported.join(", ")}.` : ""}`,
                    node: value,
                });
                return ERROR_TYPE;
            }
            return ERROR_TYPE;
        }
        case "spreadElement":
            return deriveValueNodeType(value.argument, parts, cache, errors);
        case "templateLiteral":
            return SchemaCreator.string();
    }
}

/** Convert a grammar type name to a SchemaType */
function grammarTypeToSchemaType(grammarType: string): SchemaType {
    switch (grammarType) {
        case "string":
        case "wildcard":
        case "word":
            return SchemaCreator.string();
        case "number":
        // TODO: look up entity return types from the entity registry instead of hard-coding
        case "Cardinal":
        case "Ordinal":
            return SchemaCreator.number();
        default:
            // Custom entity types (e.g. "email", "date") capture text
            return SchemaCreator.string();
    }
}

/**
 * Derives the output type of an expression node using the variable type map.
 * This is a simplified version of deriveValueNodeType that works with
 * the pre-built variableTypes map (used during validation) rather than
 * raw parts and cache (used during compilation).
 */
function deriveExprValueType(
    value: CompiledValueNode,
    variableTypes: Map<string, SchemaType>,
    errors?: ValueTypeError[],
): SchemaType {
    switch (value.type) {
        case "literal":
            switch (typeof value.value) {
                case "string":
                    return SchemaCreator.string();
                case "number":
                    return SchemaCreator.number();
                case "boolean":
                    return SchemaCreator.boolean();
                default:
                    throw new Error(
                        `Unexpected literal typeof: ${typeof value.value}`,
                    );
            }
        case "variable": {
            const t = variableTypes.get(value.name);
            if (t !== undefined) return t;
            errors?.push({
                message: `Undefined variable '${value.name}'`,
                node: value,
            });
            return ERROR_TYPE;
        }

        case "binaryExpression": {
            const leftType = deriveExprValueType(
                value.left,
                variableTypes,
                errors,
            );
            const rightType = deriveExprValueType(
                value.right,
                variableTypes,
                errors,
            );
            switch (value.operator) {
                case "===":
                case "!==":
                case "<":
                case ">":
                case "<=":
                case ">=":
                    return SchemaCreator.boolean();
                case "-":
                case "*":
                case "/":
                case "%":
                    return SchemaCreator.number();
                case "+":
                    if (
                        leftType.type === "string" ||
                        rightType.type === "string"
                    )
                        return SchemaCreator.string();
                    if (
                        leftType.type === "number" &&
                        rightType.type === "number"
                    )
                        return SchemaCreator.number();
                    return ERROR_TYPE;
                case "&&":
                case "||":
                    if (leftType === ERROR_TYPE || rightType === ERROR_TYPE)
                        return ERROR_TYPE;
                    return SchemaCreator.boolean();
                case "??": {
                    if (leftType === ERROR_TYPE || rightType === ERROR_TYPE)
                        return ERROR_TYPE;
                    const stripped = stripUndefined(leftType);
                    if (stripped === ERROR_TYPE) return rightType;
                    if (schemaTypesEqual(stripped, rightType)) return stripped;
                    return SchemaCreator.union(stripped, rightType);
                }
            }
            throw new Error(
                `Unhandled binary operator: ${(value as any).operator}`,
            );
        }
        case "unaryExpression":
            switch (value.operator) {
                case "-":
                    return SchemaCreator.number();
                case "!":
                    return SchemaCreator.boolean();
                case "typeof":
                    return SchemaCreator.string();
            }
            throw new Error(
                `Unhandled unary operator: ${(value as any).operator}`,
            );
        case "conditionalExpression": {
            const consequentType = deriveExprValueType(
                value.consequent,
                variableTypes,
                errors,
            );
            const alternateType = deriveExprValueType(
                value.alternate,
                variableTypes,
                errors,
            );
            if (consequentType === ERROR_TYPE || alternateType === ERROR_TYPE)
                return ERROR_TYPE;
            if (schemaTypesEqual(consequentType, alternateType))
                return consequentType;
            return SchemaCreator.union(consequentType, alternateType);
        }
        case "memberExpression": {
            let objectType = resolveType(
                deriveExprValueType(value.object, variableTypes, errors),
            );
            if (objectType === ERROR_TYPE) return ERROR_TYPE;
            // Optional chaining: strip undefined before lookup, add back after
            const addUndefined =
                value.optional && containsUndefined(objectType);
            if (addUndefined) {
                objectType = resolveType(stripUndefined(objectType));
                if (objectType === ERROR_TYPE) return ERROR_TYPE;
            }
            let resultType: SchemaType | undefined;
            if (
                objectType.type === "object" &&
                !value.computed &&
                typeof value.property === "string"
            ) {
                const field = objectType.fields[value.property];
                if (field !== undefined) {
                    resultType = field.type;
                } else {
                    const available = Object.keys(objectType.fields).join(", ");
                    errors?.push({
                        message: `Property '${value.property}' does not exist on type '${formatSchemaType(objectType)}'. Available properties: ${available}.`,
                        node: value,
                    });
                    return ERROR_TYPE;
                }
            }
            if (
                resultType === undefined &&
                typeof value.property === "string"
            ) {
                if (
                    value.property === "length" &&
                    (objectType.type === "string" ||
                        objectType.type === "array")
                ) {
                    resultType = SchemaCreator.number();
                }
            }
            // Computed access with literal number on array → element type
            if (
                resultType === undefined &&
                value.computed &&
                objectType.type === "array" &&
                typeof value.property === "number"
            ) {
                resultType = objectType.elementType;
            }
            if (resultType !== undefined) {
                return addUndefined
                    ? SchemaCreator.union(
                          resultType,
                          SchemaCreator.undefined_(),
                      )
                    : resultType;
            }
            if (value.computed) {
                errors?.push({
                    message: `Computed access ([n]) is only supported on arrays. Use property access (.prop) for object properties.`,
                    node: value,
                });
            } else if (typeof value.property === "string") {
                const supported = supportedMethodsForType(objectType.type);
                errors?.push({
                    message: `Property '${value.property}' does not exist on type '${formatSchemaType(objectType)}'.${supported.length > 0 ? ` Available methods: ${supported.join(", ")}.` : ""}`,
                    node: value,
                });
            }
            return ERROR_TYPE;
        }
        case "callExpression": {
            if (
                value.callee.type !== "memberExpression" ||
                value.callee.computed
            ) {
                errors?.push({
                    message: `Free function calls are not supported. Use method syntax (value.method()) instead.`,
                    node: value,
                });
                return ERROR_TYPE;
            }
            if (typeof value.callee.property === "string") {
                const objectType = resolveType(
                    deriveExprValueType(
                        value.callee.object,
                        variableTypes,
                        errors,
                    ),
                );
                if (objectType === ERROR_TYPE) return ERROR_TYPE;
                const method = value.callee.property;
                if (objectType.type === "string") {
                    if (STRING_TO_STRING_METHODS.has(method))
                        return SchemaCreator.string();
                    if (STRING_TO_NUMBER_METHODS.has(method))
                        return SchemaCreator.number();
                    if (STRING_TO_BOOLEAN_METHODS.has(method))
                        return SchemaCreator.boolean();
                    if (STRING_TO_ARRAY_METHODS.has(method))
                        return SchemaCreator.array(SchemaCreator.string());
                }
                if (objectType.type === "array") {
                    if (ARRAY_TO_STRING_METHODS.has(method))
                        return SchemaCreator.string();
                    if (ARRAY_TO_BOOLEAN_METHODS.has(method))
                        return SchemaCreator.boolean();
                    if (ARRAY_TO_NUMBER_METHODS.has(method))
                        return SchemaCreator.number();
                    if (ARRAY_TO_ARRAY_METHODS.has(method))
                        return SchemaCreator.array(objectType.elementType);
                }
                if (objectType.type === "number") {
                    if (NUMBER_TO_STRING_METHODS.has(method))
                        return SchemaCreator.string();
                }
                const supported = supportedMethodsForType(objectType.type);
                errors?.push({
                    message: `Method '${method}' is not supported on type '${formatSchemaType(objectType)}'.${supported.length > 0 ? ` Supported methods: ${supported.join(", ")}.` : ""}`,
                    node: value,
                });
                return ERROR_TYPE;
            }
            return ERROR_TYPE;
        }
        case "spreadElement":
            return deriveExprValueType(value.argument, variableTypes, errors);
        case "templateLiteral":
            return SchemaCreator.string();
        case "object": {
            const fields: Record<string, SchemaObjectField> = {};
            for (const [key, propValue] of Object.entries(value.value)) {
                const fieldValue =
                    propValue === null
                        ? ({ type: "variable", name: key } as CompiledValueNode)
                        : propValue;
                const fieldType = deriveExprValueType(
                    fieldValue,
                    variableTypes,
                    errors,
                );
                fields[key] = { type: fieldType };
            }
            return SchemaCreator.obj(fields);
        }
        case "array": {
            const arrNode = value as CompiledArrayValueNode;
            if (arrNode.value.length === 0) {
                return SchemaCreator.array(ANY_TYPE);
            }
            const elementTypes: SchemaType[] = [];
            for (const elem of arrNode.value) {
                const elemType = deriveExprValueType(
                    elem,
                    variableTypes,
                    errors,
                );
                if (elemType === ERROR_TYPE) {
                    return SchemaCreator.array(ERROR_TYPE);
                }
                if (!elementTypes.some((t) => schemaTypesEqual(t, elemType))) {
                    elementTypes.push(elemType);
                }
            }
            const unified =
                elementTypes.length === 1
                    ? elementTypes[0]
                    : SchemaCreator.union(...elementTypes);
            return SchemaCreator.array(unified);
        }
    }
}

/**
 * Checks if an inferred type is assignable to an expected type.
 * Uses coinductive reasoning for recursive types: if a type-reference is
 * encountered a second time during the walk, we assume it is assignable
 * (the concrete, non-self-referencing members determine the real answer).
 *
 * This makes validation independent of whether a rule's type was resolved
 * via fixed-point iteration (producing a plain type like `string`) or via
 * the type-reference approach (producing `A = string | A`).  Both
 * representations validate identically.
 */
function isTypeAssignable(
    inferred: SchemaType,
    expected: SchemaType,
    visited?: Set<string>,
): boolean {
    if (expected.type === "any" || inferred.type === "any") return true;
    // Coinductive cycle detection for recursive type-references.
    // If we've already started checking this ref, assume assignable —
    // the concrete (non-self-referencing) union members determine the
    // real answer.
    if (inferred.type === "type-reference") {
        if (visited === undefined) visited = new Set<string>();
        if (visited.has(inferred.name)) return true;
        visited.add(inferred.name);
    }
    const resolvedInferred = resolveType(inferred);
    const resolvedExpected = resolveType(expected);
    if (resolvedExpected.type === "any" || resolvedInferred.type === "any")
        return true;
    if (resolvedExpected.type === resolvedInferred.type) return true;
    // string is assignable to string-union (runtime value might match)
    if (
        resolvedExpected.type === "string-union" &&
        resolvedInferred.type === "string"
    )
        return true;
    // string-union is assignable to string (every enum value is a string)
    if (
        resolvedExpected.type === "string" &&
        resolvedInferred.type === "string-union"
    )
        return true;
    // boolean is assignable to true/false literal types
    if (
        (resolvedExpected.type === "true" ||
            resolvedExpected.type === "false") &&
        resolvedInferred.type === "boolean"
    )
        return true;
    // true/false literal types are assignable to boolean
    if (
        resolvedExpected.type === "boolean" &&
        (resolvedInferred.type === "true" || resolvedInferred.type === "false")
    )
        return true;
    // If expected is a union, inferred must match SOME member
    if (resolvedExpected.type === "type-union") {
        return resolvedExpected.types.some((t) =>
            isTypeAssignable(resolvedInferred, t, visited),
        );
    }
    // If inferred is a union, ALL members must be assignable to expected.
    // Pass the original `expected` (not resolved) so union checks on the
    // expected side still fire for each member.
    if (resolvedInferred.type === "type-union") {
        return resolvedInferred.types.every((t) =>
            isTypeAssignable(t, expected, visited),
        );
    }
    return false;
}

/**
 * Structural equality check for SchemaType values.
 * Handles primitives, string unions, arrays, objects, and type references.
 * Uses coinductive equality for recursive types: if we encounter a pair of
 * type-references we're already comparing, we assume they're equal
 * (standard coinductive approach, same as TypeScript's type checker).
 */
function schemaTypesEqual(
    a: SchemaType,
    b: SchemaType,
    visited?: Set<string>,
): boolean {
    if (a === b) return true;
    if (a.type !== b.type) return false;
    switch (a.type) {
        case "string":
        case "number":
        case "boolean":
        case "any":
        case "undefined":
        case "true":
        case "false":
            return true;
        case "string-union": {
            const bEnum = (b as typeof a).typeEnum;
            return (
                a.typeEnum.length === bEnum.length &&
                a.typeEnum.every((v) => bEnum.includes(v))
            );
        }
        case "type-reference": {
            const bRef = b as typeof a;
            if (a.definition !== undefined && bRef.definition !== undefined) {
                // Coinductive cycle check: if we've already assumed this
                // pair is equal, return true to break the cycle.
                const key = a.name + "==" + bRef.name;
                if (visited === undefined) {
                    visited = new Set<string>();
                }
                if (visited.has(key)) return true;
                visited.add(key);
                return schemaTypesEqual(
                    a.definition.type,
                    bRef.definition.type,
                    visited,
                );
            }
            // Fall back to name comparison when definitions aren't resolved
            return a.name === bRef.name;
        }
        case "array":
            return schemaTypesEqual(
                a.elementType,
                (b as typeof a).elementType,
                visited,
            );
        case "object": {
            const aKeys = Object.keys(a.fields);
            const bFields = (b as typeof a).fields;
            const bKeys = Object.keys(bFields);
            if (aKeys.length !== bKeys.length) return false;
            return aKeys.every((key) => {
                const bf = bFields[key];
                if (bf === undefined) return false;
                const af = a.fields[key];
                return (
                    !!af.optional === !!bf.optional &&
                    schemaTypesEqual(af.type, bf.type, visited)
                );
            });
        }
        case "type-union": {
            const bTypes = (b as typeof a).types;
            return (
                a.types.length === bTypes.length &&
                a.types.every((t) =>
                    bTypes.some((bt) => schemaTypesEqual(t, bt, visited)),
                )
            );
        }
        default:
            return false;
    }
}

/**
 * Builds a map from variable name to its inferred SchemaType from the grammar
 * rule parts. For primitive captures (wildcard, number), returns simple schema
 * For rule-reference variables, derives the output type of the referenced
 * rule recursively.
 */
export function buildVariableTypeMap(
    parts: GrammarPart[],
    derivedTypes: Map<GrammarRule[], SchemaType>,
): Map<string, SchemaType> {
    const map = new Map<string, SchemaType>();
    for (const part of parts) {
        if (part.variable) {
            map.set(part.variable, derivePartType(part, derivedTypes));
        }
    }
    return map;
}

/**
 * Resolves a SchemaType, following type-references to their definition.
 * Uses iterative unwrapping with cycle detection for recursive types.
 */
function resolveType(type: SchemaType): SchemaType {
    const seen = new Set<string>();
    while (type.type === "type-reference" && type.definition !== undefined) {
        if (seen.has(type.name)) {
            // Cycle detected — the type-reference itself is the resolved form
            return type;
        }
        seen.add(type.name);
        type = type.definition.type;
    }
    return type;
}

// ── Operator constraint set ───────────────────────────────────────────────────
// Operators that accept undefined-containing operands without error.
const NULLABLE_OPERATORS = new Set<string>(["??", "===", "!==", "typeof"]);

/**
 * Walk an expression tree and check that each operator's operands satisfy the
 * type restrictions in the Expression Type Restriction Table.
 *
 * Returns errors (fatal constraint violations) and populates an optional
 * `warnings` array (non-fatal, e.g. unnecessary `??` or `?.`).
 *
 * Check ordering per node:
 *   1. If operand is ERROR_TYPE → skip (prevents cascading)
 *   2. If operand contains undefined and operator is not nullable → error
 *   3. Otherwise → check operator-specific type constraint
 */
function validateExprOperandTypes(
    value: CompiledValueNode,
    variableTypes: Map<string, SchemaType>,
    warnings?: ValueTypeError[],
): ValueTypeError[] {
    const errors: ValueTypeError[] = [];
    walkExprOperands(value, variableTypes, errors, warnings);
    return errors;
}

function walkExprOperands(
    value: CompiledValueNode,
    variableTypes: Map<string, SchemaType>,
    errors: ValueTypeError[],
    warnings: ValueTypeError[] | undefined,
): void {
    switch (value.type) {
        case "binaryExpression": {
            // Recurse into operands first
            walkExprOperands(value.left, variableTypes, errors, warnings);
            walkExprOperands(value.right, variableTypes, errors, warnings);

            const leftType = deriveExprValueType(value.left, variableTypes);
            const rightType = deriveExprValueType(value.right, variableTypes);

            // 1. ERROR_TYPE → skip
            if (leftType === ERROR_TYPE || rightType === ERROR_TYPE) return;

            // 2. undefined check for non-nullable operators
            if (!NULLABLE_OPERATORS.has(value.operator)) {
                if (containsUndefined(leftType)) {
                    errors.push({
                        message: `Operand type '${formatSchemaType(leftType)}' includes undefined. Use ?? to provide a default value, or ?. for property access.`,
                        node: value.left,
                    });
                    return;
                }
                if (containsUndefined(rightType)) {
                    errors.push({
                        message: `Operand type '${formatSchemaType(rightType)}' includes undefined. Use ?? to provide a default value, or ?. for property access.`,
                        node: value.right,
                    });
                    return;
                }
            }

            // 3. Operator-specific constraints
            switch (value.operator) {
                case "+":
                    if (
                        !(
                            (leftType.type === "string" &&
                                rightType.type === "string") ||
                            (leftType.type === "number" &&
                                rightType.type === "number")
                        )
                    ) {
                        errors.push({
                            message: `Operator '+' requires both operands to be number or both to be string. Got '${formatSchemaType(leftType)}' and '${formatSchemaType(rightType)}'. Use a template literal for string interpolation.`,
                            node: value,
                        });
                    }
                    break;
                case "-":
                case "*":
                case "/":
                case "%":
                    if (
                        leftType.type !== "number" ||
                        rightType.type !== "number"
                    ) {
                        errors.push({
                            message: `Operator '${value.operator}' requires both operands to be number. Got '${formatSchemaType(leftType)}' and '${formatSchemaType(rightType)}'.`,
                            node: value,
                        });
                    }
                    break;
                case "<":
                case ">":
                case "<=":
                case ">=":
                    if (
                        !(
                            (leftType.type === "number" &&
                                rightType.type === "number") ||
                            (leftType.type === "string" &&
                                rightType.type === "string")
                        )
                    ) {
                        errors.push({
                            message: `Operator '${value.operator}' requires both operands to be the same type (both number or both string). Got '${formatSchemaType(leftType)}' and '${formatSchemaType(rightType)}'.`,
                            node: value,
                        });
                    }
                    break;
                case "&&":
                case "||":
                    if (
                        leftType.type !== "boolean" ||
                        rightType.type !== "boolean"
                    ) {
                        errors.push({
                            message: `Operator '${value.operator}' requires boolean operands. Got '${formatSchemaType(leftType)}' and '${formatSchemaType(rightType)}'. Use ternary (e.g., x > 0 ? a : b) for conditional values.`,
                            node: value,
                        });
                    }
                    break;
                case "??":
                    // Warning: unnecessary ?? if left does not contain undefined
                    if (!containsUndefined(leftType)) {
                        warnings?.push({
                            message: `Operator '??' is unnecessary — left operand '${formatSchemaType(leftType)}' is never undefined.`,
                            node: value,
                        });
                    }
                    break;
                // ===, !== have no constraint
            }
            break;
        }
        case "unaryExpression": {
            walkExprOperands(value.operand, variableTypes, errors, warnings);
            const operandType = deriveExprValueType(
                value.operand,
                variableTypes,
            );
            if (operandType === ERROR_TYPE) return;
            if (
                !NULLABLE_OPERATORS.has(value.operator) &&
                containsUndefined(operandType)
            ) {
                errors.push({
                    message: `Operand type '${formatSchemaType(operandType)}' includes undefined. Use ?? to provide a default value.`,
                    node: value.operand,
                });
                return;
            }
            switch (value.operator) {
                case "-":
                    if (operandType.type !== "number") {
                        errors.push({
                            message: `Unary '-' requires a number operand. Got '${formatSchemaType(operandType)}'.`,
                            node: value,
                        });
                    }
                    break;
                case "!":
                    if (operandType.type !== "boolean") {
                        errors.push({
                            message: `Operator '!' requires a boolean operand. Got '${formatSchemaType(operandType)}'. Use === or !== for equality checks.`,
                            node: value,
                        });
                    }
                    break;
                // typeof has no constraint
            }
            break;
        }
        case "conditionalExpression": {
            walkExprOperands(value.test, variableTypes, errors, warnings);
            walkExprOperands(value.consequent, variableTypes, errors, warnings);
            walkExprOperands(value.alternate, variableTypes, errors, warnings);
            const testType = deriveExprValueType(value.test, variableTypes);
            if (testType === ERROR_TYPE) return;
            if (testType.type !== "boolean") {
                errors.push({
                    message: `Ternary '?' test must be a boolean expression. Got '${formatSchemaType(testType)}'. Use a comparison (e.g., x > 0) or equality check (e.g., x !== undefined).`,
                    node: value.test,
                });
            }
            break;
        }
        case "memberExpression": {
            if (typeof value.object === "object") {
                walkExprOperands(value.object, variableTypes, errors, warnings);
            }
            if (typeof value.property === "object" && value.property !== null) {
                walkExprOperands(
                    value.property,
                    variableTypes,
                    errors,
                    warnings,
                );
            }
            // Warning: unnecessary ?. if object type does not contain undefined
            if (value.optional) {
                const objectType = deriveExprValueType(
                    value.object,
                    variableTypes,
                );
                if (
                    objectType !== ERROR_TYPE &&
                    !containsUndefined(objectType)
                ) {
                    warnings?.push({
                        message: `Optional chaining '?.' is unnecessary — operand '${formatSchemaType(objectType)}' is never undefined. Use '.' instead.`,
                        node: value,
                    });
                }
            }
            break;
        }
        case "callExpression": {
            walkExprOperands(value.callee, variableTypes, errors, warnings);
            for (const arg of value.arguments) {
                walkExprOperands(arg, variableTypes, errors, warnings);
            }
            break;
        }
        case "templateLiteral": {
            for (const expr of value.expressions) {
                walkExprOperands(expr, variableTypes, errors, warnings);
                const exprType = deriveExprValueType(expr, variableTypes);
                if (exprType === ERROR_TYPE) continue;
                // Check that all types in the expression are interpolatable
                const types =
                    exprType.type === "type-union"
                        ? exprType.types
                        : [exprType];
                for (const t of types) {
                    if (
                        t.type !== "string" &&
                        t.type !== "number" &&
                        t.type !== "boolean"
                    ) {
                        errors.push({
                            message: `Template interpolation does not accept '${formatSchemaType(exprType)}'. Use ?? to provide a default first.`,
                            node: expr,
                        });
                        break;
                    }
                }
            }
            break;
        }
        case "spreadElement":
            walkExprOperands(value.argument, variableTypes, errors, warnings);
            break;
        case "object":
            for (const propValue of Object.values(value.value)) {
                if (propValue !== null) {
                    walkExprOperands(
                        propValue,
                        variableTypes,
                        errors,
                        warnings,
                    );
                }
            }
            break;
        case "array":
            for (const elem of (value as CompiledArrayValueNode).value) {
                walkExprOperands(elem, variableTypes, errors, warnings);
            }
            break;
        // literal, variable: no sub-expressions to check
    }
}

/**
 * Validates a CompiledValueNode against a SchemaType at compile time.
 * Returns an array of error messages (empty if valid).
 *
 * @param value - The compiled value node from a grammar rule's -> expression
 * @param expectedType - The expected schema type from the declared value type
 * @param variableTypes - Map from variable name to its captured type name
 * @param resolvedTypes - Map from type name to its parsed schema definition
 * @param path - Current property path for error messages
 */
export function validateValueType(
    value: CompiledValueNode,
    expectedType: SchemaType,
    variableTypes: Map<string, SchemaType>,
    resolvedTypes: Map<string, SchemaTypeDefinition>,
    path: string = "",
): string[] {
    // For expression nodes, derive the result type and check compatibility
    // with the expected type.  We can't do structural validation (e.g. checking
    // object fields) on computed values, but we can catch simple mismatches
    // like putting a number expression where a string is expected.
    if (isValueExprNode(value)) {
        const inferenceErrors: ValueTypeError[] = [];
        const exprType = deriveExprValueType(
            value,
            variableTypes,
            inferenceErrors,
        );
        // Surface inference errors (unknown variable, property, method)
        if (inferenceErrors.length > 0) {
            return inferenceErrors.map((e) => e.message);
        }
        // Check operator constraints (even if type is compatible with expected)
        const operandErrors = validateExprOperandTypes(value, variableTypes);
        if (operandErrors.length > 0) {
            return operandErrors.map((e) => e.message);
        }
        if (exprType === ERROR_TYPE || exprType === ANY_TYPE) return [];
        const resolved = resolveType(expectedType);
        if (resolved.type === "any") return [];
        if (resolved.type === "type-union") {
            // Compatible if any union member matches
            for (const memberType of resolved.types) {
                const memberResolved = resolveType(memberType);
                if (
                    memberResolved.type === "any" ||
                    isTypeAssignable(exprType, memberResolved)
                )
                    return [];
            }
            return [
                `${fieldName(path)} expression produces ${exprType.type}, which does not match any union type member`,
            ];
        }
        if (!isTypeAssignable(exprType, resolved)) {
            return [
                `${fieldName(path)} expected ${resolved.type}, got ${exprType.type} expression`,
            ];
        }
        return [];
    }

    const resolved = resolveType(expectedType);

    switch (resolved.type) {
        case "any":
            return [];

        case "type-union": {
            // Value must match at least one union member
            const allErrors: string[][] = [];
            for (const memberType of resolved.types) {
                const errors = validateValueType(
                    value,
                    memberType,
                    variableTypes,
                    resolvedTypes,
                    path,
                );
                if (errors.length === 0) {
                    return []; // Matches this member
                }
                allErrors.push(errors);
            }
            return [`${fieldName(path)} does not match any union type member`];
        }

        case "object":
            return validateObjectValue(
                value,
                resolved,
                variableTypes,
                resolvedTypes,
                path,
            );

        case "array":
            return validateArrayValue(
                value,
                resolved.elementType,
                variableTypes,
                resolvedTypes,
                path,
            );

        case "string":
            return validatePrimitiveValue(value, "string", variableTypes, path);

        case "number":
            return validatePrimitiveValue(value, "number", variableTypes, path);

        case "boolean":
            return validatePrimitiveValue(
                value,
                "boolean",
                variableTypes,
                path,
            );

        case "true":
            return validateLiteralBooleanValue(value, true, path);

        case "false":
            return validateLiteralBooleanValue(value, false, path);

        case "string-union":
            return validateStringUnionValue(
                value,
                resolved.typeEnum,
                variableTypes,
                path,
            );

        case "type-reference":
            // Unresolved reference — can't validate
            return [];

        case "undefined":
            return [];

        default:
            return [];
    }
}

function fieldName(path: string): string {
    return path === "" ? "Value" : `Field '${path}'`;
}

function fullPath(base: string, field: string): string {
    return base === "" ? field : `${base}.${field}`;
}

function validateObjectValue(
    value: CompiledValueNode,
    expected: SchemaTypeObject,
    variableTypes: Map<string, SchemaType>,
    resolvedTypes: Map<string, SchemaTypeDefinition>,
    path: string,
): string[] {
    if (value.type === "variable") {
        // Variable producing an object — check if its type is compatible
        return validateVariableAgainstSchema(
            value.name,
            variableTypes,
            resolvedTypes,
            expected,
            path,
        );
    }

    if (value.type !== "object") {
        return [
            `${fieldName(path)} expected an object, got ${value.type} value`,
        ];
    }

    const errors: string[] = [];
    const objValue = value as CompiledObjectValueNode;

    // Check required fields exist
    for (const [fieldKey, fieldInfo] of Object.entries(expected.fields) as [
        string,
        SchemaObjectField,
    ][]) {
        const propPath = fullPath(path, fieldKey);
        const propValue = objValue.value[fieldKey];

        if (propValue === undefined) {
            if (!fieldInfo.optional) {
                errors.push(`Missing required property '${propPath}'`);
            }
            continue;
        }

        // null means shorthand { key } which refers to variable named `key`
        const actualValue: CompiledValueNode =
            propValue === null
                ? { type: "variable", name: fieldKey }
                : propValue;

        errors.push(
            ...validateValueType(
                actualValue,
                fieldInfo.type,
                variableTypes,
                resolvedTypes,
                propPath,
            ),
        );
    }

    // Check for extraneous properties
    for (const actualKey of Object.keys(objValue.value)) {
        if (!(actualKey in expected.fields)) {
            errors.push(`Extraneous property '${fullPath(path, actualKey)}'`);
        }
    }

    return errors;
}

function validateArrayValue(
    value: CompiledValueNode,
    elementType: SchemaType,
    variableTypes: Map<string, SchemaType>,
    resolvedTypes: Map<string, SchemaTypeDefinition>,
    path: string,
): string[] {
    if (value.type === "variable") {
        return validateVariableAgainstSchema(
            value.name,
            variableTypes,
            resolvedTypes,
            SchemaCreator.array(elementType),
            path,
        );
    }

    if (value.type !== "array") {
        return [
            `${fieldName(path)} expected an array, got ${value.type} value`,
        ];
    }

    const errors: string[] = [];
    const arrValue = value as CompiledArrayValueNode;
    for (let i = 0; i < arrValue.value.length; i++) {
        errors.push(
            ...validateValueType(
                arrValue.value[i],
                elementType,
                variableTypes,
                resolvedTypes,
                fullPath(path, String(i)),
            ),
        );
    }
    return errors;
}

function validatePrimitiveValue(
    value: CompiledValueNode,
    expectedPrimitive: "string" | "number" | "boolean",
    variableTypes: Map<string, SchemaType>,
    path: string,
): string[] {
    if (value.type === "variable") {
        const varType = variableTypes.get(value.name);
        if (varType === undefined || varType === ANY_TYPE) {
            return []; // Unknown variable type — skip
        }
        const expectedType =
            expectedPrimitive === "string"
                ? SchemaCreator.string()
                : expectedPrimitive === "number"
                  ? SchemaCreator.number()
                  : SchemaCreator.boolean();
        if (!isTypeAssignable(varType, expectedType)) {
            return [
                `${fieldName(path)} expected ${expectedPrimitive}, but variable '${value.name}' captures ${resolveType(varType).type}`,
            ];
        }
        return [];
    }

    if (value.type === "literal") {
        const actualType = typeof value.value;
        if (actualType !== expectedPrimitive) {
            return [
                `${fieldName(path)} expected ${expectedPrimitive}, got ${actualType} literal ${JSON.stringify(value.value)}`,
            ];
        }
        return [];
    }

    return [
        `${fieldName(path)} expected ${expectedPrimitive}, got ${value.type} value`,
    ];
}

function validateLiteralBooleanValue(
    value: CompiledValueNode,
    expected: boolean,
    path: string,
): string[] {
    if (value.type === "literal" && value.value === expected) {
        return [];
    }
    if (value.type === "literal" && typeof value.value === "boolean") {
        return [`${fieldName(path)} expected ${expected}, got ${value.value}`];
    }
    if (value.type === "variable") {
        return []; // Can't validate variable value at compile time
    }
    return [`${fieldName(path)} expected ${expected}, got ${value.type} value`];
}

function validateStringUnionValue(
    value: CompiledValueNode,
    typeEnum: string[],
    variableTypes: Map<string, SchemaType>,
    path: string,
): string[] {
    if (value.type === "variable") {
        const varType = variableTypes.get(value.name);
        if (varType === undefined || varType === ANY_TYPE) {
            return [];
        }
        // Accept if the variable could produce a string value
        if (!isTypeAssignable(varType, SchemaCreator.string())) {
            return [
                `${fieldName(path)} expected a string union member, but variable '${value.name}' captures ${resolveType(varType).type}`,
            ];
        }
        // Can't validate the actual value at compile time — variable could
        // capture any string. Accept it.
        return [];
    }

    if (value.type === "literal" && typeof value.value === "string") {
        if (!typeEnum.includes(value.value)) {
            const expected =
                typeEnum.length === 1
                    ? `'${typeEnum[0]}'`
                    : `one of ${typeEnum.map((s) => `'${s}'`).join(", ")}`;
            return [
                `${fieldName(path)} expected ${expected}, got '${value.value}'`,
            ];
        }
        return [];
    }

    return [
        `${fieldName(path)} expected a string union member, got ${value.type} value`,
    ];
}

/**
 * Check if a variable's inferred type is compatible with an expected schema type.
 * When the variable has a full SchemaType (e.g., from rule inference), validates
 * structurally. For simple primitive types, just checks the type discriminant.
 */
function validateVariableAgainstSchema(
    varName: string,
    variableTypes: Map<string, SchemaType>,
    resolvedTypes: Map<string, SchemaTypeDefinition>,
    expectedType: SchemaType,
    path: string,
): string[] {
    const varType = variableTypes.get(varName);
    if (varType === undefined || varType === ANY_TYPE) {
        return []; // Unknown — skip
    }
    // Check if the variable's inferred type is assignable to the expected
    // type.  isTypeAssignable handles recursive type-references via
    // coinductive reasoning, so both plain types and recursive aliases
    // validate correctly.
    if (!isTypeAssignable(varType, expectedType)) {
        const resolved = resolveType(expectedType);
        const resolvedVar = resolveType(varType);
        return [
            `${fieldName(path)} expected ${resolved.type}, but variable '${varName}' produces ${resolvedVar.type}`,
        ];
    }
    return [];
}
