// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type JsonSchema =
    | JsonSchemaAny
    | JsonSchemaObject
    | JsonSchemaArray
    | JsonSchemaString
    | JsonSchemaNumber
    | JsonSchemaBoolean
    | JsonSchemaMultiType
    | JsonSchemaTrue
    | JsonSchemaFalse
    | JsonSchemaNull
    | JsonSchemaUnion
    | JsonSchemaReference;

export type JsonSchemaAny = {
    type?: undefined;
    description?: string;
    anyOf?: JsonSchema[];
    oneOf?: JsonSchema[];
    allOf?: JsonSchema[];
    $ref?: string;
    $defs?: Record<string, JsonSchema>;
};

export type JsonSchemaTypeName =
    | "object"
    | "array"
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "null";

export type JsonSchemaMultiType = {
    type: JsonSchemaTypeName[];
    description?: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean | JsonSchema;
    items?: JsonSchema;
    enum?: string[];
};

export type JsonSchemaObject = {
    type: "object";
    description?: string;
    properties?: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties?: boolean | JsonSchema;
};
export type JsonSchemaArray = {
    type: "array";
    description?: string;
    items?: JsonSchema;
};

export type JsonSchemaString = {
    type: "string";
    description?: string;
    enum?: string[];
};

export type JsonSchemaNumber = {
    type: "number" | "integer";
    description?: string;
};

export type JsonSchemaBoolean = {
    type: "boolean";
    description?: string;
};

export type JsonSchemaNull = {
    type: "null";
    description?: string;
};

export type JsonSchemaUnion = {
    anyOf?: JsonSchema[];
    oneOf?: JsonSchema[];
    allOf?: JsonSchema[];
    description?: string;
};

export type JsonSchemaReference = {
    $ref: string;
    description?: string;
};

export type JsonSchemaTrue = {
    type: "true";
    description?: string;
};

export type JsonSchemaFalse = {
    type: "false";
    description?: string;
};
