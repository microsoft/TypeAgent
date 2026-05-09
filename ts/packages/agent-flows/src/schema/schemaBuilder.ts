// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FlowSchemaEntry } from "../types.js";

export function generateFlowActionTypes(enabledFlows: FlowSchemaEntry[]): {
    typeDefinitions: string;
    typeNames: string[];
} {
    const lines: string[] = [];
    const typeNames: string[] = [];

    for (const entry of enabledFlows) {
        const typeName =
            entry.actionName.charAt(0).toUpperCase() +
            entry.actionName.slice(1) +
            "Action";
        typeNames.push(typeName);

        lines.push("");
        lines.push(`// ${entry.description}`);
        lines.push(`export type ${typeName} = {`);
        lines.push(`    actionName: "${entry.actionName}";`);

        if ((entry.parameters ?? []).length > 0) {
            lines.push("    parameters: {");
            for (const p of entry.parameters ?? []) {
                const tsType =
                    p.type === "number"
                        ? "number"
                        : p.type === "boolean"
                          ? "boolean"
                          : "string";
                const opt = p.required ? "" : "?";
                if (p.description) {
                    lines.push(`        // ${p.description}`);
                }
                const comment = p.valueOptions?.length
                    ? ` // Options: ${p.valueOptions.join(", ")}`
                    : "";
                lines.push(`        ${p.name}${opt}: ${tsType};${comment}`);
            }
            lines.push("    };");
        }

        lines.push("};");
    }

    return { typeDefinitions: lines.join("\n"), typeNames };
}

export function buildUnionType(
    unionName: string,
    typeNames: string[],
): string {
    if (typeNames.length === 0) {
        return `export type ${unionName} = never;`;
    }
    const members = typeNames.map((n) => `    | ${n}`).join("\n");
    return `export type ${unionName} =\n${members};`;
}
