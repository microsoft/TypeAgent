// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionSchemaFile,
    ActionSchemaFileJSON,
    ActionSchemaTypeDefinition,
    fromJSONActionSchemaFile,
    generateSchemaTypeDefinition,
    parseActionSchemaSource,
    SchemaConfig,
    toJSONActionSchemaFile,
} from "action-schema";
import { ActionConfig, ActionConfigProvider } from "./agentTranslators.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { AppAction } from "@typeagent/agent-sdk";
import { DeepPartialUndefined, simpleStarRegex } from "common-utils";
import fs from "node:fs";
import crypto from "node:crypto";
import registerDebug from "debug";
import { readSchemaConfig } from "../utils/loadSchemaConfig.js";
import { SchemaInfoProvider } from "agent-cache";

const debug = registerDebug("typeagent:dispatcher:schema:cache");
const debugError = registerDebug("typeagent:dispatcher:schema:cache:error");
function hashStrings(...str: string[]) {
    const hash = crypto.createHash("sha256");
    for (const s of str) {
        hash.update(s);
    }
    return hash.digest("base64");
}

type CacheEntry = {
    hash: string;
    actionSchemaFile: ActionSchemaFileJSON;
};

export class ActionSchemaFileCache {
    private readonly actionSchemaFiles = new Map<string, ActionSchemaFile>();
    private readonly prevSaved = new Map<string, CacheEntry>();
    public constructor(private readonly cacheFilePath?: string) {
        if (cacheFilePath !== undefined) {
            try {
                const entries = this.loadExistingCache();
                if (entries) {
                    for (const [key, entry] of entries) {
                        this.prevSaved.set(key, entry);
                    }
                    // We will rewrite it.
                    fs.unlinkSync(cacheFilePath);
                }
                debug(`Loaded parsed schema cache: ${cacheFilePath}`);
            } catch (e) {
                debugError(`Failed to load parsed schema cache: ${e}`);
            }
        }
    }

    public getActionSchemaFile(actionConfig: ActionConfig): ActionSchemaFile {
        const actionSchemaFile = this.actionSchemaFiles.get(
            actionConfig.schemaName,
        );
        if (actionSchemaFile !== undefined) {
            return actionSchemaFile;
        }

        const schemaFileFullPath = getPackageFilePath(actionConfig.schemaFile);
        const source = fs.readFileSync(schemaFileFullPath, "utf-8");
        const config = readSchemaConfig(schemaFileFullPath);

        const hash = config ? hashStrings(source, config) : hashStrings(source);
        const cacheKey = `${actionConfig.schemaName}|${actionConfig.schemaType}|${schemaFileFullPath}`;

        const lastCached = this.prevSaved.get(cacheKey);
        if (lastCached !== undefined) {
            this.prevSaved.delete(cacheKey);
            if (lastCached.hash === hash) {
                debug(`Cached parsed schema used: ${actionConfig.schemaName}`);
                // Add and save the cache first before convert it back (which will modify the data)
                this.addToCache(cacheKey, hash, lastCached.actionSchemaFile);
                const cached = fromJSONActionSchemaFile(
                    lastCached.actionSchemaFile,
                );
                this.actionSchemaFiles.set(actionConfig.schemaName, cached);
                return cached;
            }
            debugError(
                `Cached parsed schema hash mismatch: ${actionConfig.schemaName}`,
            );
        }

        const schemaConfig: SchemaConfig | undefined = config
            ? JSON.parse(config)
            : undefined;
        const parsed = parseActionSchemaSource(
            source,
            actionConfig.schemaName,
            actionConfig.schemaType,
            schemaFileFullPath,
            schemaConfig,
        );
        this.actionSchemaFiles.set(actionConfig.schemaName, parsed);

        if (this.cacheFilePath !== undefined) {
            this.addToCache(cacheKey, hash, toJSONActionSchemaFile(parsed));
        }
        return parsed;
    }

    private addToCache(
        key: string,
        hash: string,
        actionSchemaFile: ActionSchemaFileJSON,
    ) {
        if (this.cacheFilePath === undefined) {
            return;
        }

        try {
            const entries = this.loadExistingCache() ?? [];
            entries.push([key, { hash, actionSchemaFile }]);
            fs.writeFileSync(
                this.cacheFilePath,
                JSON.stringify(entries),
                "utf-8",
            );
        } catch (e: any) {
            // ignore error
            debugError(
                `Failed to write parsed schema cache: ${this.cacheFilePath}: ${e.message}`,
            );
        }
    }

    private loadExistingCache() {
        try {
            if (this.cacheFilePath) {
                const data = fs.readFileSync(this.cacheFilePath, "utf-8");
                return JSON.parse(data) as [string, CacheEntry][];
            }
        } catch {}
        return undefined;
    }
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

    const actionSchemaFile = provider.getActionSchemaFileForConfig(config);
    return actionSchemaFile.actionSchemas.get(actionName);
}

export function createSchemaInfoProvider(
    provider: ActionConfigProvider,
): SchemaInfoProvider {
    const hashCache = new Map<string, string>();

    const getActionSchemaFile = (schemaName: string) => {
        return provider.getActionSchemaFileForConfig(
            provider.getActionConfig(schemaName),
        );
    };

    const getActionSchema = (schemaName: string, actionName: string) => {
        const actionSchema =
            getActionSchemaFile(schemaName).actionSchemas.get(actionName);
        if (actionSchema === undefined) {
            throw new Error(
                `Invalid action name ${actionName} for schema ${schemaName}`,
            );
        }
        return actionSchema;
    };
    const result: SchemaInfoProvider = {
        getActionNamespace: (schemaName) =>
            getActionSchemaFile(schemaName).actionNamespace,
        getActionCacheEnabled: (schemaName, actionName) => {
            return getActionSchema(schemaName, actionName).paramSpecs !== false;
        },
        getActionParamSpec: (schemaName, actionName, paramName: string) => {
            const paramSpecs = getActionSchema(
                schemaName,
                actionName,
            ).paramSpecs;
            if (typeof paramSpecs !== "object") {
                return undefined;
            }

            for (const [key, value] of Object.entries(paramSpecs)) {
                if (key.includes("*")) {
                    const regex = simpleStarRegex(key);
                    if (regex.test(paramName)) {
                        return value;
                    }
                } else if (key === paramName) {
                    return value;
                }
            }
        },
        getActionSchemaHash: (schemaName, actionName) => {
            const key = `${schemaName}.${actionName}`;
            const existing = hashCache.get(key);
            if (existing) {
                return existing;
            }
            const actionSchema = getActionSchema(schemaName, actionName);
            const hashSource = [generateSchemaTypeDefinition(actionSchema)];
            if (actionSchema.paramSpecs) {
                hashSource.push(JSON.stringify(actionSchema.paramSpecs));
            }
            const hash = hashStrings(...hashSource);
            hashCache.set(key, hash);
            return hash;
        },
    };
    return result;
}
