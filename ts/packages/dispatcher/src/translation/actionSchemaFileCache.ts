// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionSchemaFile,
    ActionSchemaFileJSON,
    ActionSchemaTypeDefinition,
    fromJSONActionSchemaFile,
    parseActionSchemaSource,
    SchemaConfig,
    toJSONActionSchemaFile,
} from "action-schema";
import { ActionConfig } from "./actionConfig.js";
import { ActionConfigProvider } from "./actionConfigProvider.js";
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

const ActionSchemaFileCacheVersion = 2;
type ActionSchemaFileCacheJSON = {
    version: number;
    entries: [string, ActionSchemaFileJSON][];
};

export class ActionSchemaFileCache {
    private readonly actionSchemaFiles = new Map<string, ActionSchemaFile>();
    private readonly prevSaved = new Map<string, ActionSchemaFileJSON>();
    public constructor(private readonly cacheFilePath?: string) {
        if (cacheFilePath !== undefined) {
            try {
                const cache = this.loadExistingCache();
                if (cache) {
                    for (const [key, entry] of cache.entries) {
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

    private getSchemaSource(actionConfig: ActionConfig): {
        source: string;
        config: string | undefined;
        fullPath: string | undefined;
    } {
        if (typeof actionConfig.schemaFile === "string") {
            const fullPath = getPackageFilePath(actionConfig.schemaFile);
            const source = fs.readFileSync(fullPath, "utf-8");
            const config = readSchemaConfig(fullPath);
            return { fullPath, source, config };
        }
        if (actionConfig.schemaFile.type === "ts") {
            return {
                source: actionConfig.schemaFile.content,
                config: undefined,
                fullPath: undefined,
            };
        }
        throw new Error(
            `Unsupported schema source type ${actionConfig.schemaFile.type}`,
        );
    }
    public getActionSchemaFile(actionConfig: ActionConfig): ActionSchemaFile {
        const actionSchemaFile = this.actionSchemaFiles.get(
            actionConfig.schemaName,
        );
        if (actionSchemaFile !== undefined) {
            return actionSchemaFile;
        }

        const { source, config, fullPath } = this.getSchemaSource(actionConfig);
        const hash = config ? hashStrings(source, config) : hashStrings(source);
        const cacheKey = `${actionConfig.schemaName}|${actionConfig.schemaType}|${fullPath ?? ""}`;

        const lastCached = this.prevSaved.get(cacheKey);
        if (lastCached !== undefined) {
            this.prevSaved.delete(cacheKey);
            if (lastCached.sourceHash === hash) {
                debug(`Cached action schema used: ${actionConfig.schemaName}`);
                // Add and save the cache first before convert it back (which will modify the data)
                this.addToCache(cacheKey, lastCached);
                const cached = fromJSONActionSchemaFile(lastCached);
                this.actionSchemaFiles.set(actionConfig.schemaName, cached);
                return cached;
            }
            debugError(
                `Cached action schema hash mismatch: ${actionConfig.schemaName}`,
            );
        }

        const schemaConfig: SchemaConfig | undefined = config
            ? JSON.parse(config)
            : undefined;
        const parsed = parseActionSchemaSource(
            source,
            actionConfig.schemaName,
            hash,
            actionConfig.schemaType,
            fullPath,
            schemaConfig,
            true,
        );
        this.actionSchemaFiles.set(actionConfig.schemaName, parsed);

        if (this.cacheFilePath !== undefined) {
            this.addToCache(cacheKey, toJSONActionSchemaFile(parsed));
        }
        return parsed;
    }

    public unloadActionSchemaFile(schemaName: string) {
        this.actionSchemaFiles.delete(schemaName);
    }

    private addToCache(key: string, actionSchemaFile: ActionSchemaFileJSON) {
        if (this.cacheFilePath === undefined) {
            return;
        }

        try {
            const cache = this.loadExistingCache() ?? {
                version: ActionSchemaFileCacheVersion,
                entries: [],
            };
            cache.entries.push([key, actionSchemaFile]);
            fs.writeFileSync(
                this.cacheFilePath,
                JSON.stringify(cache),
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
                const content = JSON.parse(data) as any;
                if (content.version !== ActionSchemaFileCacheVersion) {
                    debugError(
                        `Invalid cache version: ${this.cacheFilePath}: ${content.version}`,
                    );
                    return undefined;
                }
                return content as ActionSchemaFileCacheJSON;
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
        getActionSchemaFileHash: (schemaName) =>
            getActionSchemaFile(schemaName).sourceHash,
        getActionNamespace: (schemaName) =>
            getActionSchemaFile(schemaName).actionNamespace,
        getActionCacheEnabled: (schemaName, actionName) =>
            getActionSchema(schemaName, actionName).paramSpecs !== false,
        getActionParamSpec: (schemaName, actionName, paramName) => {
            const actionSchema = getActionSchema(schemaName, actionName);
            const paramSpecs = actionSchema.paramSpecs;
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
    };
    return result;
}
