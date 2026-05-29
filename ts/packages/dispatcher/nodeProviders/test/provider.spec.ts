// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createNpmAppAgentProvider } from "../src/agentProvider/npmAgentProvider.js";
import { awaitCommand, createDispatcher } from "agent-dispatcher";
import type {
    Dispatcher,
    ClientIO,
    IAgentMessage,
    RequestId,
} from "@typeagent/dispatcher-types";
import { fileURLToPath } from "node:url";

const testAppAgentProvider = createNpmAppAgentProvider(
    {
        test: {
            name: "test-agent",
            path: fileURLToPath(
                new URL("../../../../agents/test", import.meta.url),
            ),
        },
    },
    import.meta.url,
);

function createTestClientIO(data: IAgentMessage[]): ClientIO {
    return {
        clear: () => {},
        exit: () => process.exit(0),
        shutdown: () => process.exit(0),
        setUserRequest: () => {},
        setDisplayInfo: () => {},
        appendDiagnosticData: () => {},
        setDynamicDisplay: () => {},
        question: async (
            _requestId: RequestId | undefined,
            _message: string,
            _choices: string[],
            defaultId?: number,
        ) => defaultId ?? 0,
        proposeAction: async () => undefined,
        notify: () => {},
        openLocalView: async () => {},
        closeLocalView: async () => {},
        requestChoice: () => {},
        requestInteraction: () => {},
        interactionResolved: () => {},
        interactionCancelled: () => {},
        takeAction: (requestId: RequestId, action: string) => {
            throw new Error(`Action ${action} not supported`);
        },

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
                    agents: {
                        commands: ["test"],
                    },
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
                await awaitCommand(
                    dispatcher,
                    '@action test add --parameters \'{"a": 1, "b": 2}\'',
                );
                expect(output).toHaveLength(2);
                expect(output[1].message).toBe("The sum of 1 and 2 is 3");
            });

            it("action command no parameters", async () => {
                await awaitCommand(dispatcher, "@action test random");

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
                await awaitCommand(dispatcher, command);
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
            await awaitCommand(dispatcher, "@config request test");
            await awaitCommand(dispatcher, "test");
            await dispatcher.close();
            expect(output).toHaveLength(2);
            expect(output[0].message).toBe(
                "Natural langue request handling agent is set to 'test'",
            );
            expect(output[1].message).toBe("test");
        });
    });
});
