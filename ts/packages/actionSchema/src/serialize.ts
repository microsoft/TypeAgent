// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createActionSchemaFile } from "./parser.js";
import { ActionSchemaFile, SchemaType, SchemaTypeDefinition } from "./type.js";

export type ActionSchemaFileJSON = {
    schemaName: string;
    entry: string;
    types: Record<string, SchemaTypeDefinition>;
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

export function toJSONActionSchemaFile(
    actionSchemaFile: ActionSchemaFile,
): ActionSchemaFileJSON {
    const definitions: Record<string, SchemaTypeDefinition> = {};
    // clone it so we can modified it.
    const entry = structuredClone(actionSchemaFile.entry);
    definitions[entry.name] = entry;
    collectTypes(definitions, entry.type);
    const result: ActionSchemaFileJSON = {
        schemaName: actionSchemaFile.schemaName,
        entry: entry.name,
        types: definitions,
    };
    if (actionSchemaFile.order) {
        result.order = Object.fromEntries(actionSchemaFile.order.entries());
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

export function fromJSONActionSchemaFile(
    json: ActionSchemaFileJSON,
): ActionSchemaFile {
    for (const type of Object.values(json.types)) {
        resolveTypes(json.types, type.type);
    }
    const entry = json.types[json.entry];
    const order = json.order ? new Map(Object.entries(json.order)) : undefined;
    return createActionSchemaFile(json.schemaName, entry, order, true);
}
