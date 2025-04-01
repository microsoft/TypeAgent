// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type JsonSchema =
    | JsonSchemaObject
    | JsonSchemaArray
    | JsonSchemaString
    | JsonSchemaNumber
    | JsonSchemaBoolean
    | JsonSchemaNull
    | JsonSchemaUnion
    | JsonSchemaReference;

export type JsonSchemaObject = {
    type: "object";
    description?: string;
    properties: Record<string, JsonSchema>;
    required?: string[];
    additionalProperties: false;
};
export type JsonSchemaArray = {
    type: "array";
    description?: string;
    items: JsonSchema;
};

export type JsonSchemaString = {
    type: "string";
    description?: string;
    enum?: string[];
};

export type JsonSchemaNumber = {
    type: "number";
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
    anyOf: JsonSchema[];
    description?: string;
};

export type JsonSchemaReference = {
    $ref: string;
    description?: string;
};
