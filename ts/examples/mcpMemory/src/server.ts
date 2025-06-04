// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MemoryServer } from "./memoryServer.js";

console.log("Starting Memory Server");
const memoryServer = new MemoryServer();
await memoryServer.start();
console.log("Exit Memory Server");
