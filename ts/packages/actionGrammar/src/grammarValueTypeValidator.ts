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
 * Derives the output SchemaType of a compiled rule (GrammarRule[]).
 * Returns a SchemaType representing the rule's output, or the "any" sentinel
 * for rules whose type can't be determined.
 * Uses a cache to avoid recomputing for rules referenced by multiple parents.
 */
export function deriveRuleValueType(
    rules: GrammarRule[],
    cache: Map<GrammarRule[], SchemaType>,
): SchemaType {
    const cached = cache.get(rules);
    if (cached !== undefined) {
        return cached;
    }
    // Set sentinel before recursing to handle circular references
    cache.set(rules, ANY_TYPE);

    const types: SchemaType[] = [];
    for (const rule of rules) {
        const altType = deriveAlternativeType(rule, cache);
        if (altType === ANY_TYPE) {
            cache.set(rules, ANY_TYPE);
            return ANY_TYPE;
        }
        // Add if not structurally duplicate
        if (!types.some((t) => schemaTypesEqual(t, altType))) {
            types.push(altType);
        }
    }

    let result: SchemaType;
    if (types.length === 0) {
        result = ANY_TYPE;
    } else if (types.length === 1) {
        result = types[0];
    } else {
        result = SchemaCreator.union(...types);
    }
    cache.set(rules, result);
    return result;
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
        return deriveRuleValueType(rule.parts[0].rules, cache);
    }

    return ANY_TYPE;
}

function derivePartType(
    part: GrammarPart,
    cache: Map<GrammarRule[], SchemaType>,
): SchemaType {
    if (part.type === "wildcard") {
        return grammarTypeToSchemaType(part.typeName);
    }
    if (part.type === "number") {
        return SchemaCreator.number();
    }
    if (part.type === "rules") {
        return deriveRuleValueType(part.rules, cache);
    }
    return ANY_TYPE;
}

function deriveValueNodeType(
    value: CompiledValueNode,
    parts: GrammarPart[],
    cache: Map<GrammarRule[], SchemaType>,
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
            }
            return ANY_TYPE;
        case "variable": {
            // Look up the variable's type from the rule parts
            for (const part of parts) {
                if (part.variable === value.name) {
                    return derivePartType(part, cache);
                }
            }
            return ANY_TYPE;
        }
        case "object": {
            // Infer field types for the object
            const fields: Record<string, SchemaObjectField> = {};
            for (const [key, propValue] of Object.entries(value.value)) {
                const fieldValue =
                    propValue === null
                        ? ({ type: "variable", name: key } as CompiledValueNode)
                        : propValue;
                const fieldType = deriveValueNodeType(fieldValue, parts, cache);
                fields[key] = { type: fieldType };
            }
            return SchemaCreator.obj(fields);
        }
        case "array":
            return SchemaCreator.array(ANY_TYPE);
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
            return SchemaCreator.number();
        default:
            return ANY_TYPE;
    }
}

/**
 * Structural equality check for SchemaType values.
 * Handles primitives, string unions, arrays, objects, and type references.
 */
function schemaTypesEqual(a: SchemaType, b: SchemaType): boolean {
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
                return schemaTypesEqual(
                    a.definition.type,
                    bRef.definition.type,
                );
            }
            // Fall back to name comparison when definitions aren't resolved
            return a.name === bRef.name;
        }
        case "array":
            return schemaTypesEqual(a.elementType, (b as typeof a).elementType);
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
                    schemaTypesEqual(af.type, bf.type)
                );
            });
        }
        case "type-union": {
            const bTypes = (b as typeof a).types;
            return (
                a.types.length === bTypes.length &&
                a.types.every((t) =>
                    bTypes.some((bt) => schemaTypesEqual(t, bt)),
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
 */
function resolveType(type: SchemaType): SchemaType {
    if (type.type === "type-reference" && type.definition !== undefined) {
        return type.definition.type;
    }
    return type;
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
        if (varType === undefined || varType.type === "any") {
            return []; // Unknown variable type — skip
        }
        if (varType.type !== expectedPrimitive) {
            return [
                `${fieldName(path)} expected ${expectedPrimitive}, but variable '${value.name}' captures ${varType.type}`,
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
        if (varType === undefined || varType.type === "any") {
            return [];
        }
        if (varType.type !== "string" && varType.type !== "string-union") {
            return [
                `${fieldName(path)} expected a string union member, but variable '${value.name}' captures ${varType.type}`,
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
    if (varType === undefined || varType.type === "any") {
        return []; // Unknown — skip
    }
    // For object and array types with full structural info, do a deeper check.
    // For primitive types, the caller already handles the check.
    // This is called when a variable is used in an object or array position.
    const resolved = resolveType(expectedType);
    if (resolved.type === "any") {
        return [];
    }
    if (varType === ANY_TYPE) {
        return [];
    }
    // Simple type mismatch check
    if (resolved.type === "object" && varType.type !== "object") {
        return [
            `${fieldName(path)} expected an object, but variable '${varName}' produces ${varType.type}`,
        ];
    }
    if (resolved.type === "array" && varType.type !== "array") {
        return [
            `${fieldName(path)} expected an array, but variable '${varName}' produces ${varType.type}`,
        ];
    }
    return [];
}
