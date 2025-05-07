// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDispatcher } from "agent-dispatcher";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";

// Use 3001 as the base for test port
process.env["PORT"] = "3001";
describe("AppAgentProvider", () => {
    describe("Built-in Provider", () => {
        it("startup and shutdown", async () => {
            const dispatcher = await createDispatcher("test", {
                appAgentProviders: getDefaultAppAgentProviders(undefined),
            });
            await dispatcher.close();
        }, 30000); // take longer time to start up on CI's small machines.
    });
});
