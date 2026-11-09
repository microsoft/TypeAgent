// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { probeSqlite, verifyNativeRuntimes } from "./lib/ciNativeRuntime.mjs";

const [command, runtime] = process.argv.slice(2);
if (command === undefined) {
    verifyNativeRuntimes(process.cwd());
} else {
    assert.equal(command, "probe", "Unknown native verification command");
    console.log(JSON.stringify(probeSqlite(process.cwd(), runtime)));
}
