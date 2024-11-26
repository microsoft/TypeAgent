// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionSchemaFile,
    ActionSchemaTypeDefinition,
    parseActionSchemaFile,
} from "action-schema";
import { ActionConfig, ActionConfigProvider } from "./agentTranslators.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { AppAction } from "@typeagent/agent-sdk";
import { DeepPartialUndefined } from "common-utils";

// Global Cache
const translatorNameToActionInfo = new Map<string, ActionSchemaFile>();

export function getActionSchemaFile(
    actionConfig: ActionConfig,
): ActionSchemaFile {
    const schemaFileFullPath = getPackageFilePath(actionConfig.schemaFile);
    const key = `${actionConfig.schemaName}|${actionConfig.schemaType}|${schemaFileFullPath}`;
    if (translatorNameToActionInfo.has(key)) {
        return translatorNameToActionInfo.get(key)!;
    }
    const actionSchemaFile = parseActionSchemaFile(
        schemaFileFullPath,
        actionConfig.schemaName,
        actionConfig.schemaType,
    );
    translatorNameToActionInfo.set(key, actionSchemaFile);
    return actionSchemaFile;
}

export function getActionSchema(
    action: DeepPartialUndefined<AppAction>,
    provider: ActionConfigProvider,
): ActionSchemaTypeDefinition | undefined {
    const { translatorName, actionName } = action;
    if (translatorName === undefined || actionName === undefined) {
        return undefined;
    }
    const config = provider.tryGetActionConfig(translatorName);
    if (config === undefined) {
        return undefined;
    }

    const actionSchemaFile = getActionSchemaFile(config);
    return actionSchemaFile.actionSchemas.get(actionName);
}
