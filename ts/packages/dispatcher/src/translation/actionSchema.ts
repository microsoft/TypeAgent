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

export function getTranslatorActionSchemas(
    translatorConfig: ActionConfig,
    translatorName: string,
): ActionSchemaFile {
    if (translatorNameToActionInfo.has(translatorName)) {
        return translatorNameToActionInfo.get(translatorName)!;
    }
    const actionSchemaFile = parseActionSchemaFile(
        getPackageFilePath(translatorConfig.schemaFile),
        translatorName,
        translatorConfig.schemaType,
    );
    translatorNameToActionInfo.set(translatorName, actionSchemaFile);
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
    const config = provider.tryGetTranslatorConfig(translatorName);
    if (config === undefined) {
        return undefined;
    }

    const actionSchemaFile = getTranslatorActionSchemas(config, translatorName);
    return actionSchemaFile.actionSchemaMap.get(actionName);
}
