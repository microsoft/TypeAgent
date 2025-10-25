// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { YAMLParameterDefinition, YAMLMacroStep } from "./types.mjs";

export interface ParsedParameter {
    shortName: string;
    description: string;
    type: string;
    required: boolean;
    defaultValue?: any;
    valueOptions?: string[];
}

export function convertParametersToYAML(
    parameters: ParsedParameter[],
): Record<string, YAMLParameterDefinition> {
    const yamlParams: Record<string, YAMLParameterDefinition> = {};

    for (const param of parameters) {
        yamlParams[param.shortName] = {
            type: param.type,
            description: param.description,
            required: param.required,
            ...(param.defaultValue !== undefined && {
                default: param.defaultValue,
            }),
            ...(param.valueOptions && { options: param.valueOptions }),
        };
    }

    return yamlParams;
}

export function convertStepsToYAML(steps: any[]): YAMLMacroStep[] {
    return steps.map((step) => {
        const yamlStep: YAMLMacroStep = {
            action: step.actionName,
            ...(step.description && { description: step.description }),
            ...(step.parameters && { parameters: step.parameters }),
        };

        if (step.items) {
            yamlStep.items = step.items;
        }

        if (step.as) {
            yamlStep.as = step.as;
        }

        if (step.do) {
            yamlStep.do = convertStepsToYAML(step.do);
        }

        if (step.condition) {
            yamlStep.condition = step.condition;
        }

        if (step.then) {
            yamlStep.then = convertStepsToYAML(step.then);
        }

        if (step.else) {
            yamlStep.else = convertStepsToYAML(step.else);
        }

        if (step.outputs) {
            yamlStep.outputs = step.outputs;
        }

        if (step.message) {
            yamlStep.message = step.message;
        }

        return yamlStep;
    });
}

export function extractParametersFromIntent(intentData: any): ParsedParameter[] {
    const parameters: ParsedParameter[] = [];

    if (!intentData.parameters) {
        return parameters;
    }

    if (Array.isArray(intentData.parameters)) {
        for (const param of intentData.parameters) {
            parameters.push({
                shortName: param.shortName || param.name || "unknown",
                description: param.description || param.name || "Parameter",
                type:
                    param.type === "string" ||
                    param.type === "number" ||
                    param.type === "boolean"
                        ? param.type
                        : "string",
                required: param.required ?? false,
                defaultValue: param.defaultValue,
                valueOptions: param.valueOptions,
            });
        }
    } else if (typeof intentData.parameters === "object") {
        for (const [key, value] of Object.entries(intentData.parameters)) {
            parameters.push({
                shortName: key,
                description: `Parameter ${key}`,
                type:
                    typeof value === "string" ||
                    typeof value === "number" ||
                    typeof value === "boolean"
                        ? typeof value
                        : "string",
                required: false,
                defaultValue: value,
            });
        }
    }

    return parameters;
}

export function generateMacroId(): string {
    return (
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15)
    );
}
