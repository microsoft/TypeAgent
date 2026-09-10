// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import {
    AppAgentProvider,
    AppAgentSource,
} from "../src/agentProvider/agentProvider.js";
import {
    type CommandHandlerContext,
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
} from "../src/context/commandHandlerContext.js";
import { getCommandInterface } from "@typeagent/agent-sdk/helpers/command";
import { resolveCommand } from "../src/command/command.js";
import { createDispatcher } from "../src/dispatcher.js";
import { awaitCommand } from "@typeagent/dispatcher-types";
import registerDebug from "debug";
import type { Dispatcher } from "@typeagent/dispatcher-types";

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
        throws: {
            description: "Throwing test command",
            run: async () => {
                throw new Error("handler boom");
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

async function captureDebug(
    namespaces: string,
    action: () => Promise<unknown>,
): Promise<string[]> {
    const priorNamespaces = registerDebug.disable();
    const priorLog = registerDebug.log;
    const captured: string[] = [];
    registerDebug.log = (message: string) => {
        captured.push(message);
    };
    registerDebug.enable(namespaces);
    try {
        await action();
        return captured;
    } finally {
        registerDebug.log = priorLog;
        registerDebug.enable(priorNamespaces);
    }
}

describe("Command", () => {
    describe("initialize", () => {
        it("disposes connected app-agent sources when initial provider registration fails", async () => {
            let disposed = false;
            const source: AppAgentSource = {
                connect: () => ({
                    providers: Promise.reject(new Error("provider boom")),
                    dispose: () => {
                        disposed = true;
                    },
                }),
            };

            await expect(
                initializeCommandHandlerContext("test", {
                    agents: {
                        actions: false,
                        schemas: false,
                    },
                    translation: { enabled: false },
                    explainer: { enabled: false },
                    cache: { enabled: false },
                    appAgentSources: [source],
                }),
            ).rejects.toThrow(/provider boom/);
            expect(disposed).toBe(true);
        });
    });

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

        describe("debug logging", () => {
            // resolveCommand runs for both submitted commands and completion
            // RPCs; keep the diagnostic (info) channel silent here so
            // completion polling does not flood the diagnostic profile.
            it("does not emit the info channel from resolveCommand", async () => {
                const captured = await captureDebug(
                    "typeagent:dispatcher:command:info",
                    () => resolveCommand("test test", context),
                );
                expect(
                    captured.some((line) =>
                        line.includes("dispatcher:command:info"),
                    ),
                ).toBe(false);
            });

            it("emits the verbose channel from resolveCommand", async () => {
                const captured = await captureDebug(
                    "typeagent:dispatcher:command:verbose",
                    () => resolveCommand("test test", context),
                );
                expect(
                    captured.some((line) =>
                        line.includes("dispatcher:command:verbose"),
                    ),
                ).toBe(true);
            });
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
            const result = await awaitCommand(
                dispatcher,
                "@test test param param",
            );
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "Command '@test test' does not accept parameters.",
            );
            expect(result?.disposition).toEqual({
                status: "failed",
                path: "command",
                mayHaveSideEffects: false,
            });
        });
        it("resolves a default command with extra param error", async () => {
            const result = await awaitCommand(dispatcher, "@test param param");
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "'param param' is not a subcommand for '@test'",
            );
        });
        it("resolves nested command with extra param error", async () => {
            const result = await awaitCommand(
                dispatcher,
                "@test nested nested param param",
            );
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "Command '@test nested nested' does not accept parameters.",
            );
        });
        it("reports unexpected command handler failures", async () => {
            const result = await awaitCommand(dispatcher, "@test throws");
            expect(result?.disposition).toEqual({
                status: "failed",
                path: "command",
                mayHaveSideEffects: true,
            });
        });
        it("does not resolve command with extra param error", async () => {
            const result = await awaitCommand(
                dispatcher,
                "@test nested param param",
            );
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "'param param' is not a subcommand for '@test nested'.",
            );
        });
        it("default to system with in valid command error", async () => {
            const result = await awaitCommand(
                dispatcher,
                "@agent nested param param",
            );
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "Command or agent name required.",
            );
        });
        it("missing subcommand error", async () => {
            const result = await awaitCommand(dispatcher, "@test nested");
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "'@test nested' requires a subcommand.",
            );
        });
        it("missing agent error", async () => {
            const result = await awaitCommand(dispatcher, "@");
            expect(result).toBeDefined();
            expect(result!.lastError).toContain(
                "Command or agent name required.",
            );
        });

        describe("debug logging", () => {
            // Submitted commands should still surface the info-level
            // "Resolved command" log so diagnostic captures show what
            // was actually executed.
            it("emits the info channel for submitted commands", async () => {
                const captured = await captureDebug(
                    "typeagent:dispatcher:command:*",
                    () => awaitCommand(dispatcher, "@test test"),
                );
                expect(
                    captured.some((line) =>
                        line.includes("dispatcher:command:info"),
                    ),
                ).toBe(true);
                expect(
                    captured.some((line) =>
                        line.includes("dispatcher:command:verbose"),
                    ),
                ).toBe(false);
            });
        });
    });
});
