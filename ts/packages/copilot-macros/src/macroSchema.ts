// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CopilotToolMacro } from "./contracts.js";
import {
    parseActionSchemaSource,
    type SchemaType,
} from "@typeagent/action-schema";
import type { RuntimeJsonSchema } from "./recipeContracts.js";

/** Convert only the runtime's closed subset; never discard an action constraint. */
export function getRecipeActionParametersSchema(
    schemaText: string,
    schemaName: string,
    typeName: string,
    actionName: string,
): RuntimeJsonSchema {
    const parsed = parseActionSchemaSource(schemaText, schemaName, typeName);
    const action = parsed.actionSchemas.get(actionName);
    if (!action) throw new Error("Action is absent from its input contract.");
    const convert = (type: SchemaType, depth = 0): RuntimeJsonSchema => {
        if (depth > 32)
            throw new Error("Recursive action input is unsupported.");
        switch (type.type) {
            case "string":
            case "number":
            case "boolean":
                return { type: type.type };
            case "true":
            case "false":
                return { type: "boolean", enum: [type.type === "true"] };
            case "string-union":
                return { type: "string", enum: [...type.typeEnum] };
            case "type-reference":
                if (!type.definition)
                    throw new Error("Unresolved action input reference.");
                return convert(type.definition.type, depth + 1);
            case "array":
                return {
                    type: "array",
                    items: convert(type.elementType, depth + 1),
                };
            case "object":
                return {
                    type: "object",
                    properties: Object.fromEntries(
                        Object.entries(type.fields).map(([name, field]) => [
                            name,
                            convert(field.type, depth + 1),
                        ]),
                    ),
                    required: Object.entries(type.fields)
                        .filter(([, field]) => !field.optional)
                        .map(([name]) => name)
                        .sort(),
                    additionalProperties: false,
                };
            default:
                throw new Error(`Unsupported action input type: ${type.type}.`);
        }
    };
    const parameters = action.type.fields.parameters;
    return parameters
        ? convert(parameters.type)
        : { type: "object", properties: {}, additionalProperties: false };
}

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
