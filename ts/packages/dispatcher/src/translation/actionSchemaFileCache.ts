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
import fs from "node:fs";
import crypto from "node:crypto";

function hashString(str: string) {
    return crypto.createHash("sha256").update(str).digest("base64");
}

type CacheEntry = {
    hash: string;
    actionSchemaFile: ActionSchemaFile;
};
export class ActionSchemaFileCache {
    private cache = new Map<string, CacheEntry>();
    public getActionSchemaFile(actionConfig: ActionConfig): ActionSchemaFile {
        const schemaFileFullPath = getPackageFilePath(actionConfig.schemaFile);
        const source = fs.readFileSync(schemaFileFullPath, "utf-8");
        const hash = hashString(source);
        const key = `${actionConfig.schemaName}|${actionConfig.schemaType}|${schemaFileFullPath}`;
        const cached = this.cache.get(key);
        if (cached !== undefined && cached.hash === hash) {
            return cached.actionSchemaFile;
        }
        const actionSchemaFile = parseActionSchemaFile(
            schemaFileFullPath,
            actionConfig.schemaName,
            actionConfig.schemaType,
        );
        this.cache.set(key, {
            hash,
            actionSchemaFile,
        });
        return actionSchemaFile;
    }
}

const globalCache = new ActionSchemaFileCache();
export function getActionSchemaFileForConfig(
    actionConfig: ActionConfig,
    provider: ActionConfigProvider,
): ActionSchemaFile {
    if (provider.getActionSchemaFileForConfig !== undefined) {
        return provider.getActionSchemaFileForConfig(actionConfig);
    }
    return globalCache.getActionSchemaFile(actionConfig);
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

    const actionSchemaFile = getActionSchemaFileForConfig(config, provider);
    return actionSchemaFile.actionSchemas.get(actionName);
}
