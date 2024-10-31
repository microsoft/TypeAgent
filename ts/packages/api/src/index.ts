// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TypeAgentServer } from "./typeAgentServer.js";
import findConfig from "find-config";
import assert from "assert";

const envPath = findConfig(".env");
assert(envPath, ".env file not found!");

const typeAgentServer: TypeAgentServer = new TypeAgentServer(envPath);
typeAgentServer.start();
