// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SchemaConfig } from "agent-cache";
import fs from "node:fs";
import path from "node:path";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { ActionConfigProvider } from "../translation/agentTranslators.js";

function loadSchemaConfig(schemaFile: string): SchemaConfig | undefined {
    const parseSchemaFile = path.parse(getPackageFilePath(schemaFile));
    const schemaConfigFile = path.join(
        parseSchemaFile.dir,
        parseSchemaFile.name + ".json",
    );
    return fs.existsSync(schemaConfigFile)
        ? JSON.parse(fs.readFileSync(schemaConfigFile, "utf8"))
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
    const schemaConfig = loadSchemaConfig(
        provider.getActionConfig(schemaName).schemaFile,
    );
    schemaConfigCache.set(schemaName, schemaConfig);
    return schemaConfig;
}
