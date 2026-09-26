#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { initRuntimeConfigFromProcessEnv } from "@typeagent/aiclient";
import { loadConfigSync } from "@typeagent/config";
import { FileMemoryService } from "@typeagent/memory-service";
import { fileURLToPath } from "node:url";
import { MemoryMcpServer } from "./memoryMcpServer.js";

loadConfigSync();
initRuntimeConfigFromProcessEnv();

const rootDirectory =
    process.env.TYPEAGENT_MEMORY_DIR ??
    fileURLToPath(new URL("../../data", import.meta.url));
const service = new FileMemoryService(rootDirectory);
const server = new MemoryMcpServer(service);

const close = async () => {
    await server.close();
    await service.close();
};

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await server.start();
