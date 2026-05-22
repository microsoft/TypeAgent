// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ensureDir } from "typeagent";
import { MemoryServer } from "./memoryServer.js";
import { loadConfigSync } from "@typeagent/config";

loadConfigSync();

console.log("Starting Memory Server");

const baseDirPath = "/data/testChat/knowpro/chat";
await ensureDir(baseDirPath);

const memoryServer = new MemoryServer(baseDirPath);
await memoryServer.start();

console.log("Exit Memory Server");
