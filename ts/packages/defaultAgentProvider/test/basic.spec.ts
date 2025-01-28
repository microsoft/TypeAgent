// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createDispatcher } from "agent-dispatcher";
import { getBuiltinAppAgentProvider } from "../src/defaultAppProviders.js";

describe("AppAgentProvider", () => {
    describe("Built-in Provider", () => {
        it("startup and shutdown", async () => {
            const dispatcher = await createDispatcher("test", {
                appAgentProviders: [getBuiltinAppAgentProvider()],
            });
            await dispatcher.close();
        });
    });
});
