// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDispatcher } from "agent-dispatcher";
import { getDefaultAppAgentProvider } from "../src/defaultAgentProviders.js";

describe("AppAgentProvider", () => {
    describe("Built-in Provider", () => {
        it("startup and shutdown", async () => {
            const dispatcher = await createDispatcher("test", {
                appAgentProviders: [getDefaultAppAgentProvider()],
            });
            await dispatcher.close();
        });
    });
});
