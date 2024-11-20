// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface SchemaBase {
    type:
        | "string"
        | "number"
        | "boolean"
        | "undefined"
        | "string-union"
        | "object"
        | "array"
        | "type-reference"
        | "type-union";
}

export interface SchemaTypeString extends SchemaBase {
    type: "string";
}

export interface SchemaTypeNumber extends SchemaBase {
    type: "number";
}

export interface SchemaTypeBoolean extends SchemaBase {
    type: "boolean";
}

export interface SchemaTypeUndefined extends SchemaBase {
    type: "undefined";
}

export interface SchemaTypeStringUnion extends SchemaBase {
    type: "string-union";
    typeEnum: string[];
}

export type SchemaObjectField = {
    optional?: boolean | undefined;
    type: SchemaType;
    comments?: string[] | undefined;
    trailingComments?: string[] | undefined;
};
export type SchemaObjectFields = Record<string, SchemaObjectField>;
export interface SchemaTypeObject extends SchemaBase {
    type: "object";
    fields: SchemaObjectFields;
}

export interface SchemaTypeArray extends SchemaBase {
    type: "array";
    elementType: SchemaType;
}

export interface SchemaTypeReference extends SchemaBase {
    type: "type-reference";
    name: string;
    definition: SchemaTypeDefinition;
}

export interface SchemaTypeUnion extends SchemaBase {
    type: "type-union";
    types: SchemaType[];
}

export type SchemaTypeInterfaceDefinition = {
    alias: false;
    name: string;
    type: SchemaTypeObject;
    comments?: string[] | undefined;
    exported?: boolean; // for exact regen
    order?: number; // for exact regen
};

export type SchemaTypeAliasDefinition<T = SchemaType> = {
    alias: true;
    name: string;
    type: T;
    comments?: string[] | undefined;
    exported?: boolean; // for exact regen
    order?: number; // for exact regen
};

export type SchemaTypeDefinition =
    | SchemaTypeInterfaceDefinition
    | SchemaTypeAliasDefinition;

export type SchemaType =
    | SchemaTypeString
    | SchemaTypeNumber
    | SchemaTypeBoolean
    | SchemaTypeUndefined
    | SchemaTypeStringUnion
    | SchemaTypeReference
    | SchemaTypeUnion
    | SchemaTypeObject
    | SchemaTypeArray;

export type ActionSchemaTypeDefinition =
    | SchemaTypeInterfaceDefinition
    | SchemaTypeAliasDefinition<SchemaTypeObject>;

export type ActionSchema = {
    translatorName: string;
    actionName: string;
    definition: ActionSchemaTypeDefinition;
};
