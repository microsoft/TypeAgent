// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { AppAgentProvider } from "../src/agentProvider/agentProvider.js";
import {
    closeCommandHandlerContext,
    CommandHandlerContext,
    initializeCommandHandlerContext,
} from "../src/context/commandHandlerContext.js";
import { getCommandInterface } from "@typeagent/agent-sdk/helpers/command";
import { resolveCommand } from "../src/command/command.js";
import { createDispatcher, Dispatcher } from "../src/dispatcher.js";

// create an inlined test agent and provider to test command handler.
const config: AppAgentManifest = {
    emojiChar: "🧪",
    description: "Test",
};

const handlers = {
    description: "Test Command Table",
    defaultSubCommand: "test",
    commands: {
        test: {
            description: "Test command",
            run: async () => {},
        },
        nested: {
            description: "Nested Command Table",
            commands: {
                nested: {
                    description: "Nested Test command",
                    run: async () => {},
                },
            },
        },
    },
} as const;
const agent: AppAgent = {
    ...getCommandInterface(handlers),
};

export const testCommandAgentProvider: AppAgentProvider = {
    getAppAgentNames: () => {
        return ["test"];
    },
    getAppAgentManifest: async (appAgentName: string) => {
        if (appAgentName !== "test") {
            throw new Error(`Unknown app agent: ${appAgentName}`);
        }
        return config;
    },
    loadAppAgent: async (appAgentName: string) => {
        if (appAgentName !== "test") {
            throw new Error(`Unknown app agent: ${appAgentName}`);
        }
        return agent;
    },
    unloadAppAgent: async (appAgentName: string) => {
        if (appAgentName !== "test") {
            throw new Error(`Unknown app agent: ${appAgentName}`);
        }
    },
};

describe("Command", () => {
    describe("resolve", () => {
        let context: CommandHandlerContext;
        beforeAll(async () => {
            context = await initializeCommandHandlerContext("test", {
                agents: {
                    actions: false,
                    schemas: false,
                },
                translation: { enabled: false },
                explainer: { enabled: false },
                cache: { enabled: false },
                appAgentProviders: [testCommandAgentProvider],
            });
        });
        afterAll(async () => {
            if (context) {
                await closeCommandHandlerContext(context);
            }
        });
        it("resolves a command", async () => {
            const command = await resolveCommand(
                "test test param param",
                context,
            );
            expect(command).toBeDefined();
            expect(command.actualAppAgentName).toStrictEqual("test");
            expect(command.parsedAppAgentName).toStrictEqual("test");
            expect(command.commands).toStrictEqual(["test"]);
            expect(command.suffix).toStrictEqual("param param");
            expect(command.table).toBe(handlers);
            expect(command.descriptor).toBe(handlers.commands.test);
            expect(command.matched).toBe(true);
        });
        it("resolves a default command", async () => {
            const command = await resolveCommand("test param param", context);
            expect(command).toBeDefined();
            expect(command.actualAppAgentName).toStrictEqual("test");
            expect(command.parsedAppAgentName).toStrictEqual("test");
            expect(command.commands).toStrictEqual([]);
            expect(command.suffix).toStrictEqual("param param");
            expect(command.table).toBe(handlers);
            expect(command.descriptor).toBe(handlers.commands.test);
            expect(command.matched).toBe(false);
        });
        it("resolves nested command", async () => {
            const command = await resolveCommand(
                "test nested nested param param",
                context,
            );
            expect(command).toBeDefined();
            expect(command.actualAppAgentName).toStrictEqual("test");
            expect(command.parsedAppAgentName).toStrictEqual("test");
            expect(command.commands).toStrictEqual(["nested", "nested"]);
            expect(command.suffix).toStrictEqual("param param");
            expect(command.table).toBe(handlers.commands.nested);
            expect(command.descriptor).toBe(
                handlers.commands.nested.commands.nested,
            );
            expect(command.matched).toBe(true);
        });
        it("does not resolve command", async () => {
            const command = await resolveCommand(
                "test nested param param",
                context,
            );
            expect(command).toBeDefined();
            expect(command.actualAppAgentName).toStrictEqual("test");
            expect(command.parsedAppAgentName).toStrictEqual("test");
            expect(command.commands).toStrictEqual(["nested"]);
            expect(command.suffix).toStrictEqual("param param");
            expect(command.table).toBe(handlers.commands.nested);
            expect(command.descriptor).toBeUndefined();
            expect(command.matched).toBe(false);
        });
        it("default to system", async () => {
            const command = await resolveCommand(
                "agent nested param param",
                context,
            );
            expect(command).toBeDefined();
            expect(command.actualAppAgentName).toStrictEqual("system");
            expect(command.parsedAppAgentName).toBeUndefined();
            expect(command.commands).toStrictEqual([]);
            expect(command.suffix).toStrictEqual("agent nested param param");
            expect(command.table).toBeDefined();
            expect(command.descriptor).toBeUndefined();
            expect(command.matched).toBe(false);
        });
    });
    describe("parse", () => {
        let dispatcher: Dispatcher;
        beforeAll(async () => {
            dispatcher = await createDispatcher("test", {
                agents: {
                    actions: false,
                    schemas: false,
                },
                translation: { enabled: false },
                explainer: { enabled: false },
                cache: { enabled: false },
                appAgentProviders: [testCommandAgentProvider],
                collectCommandResult: true,
            });
        });
        afterAll(async () => {
            if (dispatcher) {
                await dispatcher.close();
            }
        });

        it("resolves a command with extra param error", async () => {
            const result = await dispatcher.processCommand(
                "@test test param param",
            );
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "Command '@test test' does not accept parameters.",
            );
        });
        it("resolves a default command with extra param error", async () => {
            const result = await dispatcher.processCommand("@test param param");
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "'param param' is not a subcommand for '@test'",
            );
        });
        it("resolves nested command with extra param error", async () => {
            const result = await dispatcher.processCommand(
                "@test nested nested param param",
            );
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "Command '@test nested nested' does not accept parameters.",
            );
        });
        it("does not resolve command with extra param error", async () => {
            const result = await dispatcher.processCommand(
                "@test nested param param",
            );
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "'param param' is not a subcommand for '@test nested'.",
            );
        });
        it("default to system with in valid command error", async () => {
            const result = await dispatcher.processCommand(
                "@agent nested param param",
            );
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "Command or agent name required.",
            );
        });
        it("missing subcommand error", async () => {
            const result = await dispatcher.processCommand("@test nested");
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "'@test nested' requires a subcommand.",
            );
        });
        it("missing agent error", async () => {
            const result = await dispatcher.processCommand("@");
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "Command or agent name required.",
            );
        });
    });
});
