// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createActionSchemaFile } from "./parser.js";
import {
    ActionSchemaFile,
    ParsedActionSchema,
    SchemaType,
    SchemaTypeDefinition,
} from "./type.js";

export type ParsedActionSchemaGroupJSON = {
    entry: string;
    types: Record<string, SchemaTypeDefinition>;
    actionNamespace?: boolean; // default to false
    order?: Record<string, number>;
};

export type ActionSchemaFileJSON = {
    schemaName: string;
    sourceHash: string;
} & ParsedActionSchemaGroupJSON;

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

function toJSONActionSchemaGroup(
    parsedActionSchema: ParsedActionSchema,
): ParsedActionSchemaGroupJSON {
    const definitions: Record<string, SchemaTypeDefinition> = {};
    // clone it so we can modified it.
    const entry = structuredClone(parsedActionSchema.entry);
    definitions[entry.name] = entry;
    collectTypes(definitions, entry.type);
    const result: ParsedActionSchemaGroupJSON = {
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

/**
 * Convert a ActionSchemaFile to a JSON-able object
 * Data in the original ActionSchemaFile will not be modified.
 *
 * @param actionSchemaFile ActionSchemaFile to convert
 * @returns
 */
export function toJSONActionSchemaFile(
    actionSchemaFile: ActionSchemaFile,
): ActionSchemaFileJSON {
    const result: ActionSchemaFileJSON = {
        schemaName: actionSchemaFile.schemaName,
        sourceHash: actionSchemaFile.sourceHash,
        ...toJSONActionSchemaGroup(actionSchemaFile),
    };
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
 * Convert a ActionSchemaFileJSON back to a ActionSchemaFile
 * Data in the JSON will be modified.
 * Clone the data before passing into this function if you want to keep the original.
 *
 * @param json JSON data to convert
 * @returns
 */
export function fromJSONActionSchemaFile(
    json: ActionSchemaFileJSON,
): ActionSchemaFile {
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
    return createActionSchemaFile(
        json.schemaName,
        json.sourceHash,
        entry,
        order,
        true,
        schemaConfig,
    );
}

export function loadParsedActionSchema(
    schemaName: string,
    schemaType: string,
    sourceHash: string,
    source: string,
): ActionSchemaFile {
    const json = JSON.parse(source);
    // TODO: validate the json
    json.schemaName = schemaName;
    json.sourceHash = sourceHash;
    const actionSchemaFile = fromJSONActionSchemaFile(json);
    if (actionSchemaFile.entry.name !== schemaType) {
        throw new Error(
            `Schema type mismatch: ${actionSchemaFile.entry.name} != ${schemaType}`,
        );
    }
    return actionSchemaFile;
}

export function saveParsedActionSchema(
    parsedActionSchema: ParsedActionSchema,
): string {
    const json = toJSONActionSchemaGroup(parsedActionSchema);
    return JSON.stringify(json);
}
