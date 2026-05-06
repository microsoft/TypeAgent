// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WorkflowIR } from "workflow-model";

/**
 * Convert a workflow name to a PascalCase TypeScript type name.
 * "d1-standup-prep" -> "D1StandupPrepAction"
 */
export function toTypeName(name: string): string {
    const pascal = name
        .split(/[-_]+/)
        .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
        .join("");
    return pascal + "Action";
}

/**
 * Map a JSON Schema property to a TypeScript type string.
 */
function jsonSchemaTypeToTS(prop: Record<string, unknown>): string {
    const type = prop["type"] as string | undefined;
    switch (type) {
        case "string":
            return "string";
        case "number":
        case "integer":
            return "number";
        case "boolean":
            return "boolean";
        case "array": {
            const items = prop["items"] as Record<string, unknown> | undefined;
            if (items) {
                return `${jsonSchemaTypeToTS(items)}[]`;
            }
            return "unknown[]";
        }
        case "object":
            return "Record<string, unknown>";
        default:
            return "unknown";
    }
}

/**
 * Generate a single action type definition for a workflow.
 */
function generateActionType(ir: WorkflowIR): string {
    const typeName = toTypeName(ir.name);
    const lines: string[] = [];

    if (ir.description) {
        lines.push(`// ${ir.description}`);
    }
    lines.push(`export type ${typeName} = {`);
    lines.push(`    actionName: "${ir.name}";`);

    const schema = ir.inputSchema as Record<string, unknown>;
    const properties = schema["properties"] as
        | Record<string, Record<string, unknown>>
        | undefined;
    const required = (schema["required"] as string[]) ?? [];

    if (properties && Object.keys(properties).length > 0) {
        lines.push("    parameters: {");
        for (const [propName, propSchema] of Object.entries(properties)) {
            if (propSchema["description"]) {
                lines.push(`        // ${propSchema["description"]}`);
            }
            const opt = required.includes(propName) ? "" : "?";
            const tsType = jsonSchemaTypeToTS(propSchema);
            lines.push(`        ${propName}${opt}: ${tsType};`);
        }
        lines.push("    };");
    }

    lines.push("};");
    return lines.join("\n");
}

/**
 * Generate the full dynamic schema TypeScript source text from
 * discovered workflows. This is returned by getDynamicSchema().
 */
export function generateDynamicSchemaText(
    workflows: Map<string, WorkflowIR>,
): string {
    if (workflows.size === 0) {
        return [
            "// No workflows discovered.",
            "export type WorkflowAction = {",
            '    actionName: "noWorkflowsLoaded";',
            "};",
            "",
        ].join("\n");
    }

    const lines: string[] = [];
    const typeNames: string[] = [];

    for (const ir of workflows.values()) {
        lines.push(generateActionType(ir));
        lines.push("");
        typeNames.push(toTypeName(ir.name));
    }

    lines.push("export type WorkflowAction =");
    for (let i = 0; i < typeNames.length; i++) {
        const sep = i === typeNames.length - 1 ? ";" : "";
        lines.push(`    | ${typeNames[i]}${sep}`);
    }
    lines.push("");

    return lines.join("\n");
}
