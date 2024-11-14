// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionSchema, parseActionSchemaFile } from "action-schema";
import {
    TranslatorConfig,
    TranslatorConfigProvider,
} from "./agentTranslators.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { AppAction } from "@typeagent/agent-sdk";
import { DeepPartialUndefined } from "common-utils";

// Global Cache
const translatorNameToActionInfo = new Map<string, Map<string, ActionSchema>>();

export function getTranslatorActionSchemas(
    translatorConfig: TranslatorConfig,
    translatorName: string,
): Map<string, ActionSchema> {
    if (translatorNameToActionInfo.has(translatorName)) {
        return translatorNameToActionInfo.get(translatorName)!;
    }
    const actionInfo = new Map<string, ActionSchema>(
        parseActionSchemaFile(
            getPackageFilePath(translatorConfig.schemaFile),
            translatorName,
            translatorConfig.schemaType,
        ).map((a) => [a.actionName, a]),
    );
    translatorNameToActionInfo.set(translatorName, actionInfo);
    return actionInfo;
}

export function getActionSchema(
    action: DeepPartialUndefined<AppAction>,
    provider: TranslatorConfigProvider,
) {
    const { translatorName, actionName } = action;
    if (translatorName === undefined || actionName === undefined) {
        return undefined;
    }
    const config = provider.tryGetTranslatorConfig(translatorName);
    if (config === undefined) {
        return undefined;
    }

    const actionInfos = getTranslatorActionSchemas(config, translatorName);
    return actionInfos.get(actionName);
}
