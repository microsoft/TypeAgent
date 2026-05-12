#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../dist/cli.js");

if (!existsSync(cliPath)) {
    console.error("mcp-plan-validation has not been built yet.");
    console.error(
        "Run `pnpm -C ts/packages/security/mcpValidation build` or `pnpm -C ts run build` first.",
    );
    process.exit(1);
}

await import(cliPath);
