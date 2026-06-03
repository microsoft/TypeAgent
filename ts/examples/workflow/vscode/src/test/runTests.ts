// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Entry point for @vscode/test-electron — downloads (or reuses) a
 * VS Code build, then launches it with the extension under test and
 * runs the Mocha suite in ./suite/index.js.
 *
 * NOTE: This script requires a display server (Xvfb on Linux). The
 * dev container used for primary development does not provide one,
 * so this is intended to run on developer workstations and on CI
 * runners that have a display. See lsp-decisions.md.
 */

import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
    try {
        // The extension's package.json sits two levels up from this file
        // once compiled (dist/test/runTests.js -> ../..).
        const extensionDevelopmentPath = path.resolve(__dirname, "../..");
        const extensionTestsPath = path.resolve(__dirname, "./suite/index");

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            // Disable other extensions to keep the host minimal.
            launchArgs: ["--disable-extensions"],
        });
    } catch (err) {
        console.error("Failed to run tests:", err);
        process.exit(1);
    }
}

void main();
