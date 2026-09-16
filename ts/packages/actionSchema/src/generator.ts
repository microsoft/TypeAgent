// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { wrapTypeWithJsonSchema } from "./jsonSchemaGenerator.js";
import {
    SchemaType,
    SchemaObjectFields,
    SchemaTypeDefinition,
    ActionSchemaGroup,
} from "./type.js";
import registerDebug from "debug";
const debug = registerDebug("typeagent:schema:generate");

function generateSchemaType(
    type: SchemaType,
    pending: SchemaTypeDefinition[],
    indent: number,
    jsonSchema: boolean,
    strict: boolean,
    paren: boolean = false,
): string {
    switch (type.type) {
        case "object":
            const lines: string[] = [];
            generateSchemaObjectFields(
                lines,
                type.fields,
                pending,
                indent + 1,
                jsonSchema,
                strict,
            );
            return `{\n${lines.join("\n")}\n${"    ".repeat(indent)}}`;
        case "array":
            return `${generateSchemaType(type.elementType, pending, indent, jsonSchema, strict, true)}[]`;
        case "string-union":
            const stringUnion = type.typeEnum.map((v) => `"${v}"`).join(" | ");
            return paren ? `(${stringUnion})` : stringUnion;
        case "type-union":
            const typeUnion = type.types
                .map((t) =>
                    generateSchemaType(t, pending, indent, jsonSchema, strict),
                )
                .join(" | ");
            return paren ? `(${typeUnion})` : typeUnion;
        case "type-reference":
            if (type.definition) {
                pending.push(type.definition);
            } else if (strict) {
                throw new Error(`Unresolved type reference: ${type.name}`);
            }
            return type.name;
        case "undefined":
            if (jsonSchema) {
                // When jsonSchema is enabled, emit "null" for optional fields to match the json schema.
                // translator will convert it to "undefined" because of stripNulls is enabled
                return "null";
            }
        default:
            return type.type;
    }
}

function generateComments(
    lines: string[],
    comments: string[] | undefined,
    indentStr: string,
) {
    if (!comments) {
        return;
    }
    for (const comment of comments) {
        lines.push(`${indentStr}//${comment}`);
    }
}
function generateSchemaObjectFields(
    lines: string[],
    fields: SchemaObjectFields,
    pending: SchemaTypeDefinition[],
    indent: number,
    jsonSchema: boolean,
    strict: boolean,
) {
    const indentStr = "    ".repeat(indent);
    for (const [key, field] of Object.entries(fields)) {
        generateComments(lines, field.comments, indentStr);
        const optional = field.optional && !jsonSchema ? "?" : "";

        // When jsonSchema is enabled, emit "null" for optional fields to match the json schema.
        // translator will convert it to "undefined" because of stripNulls is enabled
        const jsonSchemaOptional =
            field.optional && jsonSchema ? " | null" : "";

        lines.push(
            `${indentStr}${key}${optional}: ${generateSchemaType(field.type, pending, indent, jsonSchema, strict)}${jsonSchemaOptional};${field.trailingComments ? ` //${field.trailingComments.join(" ")}` : ""}`,
        );
    }
}

function generateTypeDefinition(
    lines: string[],
    definition: SchemaTypeDefinition,
    pending: SchemaTypeDefinition[],
    jsonSchema: boolean,
    strict: boolean,
    exact: boolean,
) {
    generateComments(lines, definition.comments, "");
    const prefix = exact && definition.exported ? "export " : "";
    const generatedDefinition = generateSchemaType(
        definition.type,
        pending,
        0,
        jsonSchema,
        strict,
    );
    const line = definition.alias
        ? `${prefix}type ${definition.name} = ${generatedDefinition};`
        : `${prefix}interface ${definition.name} ${generatedDefinition}`;
    lines.push(line);
}

export type GenerateSchemaOptions = {
    strict?: boolean; // default true
    exact?: boolean; // default false
    jsonSchema?: boolean; // default false
    jsonSchemaFunction?: boolean; // default false
    jsonSchemaWithTs?: boolean; // default false, applies only when jsonSchema or jsonSchemaFunction is true.
    jsonSchemaValidate?: boolean; //default false, applies only when jsonSchema or jsonSchemaFunction is true.
};

function isJsonSchemaEnabled(options?: GenerateSchemaOptions): boolean {
    return options?.jsonSchema === true || options?.jsonSchemaFunction === true;
}
export function generateSchemaTypeDefinition(
    definition: SchemaTypeDefinition | SchemaTypeDefinition[],
    options?: GenerateSchemaOptions,
    order?: Map<string, number>,
): string {
    // wrap the action schema when json schema is active.
    const jsonSchema = isJsonSchemaEnabled(options);

    const includeTs = !jsonSchema || (options?.jsonSchemaWithTs ?? false);
    if (!includeTs) {
        return "";
    }

    const strict = options?.strict ?? true;
    const exact = options?.exact ?? false;
    const emitted = new Map<
        SchemaTypeDefinition,
        { lines: string[]; order: number | undefined; emitOrder: number }
    >();
    const pending = Array.isArray(definition) ? [...definition] : [definition];

    while (pending.length > 0) {
        const definition = pending.shift()!;
        if (!emitted.has(definition)) {
            const lines: string[] = [];
            emitted.set(definition, {
                lines,
                order: order?.get(definition.name),
                emitOrder: emitted.size,
            });
            const dep: SchemaTypeDefinition[] = [];
            generateTypeDefinition(
                lines,
                definition,
                dep,
                jsonSchema,
                strict,
                exact,
            );

            // Generate the dependencies first to be close to the usage
            pending.unshift(...dep);
        }
    }

    const entries = Array.from(emitted.values());
    const emit =
        exact && order !== undefined
            ? entries.sort((a, b) => {
                  if (a.order === undefined || b.order === undefined) {
                      return a.emitOrder - b.emitOrder;
                  }
                  return a.order - b.order;
              })
            : entries;

    const result = emit.flatMap((e) => e.lines).join("\n");
    debug(result);
    return result;
}

export function generateActionSchema(
    actionSchemaGroup: ActionSchemaGroup,
    options?: GenerateSchemaOptions,
): string {
    return generateSchemaTypeDefinition(
        isJsonSchemaEnabled(options)
            ? wrapTypeWithJsonSchema(actionSchemaGroup.entry)
            : actionSchemaGroup.entry,
        options,
        actionSchemaGroup.order,
    );
}
