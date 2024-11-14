// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ActionParamPrimitive = {
    type: "string" | "number" | "boolean" | "undefined";
};

export type ActionParamStringUnion = {
    type: "string-union";
    typeEnum: string[];
};

export type ActionParamScalar = ActionParamPrimitive | ActionParamStringUnion;

export type ActionParamArray = {
    type: "array";
    elementType: ActionParamType;
};

export type ActionParamObjectFields = Record<string, ActionParamField>;
export type ActionParamObject = {
    type: "object";
    fields: ActionParamObjectFields;
};

export type ActionParamField = {
    optional?: boolean | undefined;
    type: ActionParamType;
    comments?: string[] | undefined;
};

export type ActionParamTypeReference = {
    type: "type-reference";
    name: string;
    definition: ActionTypeDefinition;
};

export type ActionParamTypeUnion = {
    type: "type-union";
    types: ActionParamType[];
};

export type ActionInterfaceTypeDefinition = {
    alias: false;
    name: string;
    type: ActionParamObject;
    comments?: string[] | undefined;
};

export type ActionAliasTypeDefinition<T = ActionParamType> = {
    alias: true;
    name: string;
    type: T;
    comments?: string[] | undefined;
};

export type ActionTypeDefinition =
    | ActionInterfaceTypeDefinition
    | ActionAliasTypeDefinition;

export type ActionSchemaTypeDefinition =
    | ActionInterfaceTypeDefinition
    | ActionAliasTypeDefinition<ActionParamObject>;

export type ActionParamType =
    | ActionParamTypeReference
    | ActionParamTypeUnion
    | ActionParamScalar
    | ActionParamObject
    | ActionParamArray;

export type ActionSchema = {
    translatorName: string;
    typeName: string;
    actionName: string;
    definition: ActionSchemaTypeDefinition;
};
