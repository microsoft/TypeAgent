// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionParamObject,
    ActionSchemaTypeDefinition,
} from "@typeagent/action-schema";
import { ActionSchemaFile } from "./actionConfigProvider.js";
import registerDebug from "debug";

const debugSchema = registerDebug("typeagent:dispatcher:schema");

export function getActionSchema(
    actionSchemaFile: ActionSchemaFile,
    actionName: string,
) {
    const schema =
        actionSchemaFile.parsedActionSchema.actionSchemas.get(actionName);

    if (schema === undefined) {
        debugSchema(
            `Action schema not found: ${actionSchemaFile.schemaName}.${actionName}. Available actions: [${[...actionSchemaFile.parsedActionSchema.actionSchemas.keys()].join(", ")}]`,
        );
        throw new Error(
            `Action schema not found for ${actionSchemaFile.schemaName}.${actionName}`,
        );
    }
    return schema;
}

export function getActionSchemaParameterType(
    actionSchemaFile: ActionSchemaFile,
    actionName: string,
    schema: ActionSchemaTypeDefinition,
) {
    const actionParametersType = schema.type.fields.parameters?.type;
    if (actionParametersType?.type !== "object") {
        const fieldNames = Object.keys(schema.type.fields);
        debugSchema(
            `Parameter type mismatch for ${actionSchemaFile.schemaName}.${actionName}: ` +
                `parameters field type is '${actionParametersType?.type ?? "undefined"}', ` +
                `available fields: [${fieldNames.join(", ")}]`,
        );
        throw new Error(
            `Action schema parameter type mismatch: ${actionSchemaFile.schemaName}.${actionName}`,
        );
    }
    return actionParametersType;
}

export function getActionParametersType(
    actionSchemaFile: ActionSchemaFile,
    actionName: string,
): ActionParamObject {
    const schema = getActionSchema(actionSchemaFile, actionName);
    return getActionSchemaParameterType(actionSchemaFile, actionName, schema);
}

export function tryGetActionSchemaParameterType(
    actionSchemaFile: ActionSchemaFile,
    actionName: string,
    schema: ActionSchemaTypeDefinition,
): ActionParamObject | undefined {
    const actionParametersType = schema.type.fields.parameters?.type;
    if (actionParametersType?.type !== "object") {
        debugSchema(
            `Action ${actionSchemaFile.schemaName}.${actionName} has no object parameters field (type: '${actionParametersType?.type ?? "undefined"}')`,
        );
        return undefined;
    }
    return actionParametersType;
}

export function tryGetActionParametersType(
    actionSchemaFile: ActionSchemaFile,
    actionName: string,
): ActionParamObject | undefined {
    const schema = getActionSchema(actionSchemaFile, actionName);
    return tryGetActionSchemaParameterType(
        actionSchemaFile,
        actionName,
        schema,
    );
}
