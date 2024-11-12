// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createVSCodeSchemaGenApp } from "./vscodeSchemaGenApp.js";

async function run() {
    const app = await createVSCodeSchemaGenApp();
    await app.run();
}

await run();
