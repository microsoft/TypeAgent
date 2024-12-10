// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TypeAgentServer } from "./typeAgentServer.js";
import findConfig from "find-config";
import assert from "assert";
import fs from "node:fs";

const envPath = findConfig(".env");
assert(envPath, ".env file not found!");

if (fs.existsSync("/mnt/blob")) {
    fs.writeFileSync("/api.log", "/mnt/blob EXISTS!!!");
} else {
    fs.writeFileSync("/api.log", "/mnt/blob NOT FOUND!!!");
}

const typeAgentServer: TypeAgentServer = new TypeAgentServer(envPath);
typeAgentServer.start();
