// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SchemaType,
    ActionSchemaTypeDefinition,
    ResolvedSchemaType,
} from "./type.js";
import { validateSchema } from "./validate.js";

export function resolveUnionType(
    fieldType: SchemaType,
    actualType: ResolvedSchemaType,
    value: unknown,
) {
    if (actualType.type !== "type-union") {
        return { fieldType, actualType };
    }
    for (const t of actualType.types) {
        const actualType = resolveTypeReference(t);
        if (actualType === undefined) {
            throw new Error("Unresolved type reference");
        }
        try {
            validateSchema("", actualType, value, false);
            // REVIEW: just pick the first match?
            return { fieldType: t, actualType };
        } catch {}
    }
    return undefined;
}

export function resolveTypeReference(
    type?: SchemaType,
): ResolvedSchemaType | undefined {
    if (type === undefined) {
        return undefined;
    }
    let curr = type;
    while (curr.type === "type-reference") {
        if (curr.definition === undefined) {
            return undefined;
        }
        curr = curr.definition.type;
    }
    return curr;
}

// Unresolved type references are ignored.
// Type Union is not supported.
function getPropertyPartType(
    type: SchemaType,
    propertyParts: string[],
): SchemaType | undefined {
    let curr: SchemaType = type;
    for (const propertyPart of propertyParts) {
        const resolved = resolveTypeReference(curr);
        if (resolved === undefined) {
            // Unresolved type reference.
            // TODO: doesn't work on union types yet.
            return undefined;
        }
        const maybeIndex = parseInt(propertyPart);

        if (maybeIndex.toString() === propertyPart) {
            if (resolved.type !== "array") {
                return undefined;
            }
            curr = resolved.elementType;
        } else {
            if (resolved.type !== "object") {
                return undefined;
            }
            curr = resolved.fields[propertyPart]?.type;
        }
    }
    // This may not be an unresolved type reference.
    return curr;
}

// Return the type of the property.  If the property type is a type-reference, it is kept as is.
// Unresolved type references are ignored.
// Type Union is not supported.
export function getPropertyType(
    type: SchemaType,
    propertyName: string,
): SchemaType | undefined {
    return getPropertyPartType(type, propertyName.split("."));
}

// Unresolved type references are ignored.
// Type Union is not supported.
export function getParameterNames(
    actionType: ActionSchemaTypeDefinition,
    getCurrentValue: (name: string) => any,
) {
    const parameters = actionType.type.fields.parameters?.type;
    if (parameters === undefined) {
        return [];
    }
    const pending: Array<[string, SchemaType]> = [["parameters", parameters]];
    const result = new Set<string>();
    while (true) {
        const next = pending.pop();
        if (next === undefined) {
            return Array.from(result);
        }

        const [name, field] = next;
        switch (field.type) {
            case "type-union":
                for (const type of field.types) {
                    pending.push([name, type]);
                }
                break;
            case "type-reference":
                if (field.definition) {
                    pending.push([name, field.definition.type]);
                }
                break;
            case "object":
                for (const [key, value] of Object.entries(field.fields)) {
                    pending.push([`${name}.${key}`, value.type]);
                }
                break;
            case "array":
                const v = getCurrentValue(name);
                const newIndex = Array.isArray(v) ? v.length : 0;
                for (let i = 0; i <= newIndex; i++) {
                    pending.push([`${name}.${i}`, field.elementType]);
                }
                break;
            default:
                result.add(name);
                break;
        }
    }
}
