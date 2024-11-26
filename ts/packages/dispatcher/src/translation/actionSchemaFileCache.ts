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
    private readonly cache = new Map<string, CacheEntry>();
    private readonly prevSaved = new Map<string, CacheEntry>();
    public constructor(private readonly cacheFilePath?: string) {
        if (cacheFilePath !== undefined) {
            try {
                const data = fs.readFileSync(cacheFilePath, "utf-8");
                const entries = JSON.parse(data) as [string, CacheEntry][];
                for (const [key, entry] of entries) {
                    this.prevSaved.set(key, entry);
                }
            } catch (e) {
                // Ignore errors
            }
        }
    }

    public getActionSchemaFile(actionConfig: ActionConfig): ActionSchemaFile {
        const schemaFileFullPath = getPackageFilePath(actionConfig.schemaFile);
        const source = fs.readFileSync(schemaFileFullPath, "utf-8");
        const hash = hashString(source);
        const key = `${actionConfig.schemaName}|${actionConfig.schemaType}|${schemaFileFullPath}`;
        const cached = this.cache.get(key);
        if (cached !== undefined && cached.hash === hash) {
            return cached.actionSchemaFile;
        }

        const lastCached = this.prevSaved.get(key);
        if (lastCached !== undefined && lastCached.hash === hash) {
            this.prevSaved.delete(key);
            this.cache.set(key, lastCached);
            this.saveCache();
            return lastCached.actionSchemaFile;
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

        this.saveCache();
        return actionSchemaFile;
    }

    private saveCache() {
        if (this.cacheFilePath === undefined) {
            return;
        }
        fs.writeFileSync(
            this.cacheFilePath,
            JSON.stringify(Array.from(this.cache.entries())),
            "utf-8",
        );
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
