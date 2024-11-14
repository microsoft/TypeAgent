// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionParamType,
    ActionSchema,
    ActionParamObjectFields,
    ActionParamTypeReference,
    ActionTypeDefinition,
} from "./type.js";

function generateSchemaType(
    type: ActionParamType,
    pending: ActionParamTypeReference[],
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
            pending.push(type);
            return type.name;

        default:
            return type.type;
    }
}

function generateSchemaParamObject(
    lines: string[],
    fields: ActionParamObjectFields,
    pending: ActionParamTypeReference[],
    indent: number,
) {
    const indentStr = "    ".repeat(indent);
    for (const [key, field] of Object.entries(fields)) {
        const optional = field.optional ? "?" : "";
        if (field.comments) {
            lines.push(
                ...field.comments.map((comment) => `${indentStr}// ${comment}`),
            );
        }
        lines.push(
            `${indentStr}${key}${optional}: ${generateSchemaType(field.type, pending, indent)}`,
        );
    }
}

function generateTypeDefinition(
    lines: string[],
    definition: ActionTypeDefinition,
    pending: ActionParamTypeReference[],
) {
    if (definition.comments) {
        lines.push(...definition.comments.map((comment) => `// ${comment}`));
    }
    const prefix = definition.alias
        ? `export type ${definition.name} = `
        : `export interface ${definition.name} `;
    lines.push(`${prefix}${generateSchemaType(definition.type, pending, 0)}`);
}

export function generateSchema(actionSchemas: ActionSchema[]) {
    const lines: string[] = [];

    lines.push(
        `export type AllAction = ${actionSchemas.map((actionInfo) => actionInfo.typeName).join("|")};`,
    );

    const pending: ActionParamTypeReference[] = [];
    for (const actionInfo of actionSchemas) {
        generateTypeDefinition(lines, actionInfo.definition, pending);
    }

    while (pending.length > 0) {
        generateTypeDefinition(lines, pending.pop()!.definition, pending);
    }
    return lines.join("\n");
}
