// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    JsonSchema,
    JsonSchemaArray,
    JsonSchemaBoolean,
    JsonSchemaNumber,
    JsonSchemaObject,
    JsonSchemaReference,
    JsonSchemaString,
    JsonSchemaUnion,
} from "./jsonSchemaTypes.js";
import * as sc from "./creator.js";
import { SchemaObjectField, SchemaType, SchemaTypeReference } from "./type.js";
import { createParsedActionSchema } from "./parser.js";

function parseJsonSchemaObject(schema: JsonSchemaObject) {
    const fields: Record<string, SchemaObjectField> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
        const type = parseJsonSchema(value);
        fields[key] = schema.required?.includes(key)
            ? sc.field(type, value.description)
            : sc.optional(type, value.description);
    }
    return sc.obj(fields);
}

function parseJsonSchemaArray(schema: JsonSchemaArray) {
    const type = parseJsonSchema(schema.items);
    return sc.array(type);
}

function parseJsonSchemaString(schema: JsonSchemaString) {
    return sc.string(...(schema.enum ?? []));
}
function parseJsonSchemaNumber(schema: JsonSchemaNumber) {
    return sc.number();
}
function parseJsonSchemaBoolean(schema: JsonSchemaBoolean) {
    return sc.boolean();
}

function parseJsonSchemaUnion(schema: JsonSchemaUnion) {
    const types = schema.anyOf.map(parseJsonSchema);
    return sc.union(types);
}
function parseJsonSchemaReference(
    schema: JsonSchemaReference,
): SchemaTypeReference {
    // TODO: resolve?
    // return sc.ref(schema.$ref);
    throw new Error("Not implemented");
}

function isJsonSchemaUnion(schema: JsonSchema): schema is JsonSchemaUnion {
    return (schema as JsonSchemaUnion).anyOf !== undefined;
}

function isJsonSchemaReference(
    schema: JsonSchema,
): schema is JsonSchemaReference {
    return (schema as JsonSchemaReference).$ref !== undefined;
}

function parseJsonSchema(schema: JsonSchema): SchemaType {
    if (isJsonSchemaUnion(schema)) {
        return parseJsonSchemaUnion(schema);
    }
    if (isJsonSchemaReference(schema)) {
        return parseJsonSchemaReference(schema);
    }

    switch (schema.type) {
        case "object":
            return parseJsonSchemaObject(schema);
        case "array":
            return parseJsonSchemaArray(schema);
        case "string":
            return parseJsonSchemaString(schema);
        case "number":
            return parseJsonSchemaNumber(schema);
        case "boolean":
            return parseJsonSchemaBoolean(schema);
        case "null":
            throw new Error("Null type is not supported");
    }

    throw new Error(`Invalid schema type: ${JSON.stringify(schema)}`);
}

type ToolsJsonSchema = {
    name: string;
    description?: string;
    inputSchema: JsonSchemaObject;
};
export function parseToolsJsonSchema(
    tools: unknown[],
    entryTypeName: string = "AgentActions",
) {
    const refs: SchemaTypeReference[] = [];
    for (const tool of tools) {
        if (!validateToolsJsonSchema(tool)) {
            throw new Error(`Invalid tool schema: ${JSON.stringify(tool)}`);
        }

        const actionName = tool.name;
        const inputSchema = tool.inputSchema;
        const type = sc.obj({
            actionName: sc.string(actionName),
            parameters: parseJsonSchemaObject(inputSchema),
        });
        const def = sc.type(
            `${tool.name[0].toUpperCase()}${tool.name.slice(1)}`,
            type,
            tool.description,
        );
        refs.push(sc.ref(def));
    }

    const entry = sc.type(entryTypeName, sc.union(refs), undefined, true);
    return createParsedActionSchema(entry, undefined, true);
}

function validateToolsJsonSchema(schema: unknown): schema is ToolsJsonSchema {
    if (!isObject(schema)) {
        return false;
    }
    const tool = schema as Record<string, unknown>;
    const actionName = tool.name;
    if (!isString(actionName)) {
        throw new Error(`Invalid tool name: ${actionName}`);
    }
    if (tool.description !== undefined && !isString(tool.description)) {
        throw new Error(
            `Invalid tool description for ${actionName}: ${tool.description}`,
        );
    }
    const inputSchema = tool.inputSchema;
    if (!validateJsonSchemaObject(inputSchema)) {
        throw new Error(`Invalid tool input schema ${actionName}`);
    }

    // REVIEW: extra properties are ignored?
    return true;
}
function validateJsonSchemaObject(schema: unknown): schema is JsonSchema {
    if (!isObject(schema) || schema.type !== "object") {
        return false;
    }
    return validateJsonSchemaObjectFields(schema);
}

function validateJsonSchemaObjectFields(
    schema: Record<string, unknown>,
): schema is JsonSchemaObject {
    if (schema.properties === undefined) {
        return schema.required === undefined;
    }
    if (!isObject(schema.properties)) {
        return false;
    }
    if (schema.required !== undefined) {
        if (!Array.isArray(schema.required)) {
            return false;
        }
        const keys = Object.keys(schema.properties);
        for (const required of schema.required) {
            if (!isString(required)) {
                return false;
            }
            if (!keys.includes(required)) {
                return false;
            }
        }
    }

    for (const value of Object.values(schema.properties)) {
        if (!validateJsonSchema(value)) {
            return false;
        }
    }
    return true;
}

function validateJsonSchema(schema: unknown): schema is JsonSchema {
    if (!isObject(schema)) {
        return false;
    }
    if (schema.description !== undefined && !isString(schema.description)) {
        return false;
    }

    switch (schema.type) {
        case "object":
            return validateJsonSchemaObjectFields(schema);
        case "array":
            return (
                (schema.description === undefined ||
                    isString(schema.description)) &&
                (schema.items === undefined || validateJsonSchema(schema.items))
            );
        case "string":
            return schema.enum === undefined || isStringArray(schema.enum);
        case "number":
        case "boolean":
        case "null":
            return true;
        case undefined:
            if (schema.anyOf !== undefined) {
                // JsonSchemaUnion
                if (!Array.isArray(schema.anyOf)) {
                    return false;
                }
                for (const value of schema.anyOf) {
                    if (!validateJsonSchema(value)) {
                        return false;
                    }
                }
                return true;
            }
            // JsonSchemaReference
            return isString(schema.$ref);
        default:
            return false;
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(isString);
}
