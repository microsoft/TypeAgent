// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { JsonSchemaObject } from "./jsonSchemaTypes.js";
import * as sc from "./creator.js";
import {
    SchemaObjectField,
    SchemaType,
    SchemaTypeObject,
    SchemaTypeReference,
} from "./type.js";
import { createParsedActionSchema } from "./parser.js";

type JsonSchemaRecord = Record<string, unknown>;

type ParseContext = {
    root: JsonSchemaRecord;
    references: Set<string>;
};

function schemaError(path: string, message: string): never {
    throw new Error(`${path}: ${message}`);
}

function parseJsonSchemaObject(
    schema: JsonSchemaRecord,
    context: ParseContext,
    path: string,
) {
    const properties = schema.properties;
    if (
        schema.additionalProperties !== undefined &&
        schema.additionalProperties !== false &&
        (!isObject(properties) || Object.keys(properties).length === 0)
    ) {
        return sc.any();
    }
    const fields: Record<string, SchemaObjectField> = {};
    if (properties !== undefined && !isObject(properties)) {
        schemaError(`${path}.properties`, "must be an object");
    }
    const required = readRequired(schema.required, properties ?? {}, path);
    for (const [key, value] of Object.entries(properties ?? {})) {
        const type = parseJsonSchema(value, context, `${path}.${key}`);
        const description = readDescription(value, `${path}.${key}`);
        fields[key] = required.has(key)
            ? sc.field(type, description)
            : sc.optional(type, description);
    }
    return sc.obj(fields);
}

function readRequired(
    value: unknown,
    properties: JsonSchemaRecord,
    path: string,
): Set<string> {
    if (value === undefined) return new Set();
    if (!Array.isArray(value) || !value.every(isString)) {
        schemaError(`${path}.required`, "must be an array of strings");
    }
    const keys = new Set(Object.keys(properties));
    for (const required of value) {
        if (!keys.has(required)) {
            schemaError(
                `${path}.required`,
                `references missing property '${required}'`,
            );
        }
    }
    return new Set(value);
}

function readDescription(schema: unknown, path: string): string | undefined {
    if (!isObject(schema) || schema.description === undefined) return undefined;
    if (!isString(schema.description)) {
        schemaError(`${path}.description`, "must be a string");
    }
    return schema.description;
}

function resolveReference(
    reference: string,
    context: ParseContext,
    path: string,
): SchemaType {
    if (!reference.startsWith("#/")) {
        schemaError(path, `external reference '${reference}' is not supported`);
    }
    if (context.references.has(reference)) {
        schemaError(path, `cyclic reference '${reference}' is not supported`);
    }
    let target: unknown = context.root;
    for (const encodedSegment of reference.slice(2).split("/")) {
        const segment = encodedSegment
            .replaceAll("~1", "/")
            .replaceAll("~0", "~");
        if (
            !isObject(target) ||
            !Object.prototype.hasOwnProperty.call(target, segment)
        ) {
            schemaError(path, `reference '${reference}' cannot be resolved`);
        }
        target = target[segment];
    }
    context.references.add(reference);
    try {
        return parseJsonSchema(target, context, reference);
    } finally {
        context.references.delete(reference);
    }
}

function parseComposition(
    schemas: unknown,
    context: ParseContext,
    path: string,
): SchemaType[] {
    if (!Array.isArray(schemas) || schemas.length === 0) {
        schemaError(path, "must be a non-empty array");
    }
    return schemas.map((schema, index) =>
        parseJsonSchema(schema, context, `${path}[${index}]`),
    );
}

function mergeObjectComposition(parts: SchemaType[]): SchemaType {
    if (
        !parts.every((part): part is SchemaTypeObject => part.type === "object")
    ) {
        return sc.any();
    }
    const fields: Record<string, SchemaObjectField> = {};
    for (const part of parts) {
        for (const [name, field] of Object.entries(part.fields)) {
            if (fields[name] !== undefined) {
                return sc.any();
            }
            fields[name] = field;
        }
    }
    return sc.obj(fields);
}

function parseTypeName(
    type: string,
    schema: JsonSchemaRecord,
    context: ParseContext,
    path: string,
): SchemaType {
    switch (type) {
        case "object":
            return parseJsonSchemaObject(schema, context, path);
        case "array":
            return sc.array(
                schema.items === undefined
                    ? sc.any()
                    : parseJsonSchema(schema.items, context, `${path}.items`),
            );
        case "string": {
            if (schema.enum === undefined) return sc.string();
            if (!Array.isArray(schema.enum) || !schema.enum.every(isString)) {
                schemaError(
                    `${path}.enum`,
                    "string enum values must be strings",
                );
            }
            return sc.string(...schema.enum);
        }
        case "number":
        case "integer":
            return sc.number();
        case "boolean":
            return sc.boolean();
        case "null":
            return sc.undefined_();
        default:
            schemaError(`${path}.type`, `unsupported type '${type}'`);
    }
}

function parseJsonSchema(
    schema: unknown,
    context: ParseContext,
    path: string,
): SchemaType {
    if (schema === true) return sc.any();
    if (schema === false) {
        schemaError(path, "the false schema cannot be translated");
    }
    if (!isObject(schema)) {
        schemaError(path, "must be an object or boolean schema");
    }
    readDescription(schema, path);
    if (isString(schema.$ref)) {
        return resolveReference(schema.$ref, context, path);
    }
    if (schema.anyOf !== undefined || schema.oneOf !== undefined) {
        return sc.union(
            parseComposition(
                schema.anyOf ?? schema.oneOf,
                context,
                `${path}.${schema.anyOf !== undefined ? "anyOf" : "oneOf"}`,
            ),
        );
    }
    if (schema.allOf !== undefined) {
        const parts = parseComposition(schema.allOf, context, `${path}.allOf`);
        return parts.length === 1 ? parts[0] : mergeObjectComposition(parts);
    }
    if (Array.isArray(schema.type)) {
        if (schema.type.length === 0 || !schema.type.every(isString)) {
            schemaError(`${path}.type`, "must contain schema type names");
        }
        return sc.union(
            schema.type.map((type) =>
                parseTypeName(type, schema, context, path),
            ),
        );
    }
    if (isString(schema.type)) {
        return parseTypeName(schema.type, schema, context, path);
    }
    if (schema.properties !== undefined) {
        return parseJsonSchemaObject(schema, context, path);
    }
    if (isString(schema.const)) {
        return sc.string(schema.const);
    }
    if (Array.isArray(schema.enum) && schema.enum.every(isString)) {
        return sc.string(...schema.enum);
    }
    return sc.any();
}

type ToolsJsonSchema = {
    name: string;
    description?: string;
    inputSchema: JsonSchemaObject;
};

/**
 * Convert a tool name to PascalCase by splitting on non-alphanumeric
 * characters and capitalizing each segment.
 *   "get_weather"     -> "GetWeather"
 *   "d1-standup-prep" -> "D1StandupPrep"
 */
export function toPascalCase(name: string): string {
    return name
        .split(/[^a-zA-Z0-9]+/)
        .filter((s) => s.length > 0)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join("");
}

export type ToolsJsonSchemaOptions = {
    /** Transform a tool name into a TypeScript type name.
     *  Defaults to `toPascalCase`. */
    nameTransform?: (name: string) => string;
};

export function parseToolsJsonSchema(
    tools: unknown[],
    entryTypeName: string = "AgentActions",
    options?: ToolsJsonSchemaOptions,
) {
    const nameTransform = options?.nameTransform ?? toPascalCase;
    const refs: SchemaTypeReference[] = [];
    for (const tool of tools) {
        if (!validateToolsJsonSchema(tool)) {
            throw new Error(`Invalid tool schema: ${JSON.stringify(tool)}`);
        }

        const actionName = tool.name;
        const inputSchema = tool.inputSchema as JsonSchemaRecord;
        const context: ParseContext = {
            root: inputSchema,
            references: new Set(),
        };
        const parsedParameters = parseJsonSchemaObject(
            inputSchema,
            context,
            `${actionName}.inputSchema`,
        );
        const type = sc.obj({
            actionName: sc.string(actionName),
            parameters:
                parsedParameters.type === "object"
                    ? parsedParameters
                    : sc.obj({}),
        });
        const def = sc.type(nameTransform(tool.name), type, tool.description);
        refs.push(sc.ref(def));
    }

    const entry = sc.type(entryTypeName, sc.union(refs), undefined, true);
    return createParsedActionSchema({ action: entry }, undefined, true);
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
    if (!isObject(inputSchema)) {
        throw new Error(
            `Invalid tool input schema ${actionName}: root must be an object`,
        );
    }
    if (
        inputSchema.type !== undefined &&
        inputSchema.type !== "object" &&
        !(
            Array.isArray(inputSchema.type) &&
            inputSchema.type.includes("object")
        )
    ) {
        throw new Error(
            `Invalid tool input schema ${actionName}: root type must be object`,
        );
    }
    return true;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
    return typeof value === "string";
}
