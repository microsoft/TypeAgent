// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { getPackageFilePath } from "./getPackageFilePath.js";

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
