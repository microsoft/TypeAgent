// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SchemaTypeAliasDefinition,
    SchemaTypeInterfaceDefinition,
    SchemaTypeArray,
    SchemaObjectField,
    SchemaTypeObject,
    SchemaTypeStringUnion,
    SchemaType,
    SchemaTypeReference,
    SchemaTypeDefinition,
    SchemaTypeNumber,
    SchemaTypeBoolean,
    SchemaTypeString,
} from "./type.js";

export function string(
    ...union: string[]
): SchemaTypeString | SchemaTypeStringUnion {
    return union.length !== 0
        ? {
              type: "string-union",
              typeEnum: union,
          }
        : { type: "string" };
}

export function number(): SchemaTypeNumber {
    return { type: "number" };
}

export function boolean(): SchemaTypeBoolean {
    return { type: "boolean" };
}

export function array(elementType: SchemaType): SchemaTypeArray {
    return { type: "array", elementType };
}

export type FieldSpec = Record<string, SchemaObjectField | SchemaType>;
type CommentSpec = string | string[];
function toComments(comments?: CommentSpec) {
    return Array.isArray(comments)
        ? comments
        : comments
          ? [comments]
          : undefined;
}

// alias definition
export function type(
    name: string,
    type: SchemaType,
    comments?: CommentSpec,
): SchemaTypeAliasDefinition {
    return { alias: true, name, type, comments: toComments(comments) };
}

// interface definition
export function intf(
    name: string,
    type: SchemaTypeObject,
    comments?: CommentSpec,
): SchemaTypeInterfaceDefinition {
    return { alias: false, name, type, comments: toComments(comments) };
}

export function field(
    type: SchemaType,
    comments?: CommentSpec,
): SchemaObjectField {
    return { type, comments: toComments(comments) };
}

export function optional(
    type: SchemaType,
    comments?: CommentSpec,
): SchemaObjectField {
    return { optional: true, type, comments: toComments(comments) };
}

export function obj(f: FieldSpec): SchemaTypeObject {
    const fields: Record<string, SchemaObjectField> = {};
    for (const [key, value] of Object.entries(f)) {
        const fl = typeof value.type === "string" ? field(value) : value;
        fields[key] = fl;
    }
    return { type: "object", fields };
}

// Doesn't support cucular reference, so only accept existing definition only.
export function ref(definition: SchemaTypeDefinition): SchemaTypeReference {
    return { type: "type-reference", name: definition.name, definition };
}

export function union(...types: SchemaType[]): SchemaType {
    return { type: "type-union", types };
}
