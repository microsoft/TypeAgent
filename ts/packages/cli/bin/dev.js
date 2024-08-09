#!/usr/bin/env -S node --loader ts-node/esm --no-warnings=ExperimentalWarning
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../.env", import.meta.url) });

// eslint-disable-next-line node/shebang
async function main() {
    const { execute } = await import("@oclif/core");
    await execute({ development: true, dir: import.meta.url });
}

await main();
