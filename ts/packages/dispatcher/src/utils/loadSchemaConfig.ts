// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SchemaConfig } from "agent-cache";
import fs from "node:fs";
import path from "node:path";
import { getTranslatorConfig } from "../translation/agentTranslators.js";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";

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

export function loadTranslatorSchemaConfig(translatorName: string) {
    if (schemaConfigCache.has(translatorName)) {
        return schemaConfigCache.get(translatorName);
    }
    const schemaConfig = loadSchemaConfig(
        getTranslatorConfig(translatorName).schemaFile,
    );
    schemaConfigCache.set(translatorName, schemaConfig);
    return schemaConfig;
}
