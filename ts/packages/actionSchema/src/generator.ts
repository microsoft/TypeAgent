// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionParamType,
    ActionSchema,
    ActionParamObjectFields,
    ActionTypeDefinition,
} from "./type.js";

function generateSchemaType(
    type: ActionParamType,
    pending: ActionTypeDefinition[],
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
    fields: ActionParamObjectFields,
    pending: ActionTypeDefinition[],
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
    definition: ActionTypeDefinition,
    pending: ActionTypeDefinition[],
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
    actionSchemas: ActionSchema[],
    typeName: string = "AllAction",
    exact: boolean = false, // for testing
): string {
    const emitted = new Map<ActionTypeDefinition, string[]>();
    const pending: ActionTypeDefinition[] = actionSchemas.map(
        (actionInfo) => actionInfo.definition,
    );

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

    if (actionSchemas.length !== 1 || actionSchemas[0].typeName !== typeName) {
        // If there is only on action and it is the type name, don't need to emit the main type alias
        finalLines.push(
            `export type ${typeName} = ${actionSchemas.map((actionInfo) => actionInfo.typeName).join("|")};`,
        );
    }

    for (const key of keys) {
        finalLines.push(...emitted.get(key)!);
    }
    return finalLines.join("\n");
}
