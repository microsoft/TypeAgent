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

export interface ActionSchemaObject extends SchemaTypeObject {
    fields: {
        actionName: SchemaObjectField<SchemaTypeStringUnion>;
        parameters: SchemaObjectField<
            | SchemaTypeObject
            | SchemaTypeReference<
                  | SchemaTypeAliasDefinition<SchemaTypeObject>
                  | SchemaTypeInterfaceDefinition<SchemaTypeObject>
              >
        >;
    };
}

export type ActionSchemaTypeDefinition =
    | SchemaTypeInterfaceDefinition<ActionSchemaObject>
    | SchemaTypeAliasDefinition<ActionSchemaObject>;

export type ActionSchemaEntryTypeDefinition =
    | ActionSchemaTypeDefinition
    | SchemaTypeAliasDefinition<ActionSchemaTypeReference | ActionSchemaUnion>;

type ActionSchemaTypeReference =
    SchemaTypeReference<ActionSchemaEntryTypeDefinition>;

// A union of action schema type definitions.
export type ActionSchemaUnion = SchemaTypeUnion<ActionSchemaTypeReference>;

export type ActionSchemaGroup = {
    // The entry type definition for the action schema.
    entry: ActionSchemaEntryTypeDefinition;
    // Map action name to action type definition
    actionSchemas: Map<string, ActionSchemaTypeDefinition>;
    // Order for the type definitions
    order?: Map<string, number>; // for exact regen
};

export type ActionSchemaFile = ActionSchemaGroup & {
    // Schema name
    schemaName: string;
};
