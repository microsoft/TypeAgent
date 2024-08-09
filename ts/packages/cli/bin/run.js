#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../.env", import.meta.url) });

async function main() {
    const { execute } = await import("@oclif/core");
    await execute({ dir: import.meta.url });
}

await main();
