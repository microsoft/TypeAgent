// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionAliasTypeDefinition,
    ActionInterfaceTypeDefinition,
    ActionParamArray,
    ActionParamField,
    ActionParamObject,
    ActionParamPrimitive,
    ActionParamStringUnion,
    ActionParamType,
    ActionParamTypeReference,
    ActionTypeDefinition,
} from "./type.js";

export function string(
    union?: string | string[],
): ActionParamPrimitive | ActionParamStringUnion {
    return union
        ? {
              type: "string-union",
              typeEnum: Array.isArray(union) ? union : [union],
          }
        : { type: "string" };
}

export function number(): ActionParamPrimitive {
    return { type: "number" };
}

export function boolean(): ActionParamPrimitive {
    return { type: "boolean" };
}

export function array(elementType: ActionParamType): ActionParamArray {
    return { type: "array", elementType };
}

type FieldSpec = Record<string, ActionParamField | ActionParamType>;
type CommentSpec = string | string[];
function toComments(comments?: CommentSpec) {
    return Array.isArray(comments)
        ? comments
        : comments
          ? [comments]
          : undefined;
}

export function type(
    name: string,
    type: ActionParamType,
    comments?: CommentSpec,
): ActionAliasTypeDefinition {
    return { alias: true, name, type, comments: toComments(comments) };
}

export function inf(
    name: string,
    type: ActionParamObject,
    comments?: CommentSpec,
): ActionInterfaceTypeDefinition {
    return { alias: false, name, type, comments: toComments(comments) };
}

export function field(
    type: ActionParamType,
    comments?: CommentSpec,
): ActionParamField {
    return { type, comments: toComments(comments) };
}

export function optional(
    type: ActionParamType,
    comments?: CommentSpec,
): ActionParamField {
    return { optional: true, type, comments: toComments(comments) };
}

export function obj(f: FieldSpec): ActionParamObject {
    const fields: Record<string, ActionParamField> = {};
    for (const [key, value] of Object.entries(f)) {
        const fl = typeof value.type === "string" ? field(value) : value;
        fields[key] = fl;
    }
    return { type: "object", fields };
}

export function ref(
    name: string,
    definition: ActionTypeDefinition,
): ActionParamTypeReference {
    return { type: "type-reference", name, definition };
}
