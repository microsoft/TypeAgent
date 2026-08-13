// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    resolveTypeReference,
    type ActionParamObject,
    type SchemaType,
} from "@typeagent/action-schema";

export const TRANSLATION_BENCH_GOLD_OPTIONALITY_RULE =
    "TypeAgent optionality is the source of truth for gold. The OpenAI tool " +
    "JSON schema lists every property in required[] (translator convention) " +
    "and does NOT make optional TypeAgent fields required. parameterScore / " +
    "nonempty scores a present value; it is not a presence requirement. Omit " +
    "optional fields the utterance does not support, including optional " +
    "false booleans and empty arrays.";

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function listGoldParameterFields(type: SchemaType): {
    required: string[];
    optional: string[];
} {
    const resolved = resolveTypeReference(type);
    if (resolved?.type !== "object") {
        return { required: [], optional: [] };
    }
    const required: string[] = [];
    const optional: string[] = [];
    for (const [name, field] of Object.entries(resolved.fields)) {
        if (field.optional) {
            optional.push(name);
        } else {
            required.push(name);
        }
    }
    return { required, optional };
}

function requiredFieldNames(type: ActionParamObject): string[] {
    return Object.entries(type.fields)
        .filter(([, field]) => field.optional !== true)
        .map(([name]) => name);
}

function rewriteNode(
    json: unknown,
    type: SchemaType,
    defs: Record<string, unknown> | undefined,
    seenDefs: Set<string>,
): void {
    if (!isPlainObject(json)) {
        return;
    }
    if (typeof json.$ref === "string" && json.$ref.startsWith("#/$defs/")) {
        const name = json.$ref.slice("#/$defs/".length);
        if (
            defs !== undefined &&
            isPlainObject(defs[name]) &&
            !seenDefs.has(name)
        ) {
            seenDefs.add(name);
            rewriteNode(defs[name], type, defs, seenDefs);
        }
        return;
    }
    const resolved = resolveTypeReference(type) ?? type;
    if (resolved.type === "object") {
        json.required = requiredFieldNames(resolved);
        const properties = json.properties;
        if (isPlainObject(properties)) {
            for (const [name, field] of Object.entries(resolved.fields)) {
                if (properties[name] !== undefined) {
                    rewriteNode(properties[name], field.type, defs, seenDefs);
                }
            }
        }
        return;
    }
    if (resolved.type === "array") {
        rewriteNode(json.items, resolved.elementType, defs, seenDefs);
        return;
    }
    if (resolved.type === "type-union" && Array.isArray(json.anyOf)) {
        const variants = json.anyOf;
        resolved.types.forEach((member, index) => {
            rewriteNode(variants[index], member, defs, seenDefs);
        });
    }
}

/**
 * Rewrite an OpenAI-style tool parameters JSON schema so `required` matches
 * TypeAgent field.optional. generateActionActionFunctionJsonSchemas marks
 * every property required (strict-mode convention); gold labeling must not.
 */
export function rewriteJsonSchemaRequiredForGold(
    schema: Record<string, unknown>,
    type: SchemaType,
): Record<string, unknown> {
    const clone = structuredClone(schema);
    const defs = isPlainObject(clone.$defs) ? clone.$defs : undefined;
    rewriteNode(clone, type, defs, new Set());
    return clone;
}

export function applyGoldOptionalityToToolParameters(
    parameters: Record<string, unknown> | undefined,
    parameterType: SchemaType | undefined,
): Record<string, unknown> | undefined {
    if (parameters === undefined || parameterType === undefined) {
        return parameters;
    }
    return rewriteJsonSchemaRequiredForGold(parameters, parameterType);
}

function matchingUnionObject(
    type: SchemaType,
    value: Record<string, unknown>,
): ActionParamObject | undefined {
    const resolved = resolveTypeReference(type) ?? type;
    if (resolved.type === "object") {
        return resolved;
    }
    if (resolved.type !== "type-union") {
        return undefined;
    }
    const keys = Object.keys(value);
    for (const member of resolved.types) {
        const objectType = resolveTypeReference(member);
        if (objectType?.type !== "object") continue;
        if (keys.every((key) => objectType.fields[key] !== undefined)) {
            return objectType as ActionParamObject;
        }
    }
    return undefined;
}

function isOptionalBooleanField(type: ActionParamObject, key: string): boolean {
    const field = type.fields[key];
    if (field === undefined || !field.optional) {
        return false;
    }
    const resolved = resolveTypeReference(field.type);
    return resolved?.type === "boolean";
}

function stripOptionalFalseValue(
    value: unknown,
    type: SchemaType,
    path: string,
    removed: string[],
): { kept: true; value: unknown } | { kept: false } {
    if (Array.isArray(value)) {
        const resolved = resolveTypeReference(type) ?? type;
        if (resolved.type !== "array") {
            return { kept: true, value };
        }
        const next: unknown[] = [];
        let changed = false;
        for (let i = 0; i < value.length; i += 1) {
            const child = stripOptionalFalseValue(
                value[i],
                resolved.elementType,
                `${path}[${i}]`,
                removed,
            );
            if (!child.kept) {
                changed = true;
                continue;
            }
            if (child.value !== value[i]) {
                changed = true;
            }
            next.push(child.value);
        }
        if (next.length === 0 && value.length > 0) {
            removed.push(path);
            return { kept: false };
        }
        return { kept: true, value: changed ? next : value };
    }
    if (!isPlainObject(value)) {
        return { kept: true, value };
    }
    const objectType = matchingUnionObject(type, value);
    if (objectType === undefined) {
        return { kept: true, value };
    }
    const next: Record<string, unknown> = {};
    let changed = false;
    for (const [key, childValue] of Object.entries(value)) {
        const childPath = path === "" ? key : `${path}.${key}`;
        if (childValue === false && isOptionalBooleanField(objectType, key)) {
            removed.push(childPath);
            changed = true;
            continue;
        }
        const field = objectType.fields[key];
        if (field === undefined) {
            next[key] = childValue;
            continue;
        }
        const child = stripOptionalFalseValue(
            childValue,
            field.type,
            childPath,
            removed,
        );
        if (!child.kept) {
            changed = true;
            continue;
        }
        if (child.value !== childValue) {
            changed = true;
        }
        next[key] = child.value;
    }
    if (Object.keys(next).length === 0) {
        if (path !== "") {
            removed.push(path);
        }
        return { kept: false };
    }
    return { kept: true, value: changed ? next : value };
}

export function stripOptionalFalseGoldBooleans(
    parameters: Record<string, unknown> | undefined,
    type: SchemaType,
): {
    parameters: Record<string, unknown> | undefined;
    removed: string[];
} {
    if (parameters === undefined) {
        return { parameters: undefined, removed: [] };
    }
    const removed: string[] = [];
    const stripped = stripOptionalFalseValue(parameters, type, "", removed);
    if (!stripped.kept) {
        return { parameters: undefined, removed };
    }
    if (stripped.value === parameters) {
        return { parameters, removed: [] };
    }
    return {
        parameters: stripped.value as Record<string, unknown>,
        removed,
    };
}
