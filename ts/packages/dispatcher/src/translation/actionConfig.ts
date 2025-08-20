// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionManifest,
    AppAgentManifest,
    SchemaManifest,
    ActivityCacheSpec,
} from "@typeagent/agent-sdk";
import registerDebug from "debug";
const debugConfig = registerDebug("typeagent:dispatcher:schema:config");

// A flatten AppAgentManifest
export type ActionConfig = {
    emojiChar: string;

    // Key is activity name. Default (if not specified) is not cached during activity.
    cachedActivities: Record<string, ActivityCacheSpec> | undefined;

    schemaDefaultEnabled: boolean;
    actionDefaultEnabled: boolean;
    transient: boolean;
    schemaName: string;
} & SchemaManifest;

function collectActionConfigs(
    actionConfigs: { [key: string]: ActionConfig },
    manifest: ActionManifest,
    schemaName: string,
    emojiChar: string,
    cachedActivities: Record<string, ActivityCacheSpec> | undefined,
    transient: boolean,
    schemaDefaultEnabled: boolean,
    actionDefaultEnabled: boolean,
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

    if (manifest.schema) {
        debugConfig(`Adding schema '${schemaName}'`);
        actionConfigs[schemaName] = {
            schemaName,
            emojiChar,
            cachedActivities,
            ...manifest.schema,
            transient,
            schemaDefaultEnabled,
            actionDefaultEnabled,
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
    );
    return actionConfigs;
}
