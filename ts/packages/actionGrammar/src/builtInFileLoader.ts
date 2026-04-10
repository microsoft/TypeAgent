// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the .agr source file once at module load time.
const builtInEntitiesSourcePath = path.resolve(
    __dirname,
    // When running from dist/, go back up to src/
    __filename.includes("dist")
        ? "../src/builtInEntities.agr"
        : "./builtInEntities.agr",
);

let builtInEntitiesContent: string | undefined;

/**
 * Returns the source text of the built-in entity grammar (builtInEntities.agr).
 * The content is lazily loaded from disk and cached.
 */
export function getBuiltInEntitiesGrammarContent(): string {
    if (builtInEntitiesContent === undefined) {
        builtInEntitiesContent = fs.readFileSync(
            builtInEntitiesSourcePath,
            "utf-8",
        );
    }
    return builtInEntitiesContent;
}
