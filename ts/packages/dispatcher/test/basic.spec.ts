// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createNpmAppAgentProvider } from "../src/agentProvider/npmAgentProvider.js";
import { createDispatcher } from "../src/dispatcher.js";
import { fileURLToPath } from "node:url";
import { getBuiltinAppAgentProvider } from "../src/utils/defaultAppProviders.js";
import {
    ClientIO,
    IAgentMessage,
    nullClientIO,
} from "../src/context/interactiveIO.js";

const testAppAgentProvider = createNpmAppAgentProvider(
    {
        test: {
            name: "test-agent",
            path: fileURLToPath(
                new URL("../../../agents/test", import.meta.url),
            ),
        },
    },
    import.meta.url,
);

function createTestClientIO(data: IAgentMessage[]): ClientIO {
    return {
        ...nullClientIO,
        setDisplay: (message: IAgentMessage) => data.push(message),
        appendDisplay: (message: IAgentMessage) => data.push(message),
    };
}

describe("dispatcher", () => {
    it("startup and shutdown", async () => {
        const dispatcher = await createDispatcher("test", {
            appAgentProviders: [getBuiltinAppAgentProvider()],
        });
        await dispatcher.close();
    });
    it("Custom NPM App Agent Provider", async () => {
        const output: IAgentMessage[] = [];
        const dispatcher = await createDispatcher("test", {
            appAgentProviders: [testAppAgentProvider],
            clientIO: createTestClientIO(output),
        });
        await dispatcher.processCommand(
            '@action test add --parameters \'{"a": 1, "b": 2}\'',
        );
        await dispatcher.close();

        expect(output.length).toBe(2);
        expect(output[1].message).toBe("The sum of 1 and 2 is 3");
    });
    it("Alternate request handler", async () => {
        const output: IAgentMessage[] = [];
        const dispatcher = await createDispatcher("test", {
            appAgentProviders: [testAppAgentProvider],
            clientIO: createTestClientIO(output),
        });
        await dispatcher.processCommand("@config request test");
        await dispatcher.processCommand("test");
        await dispatcher.close();

        expect(output.length).toBe(2);
        expect(output[0].message).toBe(
            "Natural langue request handling agent is set to 'test'",
        );
        expect(output[1].message).toBe("test");
    });
});
