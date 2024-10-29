// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TypeAgentServer } from "./typeAgentServer.js";

const envPath = new URL("../../../.env", import.meta.url);
const typeAgentServer: TypeAgentServer = new TypeAgentServer(envPath);
typeAgentServer.start();

