// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SchemaType,
    ActionSchemaTypeDefinition,
    ResolvedSchemaType,
    SchemaTypeObject,
    SchemaTypeUnion,
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

// Find the discriminated-union member that declares `fieldName`. Members are
// resolved through type references; the first one that is an object with the
// field wins. Returns undefined when no member has it. This is what lets
// property-path navigation (paramSpec, completion, entity detection) descend
// into a union like MusicTarget, where `trackName` lives only on the
// kind:"track" member.
export function resolveUnionMemberWithField(
    union: SchemaTypeUnion,
    fieldName: string,
): SchemaTypeObject | undefined {
    for (const member of union.types) {
        const resolved = resolveTypeReference(member);
        if (
            resolved?.type === "object" &&
            resolved.fields[fieldName] !== undefined
        ) {
            return resolved;
        }
    }
    return undefined;
}

// Unresolved type references are ignored.
function getPropertyPartType(
    type: SchemaType,
    propertyParts: string[],
): SchemaType | undefined {
    let curr: SchemaType = type;
    for (const propertyPart of propertyParts) {
        const resolved = resolveTypeReference(curr);
        if (resolved === undefined) {
            // Unresolved type reference.
            return undefined;
        }
        const maybeIndex = parseInt(propertyPart);

        if (maybeIndex.toString() === propertyPart) {
            if (resolved.type !== "array") {
                return undefined;
            }
            curr = resolved.elementType;
        } else if (resolved.type === "object") {
            curr = resolved.fields[propertyPart]?.type;
        } else if (resolved.type === "type-union") {
            // Descend into the discriminated-union member that declares this
            // field (e.g. `target.trackName` when target's kind is "track").
            const member = resolveUnionMemberWithField(resolved, propertyPart);
            if (member === undefined) {
                return undefined;
            }
            curr = member.fields[propertyPart].type;
        } else {
            return undefined;
        }
    }
    // This may not be an unresolved type reference.
    return curr;
}

// Return the type of the property.  If the property type is a type-reference, it is kept as is.
// Unresolved type references are ignored.
// Discriminated unions are supported: a path descends into the union member
// that declares the field.
export function getPropertyType(
    type: SchemaType,
    propertyName: string,
): SchemaType | undefined {
    return getPropertyPartType(type, propertyName.split("."));
}

// Unresolved type references are ignored.
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

// The action's description is the first line of its documentation comment, or
// undefined when the action has no comment.
export function getActionDescription(
    actionType: ActionSchemaTypeDefinition,
): string | undefined {
    return actionType.comments?.[0]?.trim() || undefined;
}
