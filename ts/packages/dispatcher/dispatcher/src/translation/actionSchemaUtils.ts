// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionParamObject, ActionSchemaTypeDefinition } from "action-schema";
import { ActionSchemaFile } from "./actionConfigProvider.js";

export function getActionSchema(
    actionSchemaFile: ActionSchemaFile,
    actionName: string,
) {
    const schema =
        actionSchemaFile.parsedActionSchema.actionSchemas.get(actionName);

    if (schema === undefined) {
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
