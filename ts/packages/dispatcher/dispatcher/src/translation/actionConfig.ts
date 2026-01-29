// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionManifest,
    AppAgentManifest,
    SchemaManifest,
    ActivityCacheSpec,
    SchemaContent,
    GrammarContent,
} from "@typeagent/agent-sdk";
import fs from "node:fs";
import registerDebug from "debug";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { readSchemaConfig } from "../utils/loadSchemaConfig.js";
const debugConfig = registerDebug("typeagent:dispatcher:schema:config");

type RuntimeSchemaManifest = Omit<
    SchemaManifest,
    "schemaFile" | "grammarFile"
> & {
    schemaFile: SchemaContent | (() => SchemaContent);
    grammarFile: GrammarContent | (() => GrammarContent) | undefined;
};
// A flatten AppAgentManifest
export type ActionConfig = {
    emojiChar: string;

    // Key is activity name. Default (if not specified) is not cached during activity.
    cachedActivities: Record<string, ActivityCacheSpec> | undefined;

    schemaDefaultEnabled: boolean;
    actionDefaultEnabled: boolean;
    transient: boolean;
    schemaName: string;
    delegatable: boolean;

    // Original schema file path string (for grammar generation)
    schemaFilePath: string | undefined;
} & RuntimeSchemaManifest;

function loadSchemaFile(schemaFile: string): SchemaContent {
    const fullPath = getPackageFilePath(schemaFile);
    const content = fs.readFileSync(fullPath, "utf-8");
    const pas = schemaFile.endsWith(".pas.json");
    const config = pas ? undefined : readSchemaConfig(fullPath);
    return {
        format: pas ? "pas" : "ts",
        content,
        config,
    };
}

function loadGrammarFile(grammarFile: string): GrammarContent {
    const fullPath = getPackageFilePath(grammarFile);
    const isActionGrammar = grammarFile.endsWith(".ag.json");
    if (!isActionGrammar) {
        throw new Error(`Unsupported grammar file extension: ${grammarFile}`);
    }
    const content = fs.readFileSync(fullPath, "utf-8");
    return { format: "ag", content };
}

export function getSchemaContent(actionConfig: ActionConfig): SchemaContent {
    const schemaFile = actionConfig.schemaFile;
    if (typeof schemaFile !== "function") {
        return schemaFile;
    }
    const loadedSchemaFile = schemaFile();
    actionConfig.schemaFile = loadedSchemaFile;
    return loadedSchemaFile;
}

export function getGrammarContent(
    actionConfig: ActionConfig,
): GrammarContent | undefined {
    const grammarFile = actionConfig.grammarFile;
    if (grammarFile === undefined) {
        return undefined;
    }

    if (typeof grammarFile !== "function") {
        return grammarFile;
    }
    const loadedGrammarFile = grammarFile();
    actionConfig.grammarFile = loadedGrammarFile;
    return loadedGrammarFile;
}

function collectActionConfigs(
    actionConfigs: { [key: string]: ActionConfig },
    manifest: ActionManifest,
    schemaName: string,
    emojiChar: string,
    cachedActivities: Record<string, ActivityCacheSpec> | undefined,
    transient: boolean,
    schemaDefaultEnabled: boolean,
    actionDefaultEnabled: boolean,
    delegatable: boolean,
) {
    transient = manifest.transient ?? transient; // inherit from parent if not specified
    schemaDefaultEnabled =
        manifest.schemaDefaultEnabled ??
        manifest.defaultEnabled ??
        schemaDefaultEnabled; // inherit from parent if not specified
    actionDefaultEnabled =
        manifest.actionDefaultEnabled ??
        manifest.defaultEnabled ??
        actionDefaultEnabled; // inherit from parent if not specified
    delegatable = manifest.schema?.delegatable ?? delegatable; // inherit from parent if not specified

    if (manifest.schema) {
        const originalSchemaFile = manifest.schema.schemaFile;
        const schemaFile =
            typeof originalSchemaFile === "string"
                ? () => loadSchemaFile(originalSchemaFile)
                : originalSchemaFile;

        const originalGrammarFile = manifest.schema.grammarFile;
        const grammarFile =
            typeof originalGrammarFile === "string"
                ? () => loadGrammarFile(originalGrammarFile)
                : originalGrammarFile;
        debugConfig(`Adding schema '${schemaName}'`);
        actionConfigs[schemaName] = {
            schemaName,
            emojiChar,
            cachedActivities,
            ...manifest.schema,
            schemaFile,
            grammarFile,
            schemaFilePath:
                typeof originalSchemaFile === "string"
                    ? originalSchemaFile
                    : undefined,
            transient,
            schemaDefaultEnabled,
            actionDefaultEnabled,
            delegatable,
        };
    }

    const subManifests = manifest.subActionManifests;
    if (subManifests) {
        for (const [subName, subManifest] of Object.entries(subManifests)) {
            if (!isValidSubSchemaName(subName)) {
                throw new Error(`Invalid sub-schema name: ${subName}`);
            }
            collectActionConfigs(
                actionConfigs,
                subManifest,
                `${schemaName}.${subName}`,
                emojiChar,
                cachedActivities, // propagate cachedActivities
                transient, // propagate default transient
                schemaDefaultEnabled, // propagate default schemaDefaultEnabled
                actionDefaultEnabled, // propagate default actionDefaultEnabled
                delegatable, // propagate default delegatable
            );
        }
    }
}

function isValidSubSchemaName(schemaNamePart: string) {
    // . is use as a sub-schema separator
    // | is used in the cache as as multiple schema name separator
    // , is used in the cache as a separator between schema name and its hash
    return !/[.|,]/.test(schemaNamePart);
}

export function convertToActionConfig(
    name: string,
    config: AppAgentManifest,
    actionConfigs: Record<string, ActionConfig> = {},
): Record<string, ActionConfig> {
    if (!isValidSubSchemaName(name)) {
        throw new Error(`Invalid schema name: ${name}`);
    }
    const emojiChar = config.emojiChar;
    collectActionConfigs(
        actionConfigs,
        config,
        name,
        emojiChar,
        config.cachedActivities,
        false, // transient default to false if not specified
        true, // translationDefaultEnable default to true if not specified
        true, // actionDefaultEnabled default to true if not specified
        false, // delegatable default to false if not specified
    );
    return actionConfigs;
}
