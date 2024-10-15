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
    elementType: TemplateField;
};

export type TemplateFieldObject = {
    type: "object";
    fields: {
        [key: string]: TemplateFieldOpt;
    };
};

export type TemplateFieldOpt = {
    optional?: boolean;
    field: TemplateField;
};

export type TemplateField =
    | TemplateFieldScalar
    | TemplateFieldObject
    | TemplateFieldArray;

export type TemplateSchema = TemplateFieldObject;
