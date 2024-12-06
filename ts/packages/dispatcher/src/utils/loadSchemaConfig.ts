// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SchemaConfig } from "action-schema";
import fs from "node:fs";
import path from "node:path";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { ActionConfigProvider } from "../translation/agentTranslators.js";

export function readSchemaConfig(schemaFile: string): string | undefined {
    const parseSchemaFile = path.parse(getPackageFilePath(schemaFile));
    const schemaConfigFile = path.join(
        parseSchemaFile.dir,
        parseSchemaFile.name + ".json",
    );
    return fs.existsSync(schemaConfigFile)
        ? fs.readFileSync(schemaConfigFile, "utf8")
        : undefined;
}

const schemaConfigCache = new Map<string, SchemaConfig | undefined>();

export function loadTranslatorSchemaConfig(
    schemaName: string,
    provider: ActionConfigProvider,
) {
    if (schemaConfigCache.has(schemaName)) {
        return schemaConfigCache.get(schemaName);
    }
    const content = readSchemaConfig(
        provider.getActionConfig(schemaName).schemaFile,
    );
    const schemaConfig = content ? JSON.parse(content) : undefined;
    schemaConfigCache.set(schemaName, schemaConfig);
    return schemaConfig;
}
