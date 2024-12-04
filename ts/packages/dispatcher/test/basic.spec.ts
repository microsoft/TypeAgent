// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createNpmAppAgentProvider } from "../src/agent/npmAgentProvider.js";
import { createDispatcher } from "../src/dispatcher/dispatcher.js";
import { fileURLToPath } from "node:url";
import { createConsoleClientIO } from "../src/helpers/console.js";

describe("basic", () => {
    it("startup and shutdown", async () => {
        const dispatcher = await createDispatcher("test", {});
        await dispatcher.close();
    });
    it("Custom NPM App Agent Provider", async () => {
        const dispatcher = await createDispatcher("test", {
            appAgentProviders: [
                createNpmAppAgentProvider(
                    {
                        test: {
                            name: "test-agent",
                            path: fileURLToPath(
                                new URL(
                                    "../../../agents/test",
                                    import.meta.url,
                                ),
                            ),
                        },
                    },
                    import.meta.url,
                ),
            ],
            clientIO: createConsoleClientIO(),
        });
        dispatcher.processCommand(
            '@action test add --parameters \'{"a": 1, "b": 2}\'',
        );
        // TODO: check for the output
        await dispatcher.close();
    });
});
