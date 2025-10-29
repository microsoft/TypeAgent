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

export function convertStepsToYAML(
    steps: any[],
    intentParameters?: ParsedParameter[],
): YAMLMacroStep[] {
    return steps.map((step, index) => {
        if (!step.actionName || typeof step.actionName !== "string") {
            throw new Error(
                `Invalid step at index ${index}: missing or invalid actionName. ` +
                    `Description: "${step.description || "none"}". ` +
                    `Step data: ${JSON.stringify(step)}`,
            );
        }

        const yamlStep: YAMLMacroStep = {
            action: step.actionName,
            ...(step.description && { description: step.description }),
        };

        if (step.parameters) {
            const processedParams: Record<string, any> = {};

            for (const [key, value] of Object.entries(step.parameters)) {
                if (
                    intentParameters &&
                    (key === "valueTextParameter" ||
                        key === "textParameter" ||
                        key === "valueParameter" ||
                        key === "itemsParameter")
                ) {
                    const matchingParam = intentParameters.find(
                        (p) => p.defaultValue === value,
                    );

                    if (matchingParam) {
                        processedParams[key] = matchingParam.shortName;
                    } else {
                        processedParams[key] = value;
                    }
                } else {
                    processedParams[key] = value;
                }
            }

            yamlStep.parameters = processedParams;
        }

        if (step.items) {
            yamlStep.items = step.items;
        }

        if (step.as) {
            yamlStep.as = step.as;
        }

        if (step.do) {
            yamlStep.do = convertStepsToYAML(step.do, intentParameters);
        }

        if (step.condition) {
            yamlStep.condition = step.condition;
        }

        if (step.then) {
            yamlStep.then = convertStepsToYAML(step.then, intentParameters);
        }

        if (step.else) {
            yamlStep.else = convertStepsToYAML(step.else, intentParameters);
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

export function extractParametersFromIntent(
    intentData: any,
): ParsedParameter[] {
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

export function extractUsedParameterNames(steps: YAMLMacroStep[]): Set<string> {
    const usedParams = new Set<string>();

    function scanStep(step: YAMLMacroStep) {
        if (step.parameters) {
            for (const [key, value] of Object.entries(step.parameters)) {
                const str = String(value);

                // Check for {{paramName}} template syntax
                const matches = str.matchAll(/\{\{(\w+)\}\}/g);
                for (const match of matches) {
                    usedParams.add(match[1]);
                }

                // Also check for direct parameter name references in specific fields
                // These fields contain parameter names, not values
                if (
                    key === "valueTextParameter" ||
                    key === "textParameter" ||
                    key === "valueParameter" ||
                    key === "itemsParameter"
                ) {
                    usedParams.add(str);
                }
            }
        }

        if (step.condition) {
            const condStr = String(step.condition);
            const matches = condStr.matchAll(/\{\{(\w+)\}\}/g);
            for (const match of matches) {
                usedParams.add(match[1]);
            }
        }

        if (step.message) {
            const msgStr = String(step.message);
            const matches = msgStr.matchAll(/\{\{(\w+)\}\}/g);
            for (const match of matches) {
                usedParams.add(match[1]);
            }
        }

        if (step.do) step.do.forEach(scanStep);
        if (step.then) step.then.forEach(scanStep);
        if (step.else) step.else.forEach(scanStep);
    }

    steps.forEach(scanStep);
    return usedParams;
}

export function filterUnusedParameters(
    parameters: ParsedParameter[],
    steps: YAMLMacroStep[],
): ParsedParameter[] {
    const usedParamNames = extractUsedParameterNames(steps);
    return parameters.filter((p) => usedParamNames.has(p.shortName));
}
