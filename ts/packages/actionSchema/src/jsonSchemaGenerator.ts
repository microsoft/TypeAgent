// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sc from "./creator.js";
import {
    ActionSchemaEntryTypeDefinition,
    ActionSchemaGroup,
    SchemaObjectField,
    SchemaType,
    SchemaTypeDefinition,
} from "./type.js";
export function wrapTypeWithJsonSchema(
    type: ActionSchemaEntryTypeDefinition,
): SchemaTypeDefinition {
    // The root of a Json schema is always an object
    // place the root type definition with an object with a response field of the type.
    return sc.type(type.name, sc.obj({ response: type.type }), undefined, true);
}

type JsonSchemaObject = {
    type: "object";
    description?: string;
    properties: Record<string, JsonSchema>;
    required: string[];
    additionalProperties: false;
};
type JsonSchemaArray = {
    type: "array";
    description?: string;
    items: JsonSchema;
};

type JsonSchemaString = {
    type: "string";
    description?: string;
    enum?: string[];
};

type JsonSchemaNumber = {
    type: "number";
    description?: string;
};

type JsonSchemaBoolean = {
    type: "boolean";
    description?: string;
};

type JsonSchemaNull = {
    type: "null";
    description?: string;
};

type JsonSchemaUnion = {
    anyOf: JsonSchema[];
    description?: string;
};

type JsonSchemaReference = {
    $ref: string;
    description?: string;
};

type JsonSchemaRoot = {
    name: string;
    description?: string;
    strict: true;
    schema: JsonSchema & { $defs?: Record<string, JsonSchema> }; // REVIEW should be JsonSchemaObject;
};

type JsonSchema =
    | JsonSchemaObject
    | JsonSchemaArray
    | JsonSchemaString
    | JsonSchemaNumber
    | JsonSchemaBoolean
    | JsonSchemaNull
    | JsonSchemaUnion
    | JsonSchemaReference;

function fieldComments(field: SchemaObjectField): string | undefined {
    const combined = [
        ...(field.comments ?? []),
        ...(field.trailingComments ?? []),
    ];
    return combined.length > 0 ? combined.join("\n") : undefined;
}

function generateJsonSchemaType(
    type: SchemaType,
    pending: SchemaTypeDefinition[],
    strict: boolean,
): JsonSchema {
    switch (type.type) {
        case "object":
            return {
                type: "object",
                properties: Object.fromEntries(
                    Object.entries(type.fields).map(([key, field]) => {
                        const fieldType = generateJsonSchemaType(
                            field.type,
                            pending,
                            strict,
                        );
                        const comments = fieldComments(field);
                        if (comments) {
                            fieldType.description = comments;
                        }
                        return [key, fieldType];
                    }),
                ),
                required: Object.keys(type.fields),
                additionalProperties: false,
            };
        case "array":
            return {
                type: "array",
                items: generateJsonSchemaType(
                    type.elementType,
                    pending,
                    strict,
                ),
            };
        case "string-union":
            return {
                type: "string",
                enum: type.typeEnum,
            };
        case "type-union":
            return {
                anyOf: type.types.map((t) =>
                    generateJsonSchemaType(t, pending, strict),
                ),
            };
        case "type-reference":
            if (type.definition) {
                pending.push(type.definition);
            } else if (strict) {
                throw new Error(`Unresolved type reference: ${type.name}`);
            }
            return {
                $ref: `#/$defs/${type.name}`,
            };
        case "undefined": {
            // Note: undefined is presented by null in JSON schema
            return { type: "null" };
        }
        default:
            return { type: type.type };
    }
}
function generateJsonSchemaTypeDefinition(
    def: SchemaTypeDefinition,
    strict: boolean = true,
): JsonSchemaRoot {
    const pending: SchemaTypeDefinition[] = [];
    const schema: JsonSchemaRoot = {
        name: def.name,
        strict: true,
        schema: generateJsonSchemaType(def.type, pending, strict),
    };
    if (def.comments) {
        schema.schema.description = def.comments.join("\n");
    }

    if (pending.length !== 0) {
        const $defs: Record<string, JsonSchema> = {};
        do {
            const definition = pending.shift()!;
            if ($defs[definition.name]) {
                continue;
            }
            $defs[definition.name] = generateJsonSchemaType(
                definition.type,
                pending,
                strict,
            );
            if (definition.comments) {
                $defs[definition.name].description =
                    definition.comments.join("\n");
            }
        } while (pending.length > 0);
        schema.schema.$defs = $defs;
    }
    return schema;
}

export function generateActionJsonSchema(actionSchemaGroup: ActionSchemaGroup) {
    const type = wrapTypeWithJsonSchema(actionSchemaGroup.entry);

    return generateJsonSchemaTypeDefinition(type);
}
