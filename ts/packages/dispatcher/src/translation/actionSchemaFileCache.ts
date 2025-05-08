// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ParsedActionSchemaJSON,
    ActionSchemaTypeDefinition,
    fromJSONParsedActionSchema,
    parseActionSchemaSource,
    SchemaConfig,
    toJSONParsedActionSchema,
} from "action-schema";
import { ActionConfig } from "./actionConfig.js";
import {
    ActionConfigProvider,
    ActionSchemaFile,
} from "./actionConfigProvider.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { AppAction, SchemaFormat, SchemaTypeNames } from "@typeagent/agent-sdk";
import { DeepPartialUndefined, simpleStarRegex } from "common-utils";
import fs from "node:fs";
import crypto from "node:crypto";
import registerDebug from "debug";
import { readSchemaConfig } from "../utils/loadSchemaConfig.js";
import { SchemaInfoProvider } from "agent-cache";
import {
    getActionSchemaTypeName,
    getActivitySchemaTypeName,
    getCombinedSchemaTypeName,
} from "./agentTranslators.js";

const debug = registerDebug("typeagent:dispatcher:schema:cache");
const debugError = registerDebug("typeagent:dispatcher:schema:cache:error");
function hashStrings(...str: string[]) {
    const hash = crypto.createHash("sha256");
    for (const s of str) {
        hash.update(s);
    }
    return hash.digest("base64");
}

const ActionSchemaFileCacheVersion = 3;

type ActionSchemaFileJSON = {
    schemaName: string;
    sourceHash: string;
    parsedActionSchema: ParsedActionSchemaJSON;
};

type ActionSchemaFileCacheJSON = {
    version: number;
    entries: [string, ActionSchemaFileJSON][];
};

function loadParsedActionSchema(
    schemaName: string,
    schemaType: string | SchemaTypeNames,
    sourceHash: string,
    source: string,
): ActionSchemaFile {
    try {
        if (!source) {
            throw new Error("No data");
        }
        const parsedActionSchemaJSON = JSON.parse(
            source,
        ) as ParsedActionSchemaJSON;
        // TODO: validate the json
        const parsedActionSchema = fromJSONParsedActionSchema(
            parsedActionSchemaJSON,
        );
        const actionTypeName = getActionSchemaTypeName(schemaType);
        if (parsedActionSchema.entry.action?.name !== actionTypeName) {
            throw new Error(
                `Schema type mismatch: actual: ${parsedActionSchema.entry.action?.name}, expected:${actionTypeName}`,
            );
        }
        const activityTypeName = getActivitySchemaTypeName(schemaType);
        if (parsedActionSchema.entry.activity?.name !== activityTypeName) {
            throw new Error(
                `Schema type mismatch: actual: ${parsedActionSchema.entry.action?.name}, expected:${activityTypeName}`,
            );
        }
        return {
            schemaName,
            sourceHash,
            parsedActionSchema,
        };
    } catch (e: any) {
        throw new Error(
            `Failed to load parsed action schema '${schemaName}': ${e.message}`,
        );
    }
}

function loadCachedActionSchemaFile(
    record: ActionSchemaFileJSON,
): ActionSchemaFile | undefined {
    try {
        return {
            schemaName: record.schemaName,
            sourceHash: record.sourceHash,
            parsedActionSchema: fromJSONParsedActionSchema(
                record.parsedActionSchema,
            ),
        };
    } catch (e: any) {
        debugError(
            `Failed to load cached action schema '${record.schemaName}': ${e.message}`,
        );
        return undefined;
    }
}

function saveActionSchemaFile(
    actionSchemaFile: ActionSchemaFile,
): ActionSchemaFileJSON {
    return {
        schemaName: actionSchemaFile.schemaName,
        sourceHash: actionSchemaFile.sourceHash,
        parsedActionSchema: toJSONParsedActionSchema(
            actionSchemaFile.parsedActionSchema,
        ),
    };
}

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
        format: SchemaFormat;
    } {
        if (typeof actionConfig.schemaFile === "string") {
            const fullPath = getPackageFilePath(actionConfig.schemaFile);
            const source = fs.readFileSync(fullPath, "utf-8");
            const config = readSchemaConfig(fullPath);
            return {
                fullPath,
                source,
                config,
                format: actionConfig.schemaFile.endsWith(".pas.json")
                    ? "pas"
                    : "ts",
            };
        }
        if (
            actionConfig.schemaFile.format === "ts" ||
            actionConfig.schemaFile.format === "pas"
        ) {
            return {
                source: actionConfig.schemaFile.content,
                config: undefined,
                fullPath: undefined,
                format: actionConfig.schemaFile.format,
            };
        }
        throw new Error(
            `Unsupported schema source type ${actionConfig.schemaFile.format}`,
        );
    }
    public getActionSchemaFile(actionConfig: ActionConfig): ActionSchemaFile {
        const actionSchemaFile = this.actionSchemaFiles.get(
            actionConfig.schemaName,
        );
        if (actionSchemaFile !== undefined) {
            return actionSchemaFile;
        }

        const { source, config, fullPath, format } =
            this.getSchemaSource(actionConfig);

        const hash = config ? hashStrings(source, config) : hashStrings(source);
        const typeKey = getCombinedSchemaTypeName(actionConfig.schemaType);

        const cacheKey = `${format}|${actionConfig.schemaName}|${typeKey}|${fullPath ?? ""}`;

        const lastCached = this.prevSaved.get(cacheKey);
        if (lastCached !== undefined) {
            this.prevSaved.delete(cacheKey);
            if (lastCached.sourceHash === hash) {
                debug(`Cached action schema used: ${actionConfig.schemaName}`);
                const cached = loadCachedActionSchemaFile(lastCached);
                if (cached !== undefined) {
                    // Add and save the cache first before convert it back (which will modify the data)
                    this.addToCache(cacheKey, lastCached);
                    this.actionSchemaFiles.set(actionConfig.schemaName, cached);
                    return cached;
                }
            } else {
                debugError(
                    `Cached action schema hash mismatch: ${actionConfig.schemaName}`,
                );
            }
        }

        const schemaConfig: SchemaConfig | undefined = config
            ? JSON.parse(config)
            : undefined;
        const parsed: ActionSchemaFile =
            format === "pas"
                ? loadParsedActionSchema(
                      actionConfig.schemaName,
                      actionConfig.schemaType,
                      hash,
                      source,
                  )
                : {
                      schemaName: actionConfig.schemaName,
                      sourceHash: hash,
                      parsedActionSchema: parseActionSchemaSource(
                          source,
                          actionConfig.schemaName,
                          actionConfig.schemaType,
                          fullPath,
                          schemaConfig,
                          true,
                      ),
                  };
        this.actionSchemaFiles.set(actionConfig.schemaName, parsed);

        if (this.cacheFilePath !== undefined) {
            this.addToCache(cacheKey, saveActionSchemaFile(parsed));
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
    return actionSchemaFile.parsedActionSchema.actionSchemas.get(actionName);
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
            getActionSchemaFile(
                schemaName,
            ).parsedActionSchema.actionSchemas.get(actionName);
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
            getActionSchemaFile(schemaName).parsedActionSchema.actionNamespace,
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
