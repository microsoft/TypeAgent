// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { YAMLParameterDefinition } from "./types.mjs";

export function generateIntentSchema(
    actionName: string,
    parameters: Record<string, YAMLParameterDefinition>,
): string {
    const paramFields = Object.entries(parameters)
        .map(([name, param]) => {
            const optionalMarker = param.required ? "" : "?";
            const comment = param.description
                ? `//${param.description}\n        `
                : "";
            let typeStr = param.type;
            if (param.type === "array" && param.itemType) {
                typeStr = `${param.itemType}[]`;
            }
            return `${comment}${name}${optionalMarker}: ${typeStr};`;
        })
        .join("\n        ");

    return `export type ${actionName} = {
    actionName: "${actionName}";
    parameters: {
        ${paramFields}
    };
};`;
}

export function generateActionSchemaDefinition(
    actionName: string,
    parameters: Record<string, YAMLParameterDefinition>,
): any {
    const pascalCaseName =
        actionName.charAt(0).toUpperCase() + actionName.slice(1);

    const parameterFields: any = {};
    for (const [name, param] of Object.entries(parameters)) {
        let typeDefinition: any = { type: param.type };

        if (param.type === "array" && param.itemType) {
            typeDefinition = {
                type: "array",
                elementType: { type: param.itemType },
            };
        }

        parameterFields[name] = {
            type: typeDefinition,
            optional: !param.required,
            ...(param.description && { comments: [param.description] }),
        };
    }

    const hasParameters = Object.keys(parameters).length > 0;

    const fields: any = {
        actionName: {
            type: {
                type: "string-union",
                typeEnum: [actionName],
            },
            optional: false,
        },
    };

    if (hasParameters) {
        fields.parameters = {
            type: {
                type: "object",
                fields: parameterFields,
            },
            optional: false,
        };
    }

    return {
        alias: true,
        name: pascalCaseName,
        type: {
            type: "object",
            fields,
        },
        exported: true,
    };
}

export function generateIntentJson(
    actionName: string,
    parameters: Record<string, YAMLParameterDefinition>,
): any {
    const paramArray = Object.entries(parameters).map(([shortName, param]) => ({
        shortName,
        name: param.description || shortName,
        description: param.description,
        type: param.type === "array" ? "array" : param.type,
        required: param.required,
        defaultValue: param.default,
        valueOptions: param.options,
        ...(param.itemType && { itemType: param.itemType }),
    }));

    return {
        actionName,
        parameters: paramArray,
    };
}
