// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createNpmAppAgentProvider } from "../src/agentProvider/npmAgentProvider.js";
import { createDispatcher, Dispatcher } from "../src/dispatcher.js";
import { fileURLToPath } from "node:url";

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
    describe("Custom Provider", () => {
        describe("Command", () => {
            const output: IAgentMessage[] = [];
            let dispatcher: Dispatcher;
            beforeAll(async () => {
                dispatcher = await createDispatcher("test", {
                    appAgentProviders: [testAppAgentProvider],
                    commands: { test: true },
                    clientIO: createTestClientIO(output),
                });
            });

            beforeEach(() => {
                output.length = 0;
            });
            afterAll(async () => {
                if (dispatcher) {
                    await dispatcher.close();
                }
            });
            it("action command", async () => {
                await dispatcher.processCommand(
                    '@action test add --parameters \'{"a": 1, "b": 2}\'',
                );
                expect(output).toHaveLength(2);
                expect(output[1].message).toBe("The sum of 1 and 2 is 3");
            });

            it("action command no parameters", async () => {
                await dispatcher.processCommand("@action test random");

                expect(output).toHaveLength(2);
                expect(output[1].message).toMatch(/Random number: [0-9.]+/);
            });
            const errorCommands = [
                {
                    name: "Empty Command",
                    command: "@",
                    match: /^ERROR: Command or agent name required./,
                },
                {
                    name: "Invalid agent name",
                    command: "@something",
                    match: /^ERROR: Command or agent name required./,
                },
                {
                    name: "Missing subcommand",
                    command: "@test",
                    match: /^ERROR: '@test' requires a subcommand./,
                },
                {
                    name: "Invalid subcommand",
                    command: "@test sub",
                    match: /^ERROR: 'sub' is not a subcommand for '@test'./,
                },
                {
                    name: "Disable command",
                    command: "@dispatcher something",
                    match: /^ERROR: Command for 'dispatcher' is disabled./,
                },
            ];
            it.each(errorCommands)("$name", async ({ command, match }) => {
                await dispatcher.processCommand(command);
                expect(output).toHaveLength(1);
                expect(typeof output[0].message).toBe("object");
                const content = output[0].message as any;
                expect(content.type).toBe("text");
                expect(content.kind).toBe("error");
                expect(content.content).toMatch(match);
            });
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
            expect(output).toHaveLength(2);
            expect(output[0].message).toBe(
                "Natural langue request handling agent is set to 'test'",
            );
            expect(output[1].message).toBe("test");
        });
    });
});
