// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CommandServer } from "./commandServer.js";
import dotenv from "dotenv";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

console.log("Starting Command Executor Server");

const commandServer = new CommandServer();
await commandServer.start();

console.log("Exit Command Executor Server");
