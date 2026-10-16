// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CopilotToolMacro } from "./contracts.js";

export function getMacroActionName(macro: CopilotToolMacro): string {
    return `run_${macro.macroId.replace(/-/g, "_")}_v${macro.version}`;
}

export function getMacroInputSchema(macro: CopilotToolMacro) {
    if (macro.program) {
        if (macro.program.inputSchema.type !== "object")
            throw new Error("Program macro inputs must use an object schema.");
        return macro.program.inputSchema;
    }
    return {
        type: "object",
        properties: Object.fromEntries(
            macro.inputs.map((input) => [
                input.name,
                {
                    description: input.description,
                    ...(input.valueType ? { type: input.valueType } : {}),
                    ...(input.valueType === "object"
                        ? { additionalProperties: true }
                        : {}),
                },
            ]),
        ),
        required: macro.inputs
            .filter((input) => input.required)
            .map((input) => input.name),
        additionalProperties: false,
    };
}
