// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SchemaType,
    SchemaObjectFields,
    SchemaTypeDefinition,
    ActionSchemaFile,
} from "./type.js";
import registerDebug from "debug";
const debug = registerDebug("typeagent:schema:generate");

function generateSchemaType(
    type: SchemaType,
    pending: SchemaTypeDefinition[],
    indent: number,
    paren: boolean = false,
): string {
    switch (type.type) {
        case "object":
            const lines: string[] = [];
            generateSchemaParamObject(lines, type.fields, pending, indent + 1);
            return `{\n${lines.join("\n")}\n${"    ".repeat(indent)}}`;
        case "array":
            return `${generateSchemaType(type.elementType, pending, indent, true)}[]`;
        case "string-union":
            const stringUnion = type.typeEnum.map((v) => `"${v}"`).join(" | ");
            return paren ? `(${stringUnion})` : stringUnion;
        case "type-union":
            const typeUnion = type.types
                .map((t) => generateSchemaType(t, pending, indent))
                .join(" | ");
            return paren ? `(${typeUnion})` : typeUnion;
        case "type-reference":
            pending.push(type.definition);
            return type.name;

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
function generateSchemaParamObject(
    lines: string[],
    fields: SchemaObjectFields,
    pending: SchemaTypeDefinition[],
    indent: number,
) {
    const indentStr = "    ".repeat(indent);
    for (const [key, field] of Object.entries(fields)) {
        generateComments(lines, field.comments, indentStr);
        const optional = field.optional ? "?" : "";
        lines.push(
            `${indentStr}${key}${optional}: ${generateSchemaType(field.type, pending, indent)};${field.trailingComments ? ` //${field.trailingComments.join(" ")}` : ""}`,
        );
    }
}

function generateTypeDefinition(
    lines: string[],
    definition: SchemaTypeDefinition,
    pending: SchemaTypeDefinition[],
    exact: boolean,
) {
    generateComments(lines, definition.comments, "");
    const prefix = exact && definition.exported ? "export " : "";
    const generatedDefinition = generateSchemaType(definition.type, pending, 0);
    const line = definition.alias
        ? `${prefix}type ${definition.name} = ${generatedDefinition};`
        : `${prefix}interface ${definition.name} ${generatedDefinition}`;
    lines.push(line);
}

export function generateSchema(
    definitions: SchemaTypeDefinition[],
    typeName: string = "AllAction",
    exact: boolean = false,
) {
    const emitted = new Map<SchemaTypeDefinition, string[]>();
    const pending = [...definitions];

    while (pending.length > 0) {
        const definition = pending.pop()!;
        if (!emitted.has(definition)) {
            const lines: string[] = [];
            emitted.set(definition, lines);
            generateTypeDefinition(lines, definition, pending, exact);
        }
    }

    const keys = exact
        ? Array.from(emitted.keys()).sort((a, b) => {
              const orderA = a.order ?? 0;
              const orderB = b.order ?? 0;
              return orderA - orderB;
          })
        : Array.from(emitted.keys());

    const finalLines: string[] = [];

    if (definitions.length !== 1 || definitions[0].name !== typeName) {
        // If there is only on action and it is the type name, don't need to emit the main type alias
        finalLines.push(
            `export type ${typeName} = ${definitions.map((definition) => definition.name).join("|")};`,
        );
    }

    for (const key of keys) {
        finalLines.push(...emitted.get(key)!);
    }
    const result = finalLines.join("\n");
    debug(result);
    return result;
}

export function generateActionSchema(
    actionSchemaFile: ActionSchemaFile,
    typeName: string = "AllAction",
    exact: boolean = false, // for testing
): string {
    return generateSchema([actionSchemaFile.definition], typeName, exact);
}
