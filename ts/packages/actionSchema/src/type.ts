// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionParamSpecs, CompletionEmojis } from "./schemaConfig.js";

export interface SchemaBase {
    type:
        | "any"
        | "string"
        | "number"
        | "boolean"
        | "true"
        | "false"
        | "undefined"
        | "string-union"
        | "object"
        | "array"
        | "type-reference"
        | "type-union";
}

export interface SchemaTypeAny extends SchemaBase {
    type: "any";
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

export interface SchemaTypeTrue extends SchemaBase {
    type: "true";
}

export interface SchemaTypeFalse extends SchemaBase {
    type: "false";
}

export interface SchemaTypeUndefined extends SchemaBase {
    type: "undefined";
}

export interface SchemaTypeStringUnion extends SchemaBase {
    type: "string-union";
    typeEnum: string[];
}

export type SchemaObjectField<T extends SchemaType = SchemaType> = {
    optional?: boolean | undefined;
    type: T;
    comments?: string[] | undefined;
    trailingComments?: string[] | undefined;
};
export type SchemaObjectFields = Record<string, SchemaObjectField>;

export interface SchemaTypeObject<
    T extends SchemaObjectFields = SchemaObjectFields,
> extends SchemaBase {
    type: "object";
    fields: T;
}

export interface SchemaTypeArray<T extends SchemaType = SchemaType>
    extends SchemaBase {
    type: "array";
    elementType: T;
}

export interface SchemaTypeReference<
    T extends SchemaTypeDefinition = SchemaTypeDefinition,
> extends SchemaBase {
    type: "type-reference";
    name: string;
    definition?: T;
}

export interface SchemaTypeUnion<T extends SchemaType = SchemaType>
    extends SchemaBase {
    type: "type-union";
    types: T[];
}

export type SchemaTypeInterfaceDefinition<
    T extends SchemaTypeObject = SchemaTypeObject,
> = {
    alias: false;
    name: string;
    type: T;
    comments?: string[] | undefined;
    exported?: boolean | undefined; // for exact regen
    order?: number; // for exact regen
};

export type SchemaTypeAliasDefinition<T extends SchemaType = SchemaType> = {
    alias: true;
    name: string;
    type: T;
    comments?: string[] | undefined;
    exported?: boolean | undefined; // for exact regen
};

export type SchemaTypeDefinition =
    | SchemaTypeInterfaceDefinition
    | SchemaTypeAliasDefinition;

export type ResolvedSchemaType =
    | SchemaTypeString
    | SchemaTypeNumber
    | SchemaTypeBoolean
    | SchemaTypeUndefined
    | SchemaTypeStringUnion
    | SchemaTypeUnion
    | SchemaTypeObject
    | SchemaTypeArray
    | SchemaTypeAny
    | SchemaTypeTrue
    | SchemaTypeFalse;

export type SchemaType = ResolvedSchemaType | SchemaTypeReference;

// Action Schema specializations
export interface ActionSchemaObject extends SchemaTypeObject {
    fields: {
        actionName: SchemaObjectField<SchemaTypeStringUnion>;
        parameters?: SchemaObjectField<
            | SchemaTypeObject
            | SchemaTypeReference<
                  | SchemaTypeAliasDefinition<SchemaTypeObject>
                  | SchemaTypeInterfaceDefinition<SchemaTypeObject>
              >
        >;
    };
}

export type ActionSchemaTypeDefinition = (
    | SchemaTypeInterfaceDefinition<ActionSchemaObject>
    | SchemaTypeAliasDefinition<ActionSchemaObject>
) & {
    paramSpecs?: ActionParamSpecs;
    paramCompletionEmojis?: CompletionEmojis;
    entityCompletionEmojis?: CompletionEmojis;
};

export type ActionSchemaEntryTypeDefinition =
    | ActionSchemaTypeDefinition
    | SchemaTypeAliasDefinition<ActionSchemaTypeReference | ActionSchemaUnion>;

type ActionSchemaTypeReference =
    SchemaTypeReference<ActionSchemaEntryTypeDefinition>;

// A union of action schema type definitions.
export type ActionSchemaUnion = SchemaTypeUnion<ActionSchemaTypeReference>;

export type ActionSchemaGroup<T = ActionSchemaEntryTypeDefinition> = {
    // The entry type definition for the action schema.
    entry: T;
    // Map action name to action type definition
    actionSchemas: Map<string, ActionSchemaTypeDefinition>;
    // Map of entity type name to type definition
    entitySchemas?: Map<string, ActionSchemaEntityTypeDefinition> | undefined;
    // Order for the type definitions
    order?: Map<string, number>; // for exact regen
};

// Only support string for now.
export type ActionSchemaEntityTypeDefinition =
    SchemaTypeAliasDefinition<SchemaTypeString>;

export type ActionSchemaEntityEntryTypeDefinition = SchemaTypeAliasDefinition<
    | SchemaTypeReference<ActionSchemaEntityTypeDefinition>
    | SchemaTypeUnion<SchemaTypeReference<ActionSchemaEntityTypeDefinition>>
>;

export type ActionSchemaEntryTypeDefinitions = {
    action?: ActionSchemaEntryTypeDefinition | undefined;
    activity?: ActionSchemaEntryTypeDefinition | undefined;
    entity?: ActionSchemaEntityEntryTypeDefinition | undefined;
};

// Action schema that is parsed from a file.
export type ParsedActionSchema =
    ActionSchemaGroup<ActionSchemaEntryTypeDefinitions> & {
        // separate the cache by action name
        actionNamespace?: boolean; // default to false
    };
