// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    AppAgentManifest,
    CompletionGroup,
} from "@typeagent/agent-sdk";
import { AppAgentProvider } from "../src/agentProvider/agentProvider.js";
import {
    type CommandHandlerContext,
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
} from "../src/context/commandHandlerContext.js";
import { getCommandInterface } from "@typeagent/agent-sdk/helpers/command";
import { getCommandCompletion } from "../src/command/completion.js";

// ---------------------------------------------------------------------------
// Test agent with parameters for completion testing
// ---------------------------------------------------------------------------
const handlers = {
    description: "Completion test agent",
    defaultSubCommand: "run",
    commands: {
        run: {
            description: "Run a task",
            parameters: {
                args: {
                    task: {
                        description: "Task name",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                _names: string[],
            ): Promise<CompletionGroup[]> => {
                return [
                    {
                        name: "Tasks",
                        completions: ["build", "test", "deploy"],
                    },
                ];
            },
        },
        nested: {
            description: "Nested test",
            commands: {
                sub: {
                    description: "Nested sub",
                    parameters: {
                        args: {
                            value: {
                                description: "A value",
                            },
                        },
                        flags: {
                            verbose: {
                                description: "Enable verbose",
                                type: "boolean" as const,
                                char: "v",
                            },
                        },
                    },
                    run: async () => {},
                },
            },
        },
    },
} as const;

const config: AppAgentManifest = {
    emojiChar: "🧪",
    description: "Completion test",
};

const agent: AppAgent = {
    ...getCommandInterface(handlers),
};

const testCompletionAgentProvider: AppAgentProvider = {
    getAppAgentNames: () => ["comptest"],
    getAppAgentManifest: async (name: string) => {
        if (name !== "comptest") throw new Error(`Unknown: ${name}`);
        return config;
    },
    loadAppAgent: async (name: string) => {
        if (name !== "comptest") throw new Error(`Unknown: ${name}`);
        return agent;
    },
    unloadAppAgent: async (name: string) => {
        if (name !== "comptest") throw new Error(`Unknown: ${name}`);
    },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Command Completion - startIndex", () => {
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
            appAgentProviders: [testCompletionAgentProvider],
        });
    });
    afterAll(async () => {
        if (context) {
            await closeCommandHandlerContext(context);
        }
    });

    describe("agent + subcommand resolution", () => {
        it("returns startIndex at suffix boundary for '@comptest run '", async () => {
            const result = await getCommandCompletion(
                "@comptest run ",
                context,
            );
            expect(result).toBeDefined();
            // "@comptest run " → suffix is "" after command resolution,
            // and parameter parsing has no tokens so
            // startIndex = inputLength - 0 = 14
            expect(result!.startIndex).toBe(14);
        });

        it("returns startIndex accounting for partial param for '@comptest run bu'", async () => {
            const result = await getCommandCompletion(
                "@comptest run bu",
                context,
            );
            expect(result).toBeDefined();
            // "@comptest run bu" (16 chars)
            // suffix is "bu", parameter parsing sees token "bu" (2 chars)
            // startIndex = 16 - 2 = 14
            expect(result!.startIndex).toBe(14);
        });

        it("returns startIndex for nested command '@comptest nested sub '", async () => {
            const result = await getCommandCompletion(
                "@comptest nested sub ",
                context,
            );
            expect(result).toBeDefined();
            // "@comptest nested sub " (21 chars)
            // suffix is "" after command resolution;
            // parameter parsing has no tokens; startIndex = 21 - 0 = 21
            expect(result!.startIndex).toBe(21);
        });

        it("returns startIndex for partial flag '@comptest nested sub --ver'", async () => {
            const result = await getCommandCompletion(
                "@comptest nested sub --ver",
                context,
            );
            expect(result).toBeDefined();
            // "@comptest nested sub --ver" (26 chars)
            // suffix is "--ver", parameter parsing sees token "--ver" (5 chars)
            // startIndex = 26 - 5 = 21
            expect(result!.startIndex).toBe(21);
        });
    });

    describe("empty and minimal input", () => {
        it("returns completions for empty input", async () => {
            const result = await getCommandCompletion("", context);
            expect(result).toBeDefined();
            expect(result!.completions.length).toBeGreaterThan(0);
            // completions should include "@"
            const prefixes = result!.completions.find(
                (g) => g.name === "Command Prefixes",
            );
            expect(prefixes).toBeDefined();
            expect(prefixes!.completions).toContain("@");
        });

        it("returns startIndex 0 for empty input", async () => {
            const result = await getCommandCompletion("", context);
            expect(result).toBeDefined();
            expect(result!.startIndex).toBe(0);
        });

        it("returns startIndex at end for whitespace-only input", async () => {
            const result = await getCommandCompletion("  ", context);
            expect(result).toBeDefined();
            // "  " normalizes to a command prefix with no suffix;
            // startIndex = input.length - suffix.length = 2
            expect(result!.startIndex).toBe(2);
        });
    });

    describe("agent name level", () => {
        it("returns subcommands at agent boundary '@comptest '", async () => {
            const result = await getCommandCompletion("@comptest ", context);
            expect(result).toBeDefined();
            const subcommands = result!.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeDefined();
            expect(subcommands!.completions).toContain("run");
            expect(subcommands!.completions).toContain("nested");
        });

        it("returns undefined for unknown agent", async () => {
            const result = await getCommandCompletion(
                "@unknownagent ",
                context,
            );
            expect(result).toBeUndefined();
        });
    });

    describe("startIndex tracks last token position", () => {
        it("startIndex at token boundary with trailing space", async () => {
            const result = await getCommandCompletion(
                "@comptest run build ",
                context,
            );
            // "@comptest run build " (20 chars)
            // suffix is "build ", token "build" is complete, trailing space
            // means filter length = 0, so startIndex = 20
            expect(result).toBeDefined();
            expect(result!.startIndex).toBe(20);
        });
    });

    describe("needsSeparator for command completions", () => {
        it("returns undefined needsSeparator for @-command completions", async () => {
            const result = await getCommandCompletion(
                "@comptest run ",
                context,
            );
            expect(result).toBeDefined();
            // @-command completions go through command handler, not grammar,
            // so needsSeparator should not be set.
            expect(result!.needsSeparator).toBeUndefined();
        });
    });
});
