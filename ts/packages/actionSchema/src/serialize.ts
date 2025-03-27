// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createParsedActionSchema } from "./parser.js";
import {
    ParsedActionSchema,
    SchemaType,
    SchemaTypeDefinition,
} from "./type.js";

export type ParsedActionSchemaJSON = {
    entry: string;
    types: Record<string, SchemaTypeDefinition>;
    actionNamespace?: boolean; // default to false
    order?: Record<string, number>;
};

function collectTypes(
    definitions: Record<string, SchemaTypeDefinition>,
    type: SchemaType,
) {
    switch (type.type) {
        case "object":
            for (const field of Object.values(type.fields)) {
                collectTypes(definitions, field.type);
            }
            break;
        case "array":
            collectTypes(definitions, type.elementType);
            break;
        case "type-union":
            for (const t of type.types) {
                collectTypes(definitions, t);
            }
            break;
        case "type-reference":
            if (type.definition === undefined) {
                throw new Error(`Unresolved type reference: ${type.name}`);
            }
            // Save the definition and cut off the reference in the clone.
            const definition = type.definition;
            delete type.definition;

            const existing = definitions[type.name];
            if (existing !== undefined) {
                if (existing !== definition) {
                    throw new Error(`Duplicate type definition: ${type.name}`);
                }
                break;
            }
            definitions[type.name] = definition;
            collectTypes(definitions, definition.type);
            break;
    }
}

/**
 * Convert a ParsedActionSchema to a JSON-able object
 * Data in the original ParsedActionSchema will not be modified.
 *
 * @param parsedActionSchema ParsedActionSchema to convert
 * @returns
 */
export function toJSONParsedActionSchema(
    parsedActionSchema: ParsedActionSchema,
): ParsedActionSchemaJSON {
    const definitions: Record<string, SchemaTypeDefinition> = {};
    // clone it so we can modified it.
    const entry = structuredClone(parsedActionSchema.entry);
    definitions[entry.name] = entry;
    collectTypes(definitions, entry.type);
    const result: ParsedActionSchemaJSON = {
        entry: entry.name,
        types: definitions,
    };
    if (parsedActionSchema.actionNamespace) {
        result.actionNamespace = parsedActionSchema.actionNamespace;
    }
    if (parsedActionSchema.order) {
        result.order = Object.fromEntries(parsedActionSchema.order.entries());
    }
    return result;
}

function resolveTypes(
    definitions: Record<string, SchemaTypeDefinition>,
    type: SchemaType,
) {
    switch (type.type) {
        case "object":
            for (const field of Object.values(type.fields)) {
                resolveTypes(definitions, field.type);
            }
            break;
        case "array":
            resolveTypes(definitions, type.elementType);
            break;
        case "type-union":
            for (const t of type.types) {
                resolveTypes(definitions, t);
            }
            break;
        case "type-reference":
            if (type.definition !== undefined) {
                throw new Error(
                    "Internal error: type reference already have a definition",
                );
            }
            const definition = definitions[type.name];
            if (definition === undefined) {
                throw new Error(`Unresolved type reference: ${type.name}`);
            }
            type.definition = definition;
            break;
    }
}

/**
 * Convert a ParsedActionSchemaJSON back to a ParsedActionSchema
 * Data in the JSON will be modified.
 * Clone the data before passing into this function if you want to keep the original.
 *
 * @param json JSON data to convert
 * @returns
 */
export function fromJSONParsedActionSchema(
    json: ParsedActionSchemaJSON,
): ParsedActionSchema {
    for (const type of Object.values(json.types)) {
        resolveTypes(json.types, type.type);
    }
    const entry = json.types[json.entry];
    const order = json.order ? new Map(Object.entries(json.order)) : undefined;
    // paramSpecs are already stored in each action definition.
    const schemaConfig = json.actionNamespace
        ? {
              actionNamespace: json.actionNamespace,
          }
        : undefined;
    return createParsedActionSchema(entry, order, true, schemaConfig);
}
