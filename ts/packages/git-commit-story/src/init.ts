// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Register the Copilot plugin for this repo only. Writes the local (personal,
// uncommitted) repo settings file, because the marketplace path is machine
// specific:
//
//   <repo>/.github/copilot/settings.local.json
//   {
//     "extraKnownMarketplaces": {
//       "git-commit-story": {
//         "source": { "source": "directory", "path": "<this package>" }
//       }
//     },
//     "enabledPlugins": { "git-commit-story@git-commit-story": true }
//   }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_NAME = "git-commit-story";
const MARKETPLACE_NAME = "git-commit-story";
const SETTINGS_FILE = path.join(".github", "copilot", "settings.local.json");

// Package root holds .github/plugin/marketplace.json.
const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);

export function init(repoRoot: string): void {
    const file = path.join(repoRoot, SETTINGS_FILE);
    const settings = existsSync(file)
        ? JSON.parse(readFileSync(file, "utf8"))
        : {};
    settings.extraKnownMarketplaces = {
        ...settings.extraKnownMarketplaces,
        [MARKETPLACE_NAME]: {
            source: { source: "directory", path: packageRoot },
        },
    };
    settings.enabledPlugins = {
        ...settings.enabledPlugins,
        [`${PLUGIN_NAME}@${MARKETPLACE_NAME}`]: true,
    };
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
    console.log(`Registered Copilot plugin in ${SETTINGS_FILE}`);
}
