// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ActionParamPrimitive = {
    type: "string" | "number" | "boolean";
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
};

export type ActionParamType =
    | ActionParamScalar
    | ActionParamObject
    | ActionParamArray;

export type ActionSchema = {
    translatorName: string;
    typeName: string;
    actionName: string;
    comments: string[] | undefined;
    parameters?: ActionParamObject | undefined;
};
