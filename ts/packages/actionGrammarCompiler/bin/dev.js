#!/usr/bin/env -S node --loader ts-node/esm --no-warnings=ExperimentalWarning
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { COMMANDS } from "../dist/index.js";

async function main() {
    const { execute } = await import("@oclif/core");
    // Backward compat: if first arg is not a command
    const firstArg = process.argv[2];
    if (firstArg !== undefined && COMMANDS[firstArg] === undefined) {
        process.argv.splice(2, 0, "compile");
    }
    await execute({ development: true, dir: import.meta.url });
}

await main();
