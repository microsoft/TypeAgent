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
    SchemaTypeUnion,
    SchemaTypeAny,
} from "./type.js";

export function any(): SchemaTypeAny {
    return { type: "any" };
}
export function string(): SchemaTypeString;
export function string(...union: (string | string[])[]): SchemaTypeStringUnion;
export function string(
    ...union: (string | string[])[]
): SchemaTypeString | SchemaTypeStringUnion {
    const flat = union.flat();
    return flat.length !== 0
        ? {
              type: "string-union",
              typeEnum: flat,
          }
        : { type: "string" };
}

export function number(): SchemaTypeNumber {
    return { type: "number" };
}

export function boolean(): SchemaTypeBoolean {
    return { type: "boolean" };
}

export function array<T extends SchemaType>(
    elementType: T,
): SchemaTypeArray<T> {
    return { type: "array", elementType };
}

export type FieldSpec = Record<string, SchemaObjectField | SchemaType>;
type CommentSpec = string | string[];
function toComments(comments?: CommentSpec): string[] | undefined {
    return Array.isArray(comments)
        ? comments
        : comments
          ? [comments]
          : undefined;
}

// alias definition
export function type<T extends SchemaType = SchemaType>(
    name: string,
    type: T,
    comments?: CommentSpec,
    exported?: boolean,
): SchemaTypeAliasDefinition<T> {
    return {
        alias: true,
        name,
        type,
        comments: toComments(comments),
        exported,
    };
}

// interface definition
export function intf<T extends SchemaTypeObject = SchemaTypeObject>(
    name: string,
    type: T,
    comments?: CommentSpec,
    exported?: boolean,
): SchemaTypeInterfaceDefinition<T> {
    return {
        alias: false,
        name,
        type,
        comments: toComments(comments),
        exported,
    };
}

export function field<T extends SchemaType = SchemaType>(
    type: T,
    comments?: CommentSpec,
): SchemaObjectField<T> {
    return { type, comments: toComments(comments) };
}

export function optional<T extends SchemaType = SchemaType>(
    type: T,
    comments?: CommentSpec,
): SchemaObjectField<T> {
    return { optional: true, type, comments: toComments(comments) };
}

type SchemaObjectFieldTypeFromFieldSpec<
    T extends SchemaObjectField | SchemaType,
> = T extends SchemaType ? SchemaObjectField<T> : T;

type SchemaObjectFieldsFromSpec<T extends FieldSpec> = {
    [K in keyof T]: SchemaObjectFieldTypeFromFieldSpec<T[K]>;
};

type SchemaTypeObjectFromSpec<T extends FieldSpec> = SchemaTypeObject<
    SchemaObjectFieldsFromSpec<T>
>;

export function obj<T extends FieldSpec>(f: T): SchemaTypeObjectFromSpec<T> {
    const fields: Record<string, SchemaObjectField> = {};
    for (const [key, value] of Object.entries(f)) {
        const fl = typeof value.type === "string" ? field(value) : value;
        fields[key] = fl;
    }
    return {
        type: "object",
        fields: fields as SchemaObjectFieldsFromSpec<T>,
    };
}

export function ref<T extends SchemaTypeDefinition = SchemaTypeDefinition>(
    definition: string | T,
): SchemaTypeReference<T> {
    if (typeof definition === "string") {
        return { type: "type-reference", name: definition };
    }
    return { type: "type-reference", name: definition.name, definition };
}

export function union<T extends SchemaType>(
    ...types: (T | T[])[]
): SchemaTypeUnion<T>;
export function union(
    ...types: (SchemaType | SchemaType[])[]
): SchemaTypeUnion<SchemaType>;
export function union(
    ...types: (SchemaType | SchemaType[])[]
): SchemaTypeUnion<SchemaType> {
    return { type: "type-union", types: types.flat() };
}
