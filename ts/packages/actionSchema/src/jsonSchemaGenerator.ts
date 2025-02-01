// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as sc from "./creator.js";
import {
    ActionSchemaEntryTypeDefinition,
    ActionSchemaGroup,
    SchemaType,
    SchemaTypeDefinition,
} from "./type.js";
export function wrapTypeWithJsonSchema(
    type: ActionSchemaEntryTypeDefinition,
): SchemaTypeDefinition {
    return sc.type(
        "AllActions",
        sc.obj({ response: type.type }),
        undefined,
        true,
    );
}

type JsonSchemaObject = {
    type: "object";
    properties: Record<string, JsonSchema>;
    required: string[];
    additionalProperties: false;
};
type JsonSchemaArray = {
    type: "array";
    items: JsonSchema;
};

type JsonSchemaString = {
    type: "string";
    enum?: string[];
};

type JsonSchemaNumber = {
    type: "number";
};

type JsonSchemaBoolean = {
    type: "boolean";
};

type JsonSchemaUnion = {
    anyOf: JsonSchema[];
};

type JsonSchemaNull = {
    type: "null";
};

type JsonSchemaReference = {
    $ref: string;
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
                    Object.entries(type.fields).map(([key, field]) => [
                        key,
                        generateJsonSchemaType(field.type, pending, strict),
                    ]),
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
        } while (pending.length > 0);
        schema.schema.$defs = $defs;
    }
    console.log(JSON.stringify(schema, undefined, 2));
    return schema;
}

export function generateActionJsonSchema(actionSchemaGroup: ActionSchemaGroup) {
    const type = wrapTypeWithJsonSchema(actionSchemaGroup.entry);

    return generateJsonSchemaTypeDefinition(type);
}
