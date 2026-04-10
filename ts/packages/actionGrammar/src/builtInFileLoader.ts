// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve the .agr source file once at module load time.
// Check __dirname first (running from src/); fall back for dist/.
const builtInEntitiesSourcePath = (() => {
    const local = path.resolve(__dirname, "./builtInEntities.agr");
    if (fs.existsSync(local)) return local;
    return path.resolve(__dirname, "../src/builtInEntities.agr");
})();

let builtInEntitiesContent: string | undefined;

/**
 * Returns the source text of the built-in entity grammar (builtInEntities.agr).
 * The content is lazily loaded from disk and cached.
 */
export function getBuiltInEntitiesGrammarContent(): string {
    if (builtInEntitiesContent === undefined) {
        try {
            builtInEntitiesContent = fs.readFileSync(
                builtInEntitiesSourcePath,
                "utf-8",
            );
        } catch (e: unknown) {
            const code = (e as NodeJS.ErrnoException).code;
            throw new Error(
                `Failed to load built-in entity grammar from '${builtInEntitiesSourcePath}'` +
                    (code ? ` (${code})` : "") +
                    ". Ensure the package is built correctly.",
            );
        }
    }
    return builtInEntitiesContent;
}
