// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TemplateFieldPrimitive = {
    type: "string" | "number" | "boolean";
};

export type TemplateFieldStringUnion = {
    type: "string-union";
    typeEnum: string[];

    // the discriminator value for the current schema, schema changes if the value the changes
    // Use `getTemplateSchema` to get the schema for the new value
    discriminator?: string;
};

export type TemplateFieldScalar =
    | TemplateFieldPrimitive
    | TemplateFieldStringUnion;

export type TemplateFieldArray = {
    type: "array";
    elementType: TemplateType;
};

export type TemplateFields = Record<string, TemplateField>;
export type TemplateFieldObject = {
    type: "object";
    fields: TemplateFields;
};

export type TemplateField = {
    optional?: boolean | undefined;
    type: TemplateType;
};

export type TemplateType =
    | TemplateFieldScalar
    | TemplateFieldObject
    | TemplateFieldArray;

export type TemplateSchema = TemplateFieldObject;
