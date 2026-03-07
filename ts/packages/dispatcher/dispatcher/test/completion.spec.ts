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
        noop: {
            description: "No-params command",
            run: async () => {},
        },
        flagsonly: {
            description: "Flags-only command",
            parameters: {
                flags: {
                    debug: {
                        description: "Enable debug",
                        type: "boolean" as const,
                    },
                    level: {
                        description: "Log level",
                        type: "number" as const,
                    },
                },
            },
            run: async () => {},
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

// ---------------------------------------------------------------------------
// Flat agent — returns a single CommandDescriptor (no subcommand table)
// ---------------------------------------------------------------------------
const flatHandlers = {
    description: "Flat agent with params but no subcommands",
    parameters: {
        args: {
            target: {
                description: "Build target",
            },
        },
        flags: {
            release: {
                description: "Release build",
                type: "boolean" as const,
            },
        },
    },
    run: async () => {},
} as const;

const flatConfig: AppAgentManifest = {
    emojiChar: "📦",
    description: "Flat completion test",
};

const flatAgent: AppAgent = {
    ...getCommandInterface(flatHandlers),
};

// ---------------------------------------------------------------------------
// No-commands agent — getCommands returns undefined
// ---------------------------------------------------------------------------
const noCommandsConfig: AppAgentManifest = {
    emojiChar: "🚫",
    description: "Agent with no commands",
};

const noCommandsAgent: AppAgent = {
    // getCommands not defined → resolveCommand sees descriptors=undefined
};

const testCompletionAgentProviderMulti: AppAgentProvider = {
    getAppAgentNames: () => ["comptest", "flattest", "nocmdtest"],
    getAppAgentManifest: async (name: string) => {
        if (name === "comptest") return config;
        if (name === "flattest") return flatConfig;
        if (name === "nocmdtest") return noCommandsConfig;
        throw new Error(`Unknown: ${name}`);
    },
    loadAppAgent: async (name: string) => {
        if (name === "comptest") return agent;
        if (name === "flattest") return flatAgent;
        if (name === "nocmdtest") return noCommandsAgent;
        throw new Error(`Unknown: ${name}`);
    },
    unloadAppAgent: async (name: string) => {
        if (!["comptest", "flattest", "nocmdtest"].includes(name))
            throw new Error(`Unknown: ${name}`);
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
            appAgentProviders: [testCompletionAgentProviderMulti],
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
            // "run" is explicitly matched so no Subcommands group.
            // parameter parsing has no tokens so
            // startIndex = inputLength - 0 = 14
            expect(result!.startIndex).toBe(14);
            // Agent getCompletion is invoked for the "task" arg →
            // completions are not exhaustive.
            expect(result!.complete).toBe(false);
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
            // "bu" consumes the "task" arg → nextArgs is empty.
            // Agent is not invoked (bare word, no implicit quotes).
            // Only flags remain (none defined) → exhaustive.
            expect(result!.complete).toBe(true);
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
            // Unfilled "value" arg (free-form) → not exhaustive.
            expect(result!.complete).toBe(false);
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
            // Unfilled "value" arg → not exhaustive.
            expect(result!.complete).toBe(false);
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
            // Empty input normalizes to "{requestHandler} request" which
            // has open parameters → not exhaustive.
            expect(result!.complete).toBe(false);
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
            // Default subcommand "run" has agent completions → not exhaustive.
            expect(result!.complete).toBe(false);
        });

        it("returns matching agent names for partial prefix '@com'", async () => {
            const result = await getCommandCompletion("@com", context);
            // "@com" → normalizeCommand strips '@' → "com"
            // resolveCommand: "com" isn't an agent name → system agent,
            // system has no defaultSubCommand → descriptor=undefined,
            // suffix="com".  Completions include both system subcommands
            // and agent names; the trie filters "com" against them.
            expect(result.startIndex).toBe(1);
            const agentGroup = result.completions.find(
                (g) => g.name === "Agent Names",
            );
            expect(agentGroup).toBeDefined();
            expect(agentGroup!.completions).toContain("comptest");
            const subcommandGroup = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommandGroup).toBeDefined();
            expect(result.complete).toBe(true);
        });

        it("returns completions for unknown agent with startIndex at '@'", async () => {
            const result = await getCommandCompletion(
                "@unknownagent ",
                context,
            );
            // "@unknownagent " → longest valid prefix is "@"
            // (startIndex = 1).  Completions offer system subcommands
            // and agent names so the user can correct the typo.
            expect(result.startIndex).toBe(1);
            const agentGroup = result.completions.find(
                (g) => g.name === "Agent Names",
            );
            expect(agentGroup).toBeDefined();
            const subcommandGroup = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommandGroup).toBeDefined();
            expect(result.complete).toBe(true);
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
            // All positional args filled ("task" consumed "build"),
            // no flags, agent not invoked (agentCommandCompletions
            // is empty) → exhaustive.
            expect(result!.complete).toBe(true);
        });
    });

    describe("needsSeparator for command completions", () => {
        it("returns needsSeparator for subcommand completions at agent boundary", async () => {
            const result = await getCommandCompletion("@comptest ", context);
            expect(result).toBeDefined();
            // "run" is the default subcommand, so subcommand alternatives
            // are included and the group has needsSeparator: true.
            expect(result!.needsSeparator).toBe(true);
            // startIndex excludes trailing whitespace (matching grammar
            // matcher behaviour where prefixLength doesn't include the
            // separator).
            expect(result!.startIndex).toBe(9);
        });

        it("returns needsSeparator for resolved agent without trailing space", async () => {
            const result = await getCommandCompletion("@comptest", context);
            expect(result).toBeDefined();
            expect(result!.needsSeparator).toBe(true);
            // No trailing whitespace to trim — startIndex stays at end
            expect(result!.startIndex).toBe(9);
            // Default subcommand has agent completions → not exhaustive.
            expect(result!.complete).toBe(false);
        });

        it("does not set needsSeparator at top level (@)", async () => {
            const result = await getCommandCompletion("@", context);
            expect(result).toBeDefined();
            // Top-level completions (agent names, system subcommands)
            // follow '@' directly without a separator.
            expect(result!.needsSeparator).toBeUndefined();
            // Subcommand + agent name sets are finite → exhaustive.
            expect(result!.complete).toBe(true);
        });

        it("does not set needsSeparator for parameter completions only", async () => {
            const result = await getCommandCompletion(
                "@comptest run bu",
                context,
            );
            expect(result).toBeDefined();
            // Partial parameter token — only parameter completions returned,
            // no subcommand group, so needsSeparator is not set.
            expect(result!.needsSeparator).toBeUndefined();
        });

        it("returns needsSeparator + subcommands for partial unmatched token", async () => {
            const result = await getCommandCompletion("@comptest ne", context);
            expect(result).toBeDefined();
            // "ne" doesn't match an explicit subcommand, so resolved to
            // default — subcommand alternatives included.
            expect(result!.needsSeparator).toBe(true);
            const subcommands = result!.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeDefined();
            expect(subcommands!.completions).toContain("nested");
            // startIndex backs up past the space to the agent boundary.
            // "@comptest" = 9 chars.
            expect(result!.startIndex).toBe(9);
        });
    });

    describe("complete flag", () => {
        it("returns empty completions for command with no parameters", async () => {
            const result = await getCommandCompletion(
                "@comptest noop ",
                context,
            );
            // "noop" has no parameters at all → nothing more to type.
            // getCommandParameterCompletion returns undefined and
            // no subcommand alternatives exist (explicit match) →
            // empty completions with complete=true.
            expect(result.completions).toHaveLength(0);
            expect(result.complete).toBe(true);
        });

        it("complete=true for flags-only command with no args unfilled", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly ",
                context,
            );
            expect(result).toBeDefined();
            // No positional args, only flags. nextArgs is empty.
            // No agent getCompletion. Flags are a finite set → exhaustive.
            expect(result!.complete).toBe(true);
            const flags = result!.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeDefined();
            expect(flags!.completions).toContain("--debug");
            expect(flags!.completions).toContain("--level");
        });

        it("complete=true for boolean flag pending", async () => {
            const result = await getCommandCompletion(
                "@comptest nested sub --verbose ",
                context,
            );
            expect(result).toBeDefined();
            // --verbose is boolean; getPendingFlag pushed ["true", "false"]
            // and returned undefined (not a pending non-boolean flag).
            // nextArgs still has "value" unfilled → complete = false.
            expect(result!.complete).toBe(false);
        });

        it("complete=false when agent completions are invoked", async () => {
            const result = await getCommandCompletion(
                "@comptest run ",
                context,
            );
            expect(result).toBeDefined();
            // Agent getCompletion is invoked → conservatively not exhaustive.
            expect(result!.complete).toBe(false);
        });

        it("complete=false for unfilled positional args without agent", async () => {
            const result = await getCommandCompletion(
                "@comptest nested sub ",
                context,
            );
            expect(result).toBeDefined();
            // "value" arg is unfilled, no agent getCompletion → not exhaustive
            // (free-form text).
            expect(result!.complete).toBe(false);
        });

        it("complete=true for flags-only after one flag is set", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly --debug true ",
                context,
            );
            expect(result).toBeDefined();
            // --debug is consumed; only --level remains. Still a finite set.
            expect(result!.complete).toBe(true);
        });
    });

    describe("flat descriptor (no subcommand table)", () => {
        it("returns parameter completions for flat agent", async () => {
            const result = await getCommandCompletion("@flattest ", context);
            // flattest has no subcommand table (table===undefined),
            // but its descriptor has parameters (args + flags).
            // Should return flag completions.
            const flags = result.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeDefined();
            expect(flags!.completions).toContain("--release");
            // Unfilled "target" arg → not exhaustive.
            expect(result.complete).toBe(false);
        });

        it("returns correct startIndex for flat agent with partial token", async () => {
            const result = await getCommandCompletion(
                "@flattest --rel",
                context,
            );
            // "@flattest --rel" (15 chars)
            // startIndex = 15 - 5 ("--rel") = 10
            expect(result.startIndex).toBe(10);
            expect(result.complete).toBe(false);
        });

        it("falls back to system for agent with no commands", async () => {
            const result = await getCommandCompletion("@nocmdtest ", context);
            // nocmdtest has no getCommands → not command-enabled →
            // resolveCommand falls back to system agent.  System has
            // a subcommand table, so we get system subcommands.
            const subcommands = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeDefined();
            expect(subcommands!.completions.length).toBeGreaterThan(0);
        });
    });

    describe("subcommands dropped when parameters consume past boundary", () => {
        it("drops subcommands when default command parameter is filled", async () => {
            const result = await getCommandCompletion(
                "@comptest build ",
                context,
            );
            // "@comptest build " (16 chars)
            // Resolves to default "run" (not explicit match).
            // "build" fills the "task" arg, trailing space moves
            // startIndex to 16 — past the command boundary (10).
            // Subcommand names are no longer relevant at this
            // position; only parameter completions remain.
            const subcommands = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeUndefined();
            expect(result.startIndex).toBe(16);
            // All positional args filled, no flags → exhaustive.
            expect(result.complete).toBe(true);
        });

        it("keeps subcommands when at the command boundary", async () => {
            const result = await getCommandCompletion("@comptest ", context);
            // "@comptest " (10 chars)
            // Resolves to default "run" — suffix is empty, parameter
            // startIndex equals commandBoundary → subcommands included.
            const subcommands = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeDefined();
            expect(subcommands!.completions).toContain("run");
            expect(subcommands!.completions).toContain("nested");
        });

        it("keeps subcommands when partial token is at the boundary", async () => {
            const result = await getCommandCompletion("@comptest ne", context);
            // "@comptest ne" — suffix is "ne", parameter parsing sees
            // one partial token but startIndex = 10 (command boundary
            // for needsSeparator stripping) → subcommands included.
            const subcommands = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeDefined();
            expect(subcommands!.completions).toContain("nested");
        });
    });
});
