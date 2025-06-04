// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { MemoryServer } from "./memoryServer.js";
import dotenv from "dotenv";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

console.log("Starting Memory Server");

const memoryServer = new MemoryServer("/data/testChat/knowpro/chat");
await memoryServer.start();

console.log("Exit Memory Server");
