#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadConfigSync } from "@typeagent/config";
loadConfigSync();

async function main() {
    const { execute } = await import("@oclif/core");
    await execute({ dir: import.meta.url });
}

await main();
