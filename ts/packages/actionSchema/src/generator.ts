// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionParamType,
    ActionSchema,
    ActionParamObjectFields,
} from "./type.js";

function generateSchemaType(
    type: ActionParamType,
    indent: string,
    paren: boolean = false,
): string {
    switch (type.type) {
        case "object":
            const lines: string[] = [];
            generateSchemaParamObject(lines, type.fields, `${indent}    `);
            return `{\n${lines.join("\n")}\n${indent}}`;
        case "array":
            return `${generateSchemaType(type.elementType, indent, true)}[]`;
        case "string-union":
            const union = type.typeEnum.map((v) => `"${v}"`).join(" | ");
            return paren ? `(${union})` : union;
        default:
            return type.type;
    }
}

function generateSchemaParamObject(
    lines: string[],
    fields: ActionParamObjectFields,
    indent: string,
) {
    for (const [key, field] of Object.entries(fields)) {
        const optional = field.optional ? "?" : "";
        lines.push(
            `${indent}${key}${optional}: ${generateSchemaType(field.type, indent)}`,
        );
    }
}

export function generateSchema(actionSchemas: ActionSchema[]) {
    const lines: string[] = [];

    lines.push(
        `export type AllAction = ${actionSchemas.map((actionInfo) => actionInfo.typeName).join("|")};`,
    );

    for (const actionInfo of actionSchemas) {
        if (actionInfo.comments) {
            lines.push(
                actionInfo.comments
                    .map((comment) => `// ${comment}`)
                    .join("\n"),
            );
        }

        lines.push(`export interface ${actionInfo.typeName} {`);
        lines.push(`    actionName: "${actionInfo.actionName}";`);
        if (actionInfo.parameters) {
            lines.push(
                `    parameters: ${generateSchemaType(actionInfo.parameters, "    ")};`,
            );
        }
        lines.push("}");
    }

    return lines.join("\n");
}
