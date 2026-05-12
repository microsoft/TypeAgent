#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../dist/testDriver.js");

if (!existsSync(cliPath)) {
    console.error("kp has not been built yet.");
    console.error(
        "Run `pnpm -C ts/packages/kp build` or `pnpm -C ts run build` first.",
    );
    process.exit(1);
}

await import(cliPath);
