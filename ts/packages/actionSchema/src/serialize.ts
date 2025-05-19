// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createParsedActionSchema } from "./parser.js";
import {
    ParsedActionSchema,
    SchemaType,
    SchemaTypeDefinition,
} from "./type.js";

const parsedActionSchemaVersion = 1;
export type ParsedActionSchemaJSON = {
    version: number;
    entry: {
        action?: string | undefined;
        activity?: string | undefined;
        entity?: string | undefined;
    };
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
    let actionEntryName = undefined;
    if (entry.action) {
        actionEntryName = entry.action.name;
        definitions[actionEntryName] = entry.action;
        collectTypes(definitions, entry.action.type);
    }
    let activityEntryName = undefined;
    if (entry.activity) {
        activityEntryName = entry.activity.name;
        definitions[activityEntryName] = entry.activity;
        collectTypes(definitions, entry.activity.type);
    }
    let entityEntryName = undefined;
    if (entry.entity) {
        entityEntryName = entry.entity.name;
        definitions[entityEntryName] = entry.entity;
        collectTypes(definitions, entry.entity.type);
    }
    const result: ParsedActionSchemaJSON = {
        version: parsedActionSchemaVersion,
        entry: {
            action: actionEntryName,
            activity: activityEntryName,
            entity: entityEntryName,
        },
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
    if (json.version !== parsedActionSchemaVersion) {
        throw new Error(
            `Unsupported ParsedActionSchema version: ${json.version}`,
        );
    }
    for (const type of Object.values(json.types)) {
        resolveTypes(json.types, type.type);
    }
    const entry = {
        action: json.entry.action ? json.types[json.entry.action] : undefined,
        activity: json.entry.activity
            ? json.types[json.entry.activity]
            : undefined,
        entity: json.entry.entity ? json.types[json.entry.entity] : undefined,
    };
    const order = json.order ? new Map(Object.entries(json.order)) : undefined;
    // paramSpecs are already stored in each action definition.
    const schemaConfig = json.actionNamespace
        ? {
              actionNamespace: json.actionNamespace,
          }
        : undefined;
    return createParsedActionSchema(entry, order, true, schemaConfig);
}
