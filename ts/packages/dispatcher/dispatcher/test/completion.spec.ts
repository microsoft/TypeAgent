// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAgent,
    AppAgentManifest,
    CompletionGroups,
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

// Shared grammar completion mock.  Simulates a grammar that recognises
// CJK ("東京" → "タワー"/"駅") and English ("Tokyo" → "Tower"/"Station")
// prefixes.  `token` is the raw last token from parseParams — it may
// include a leading quote for open-quoted input.
function grammarCompletion(token: string): CompletionGroups {
    // Strip a leading quote so grammar match logic operates on text only.
    const text = token.startsWith('"') ? token.substring(1) : token;
    const quoteOffset = token.length - text.length; // 0 or 1

    if (text.startsWith("Tokyo")) {
        const suffix = text.substring(5).trim();
        if (suffix.startsWith("Tower") || suffix.startsWith("Station")) {
            return { groups: [] }; // completed match
        }
        return {
            groups: [
                {
                    name: "Grammar",
                    completions: ["Tower", "Station"],
                },
            ],
            prefixLength: quoteOffset + 5,
            separatorMode: "space",
        };
    }
    if (text.startsWith("東京")) {
        const suffix = text.substring(2);
        if (suffix.startsWith("タワー") || suffix.startsWith("駅")) {
            return { groups: [] }; // completed match
        }
        return {
            groups: [
                {
                    name: "Grammar",
                    completions: ["タワー", "駅"],
                },
            ],
            prefixLength: quoteOffset + 2,
            separatorMode: "optional",
        };
    }
    // No prefix matched — offer initial completions.
    return {
        groups: [
            {
                name: "Grammar",
                completions: ["Tokyo ", "東京"],
            },
        ],
        ...(token.length > 0 ? { prefixLength: 0 } : {}),
        separatorMode: "space",
    };
}

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
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("task")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "Tasks",
                            completions: ["build", "test", "deploy"],
                        },
                    ],
                };
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
        twoarg: {
            description: "Two-arg command",
            parameters: {
                args: {
                    first: {
                        description: "First arg",
                    },
                    second: {
                        description: "Second arg",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("first") && !names.includes("second")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "Values",
                            completions: ["alpha", "beta"],
                        },
                    ],
                };
            },
        },
        search: {
            description: "Implicit-quotes command",
            parameters: {
                args: {
                    query: {
                        description: "Search query",
                        implicitQuotes: true,
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("query")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "Suggestions",
                            completions: ["hello world", "foo bar"],
                        },
                    ],
                };
            },
        },
        grammar: {
            description: "Grammar prefixLength command",
            parameters: {
                args: {
                    phrase: {
                        description: "A CJK phrase",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("phrase")) {
                    return { groups: [] };
                }
                const p = params as { tokens?: string[] };
                const lastToken = p.tokens?.[p.tokens.length - 1] ?? "";
                return grammarCompletion(lastToken);
            },
        },
        grammariq: {
            description: "Grammar with implicitQuotes",
            parameters: {
                args: {
                    query: {
                        description: "CJK search query",
                        implicitQuotes: true,
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("query")) {
                    return { groups: [] };
                }
                const p = params as { tokens?: string[] };
                const lastToken = p.tokens?.[p.tokens.length - 1] ?? "";
                return grammarCompletion(lastToken);
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
            // startIndex = inputLength - 0 = 14, then unconditional
            // whitespace backing rewinds over trailing space → 13.
            expect(result!.startIndex).toBe(13);
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
            // suffix is "bu", parameter parsing fully consumes "bu"
            // remainderLength = 0 → startIndex = 16, then whitespace
            // backing finds no space at suffix end → startIndex = 16.
            expect(result!.startIndex).toBe(16);
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
            // parameter parsing has no tokens; startIndex = 21 - 0 = 21,
            // then unconditional whitespace backing → 20.
            expect(result!.startIndex).toBe(20);
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
            // startIndex = 26 - 5 = 21, then unconditional whitespace
            // backing rewinds over the space before "--ver" → 20.
            expect(result!.startIndex).toBe(20);
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
            // startIndex = input.length - suffix.length = 2, then
            // unconditional whitespace backing rewinds to 0.
            expect(result!.startIndex).toBe(0);
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
            // Agent was recognized → no agent names offered.
            const agentGroup = result!.completions.find(
                (g) => g.name === "Agent Names",
            );
            expect(agentGroup).toBeUndefined();
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
            // suffix is "build ", token "build" is fully consumed,
            // remainderLength = 0 → startIndex = 20, then unconditional
            // whitespace backing rewinds over trailing space → 19.
            expect(result).toBeDefined();
            expect(result!.startIndex).toBe(19);
            // All positional args filled ("task" consumed "build"),
            // no flags, agent not invoked (agentCommandCompletions
            // is empty) → exhaustive.
            expect(result!.complete).toBe(true);
        });

        it("startIndex backs over whitespace before unconsumed remainder", async () => {
            const result = await getCommandCompletion(
                "@comptest run hello --unknown",
                context,
            );
            expect(result).toBeDefined();
            // "@comptest run hello --unknown" (29 chars)
            // suffix is "hello --unknown", "hello" fills the "task" arg,
            // "--unknown" is not a defined flag → remainderLength = 9.
            // startIndex = 29 - 9 = 20, then unconditional whitespace
            // backing rewinds over the space → 19.
            expect(result!.startIndex).toBe(19);
        });

        it("startIndex backs over multiple spaces before unconsumed remainder", async () => {
            const result = await getCommandCompletion(
                "@comptest run hello   --unknown",
                context,
            );
            expect(result).toBeDefined();
            // "@comptest run hello   --unknown" (31 chars)
            // suffix is "hello   --unknown", "hello" fills "task",
            // "--unknown" unconsumed → remainderLength = 9.
            // startIndex = 31 - 9 = 22, then unconditional whitespace
            // backing rewinds over three spaces → 19.
            expect(result!.startIndex).toBe(19);
        });
    });

    describe("separatorMode for command completions", () => {
        it("returns separatorMode for subcommand completions at agent boundary", async () => {
            const result = await getCommandCompletion("@comptest ", context);
            expect(result).toBeDefined();
            // "run" is the default subcommand, so subcommand alternatives
            // are included and the group has separatorMode: "space".
            expect(result!.separatorMode).toBe("space");
            // startIndex excludes trailing whitespace (matching grammar
            // matcher behaviour where prefixLength doesn't include the
            // separator).
            expect(result!.startIndex).toBe(9);
        });

        it("returns separatorMode for resolved agent without trailing space", async () => {
            const result = await getCommandCompletion("@comptest", context);
            expect(result).toBeDefined();
            expect(result!.separatorMode).toBe("space");
            // No trailing whitespace to trim — startIndex stays at end
            expect(result!.startIndex).toBe(9);
            // Default subcommand has agent completions → not exhaustive.
            expect(result!.complete).toBe(false);
        });

        it("does not set separatorMode at top level (@)", async () => {
            const result = await getCommandCompletion("@", context);
            expect(result).toBeDefined();
            // Top-level completions (agent names, system subcommands)
            // follow '@' — space is accepted but not required.
            expect(result!.separatorMode).toBe("optional");
            // Agent names are offered when no agent was recognized,
            // independent of which branch (descriptor/table/neither)
            // produced the subcommand completions.
            const agentGroup = result!.completions.find(
                (g) => g.name === "Agent Names",
            );
            expect(agentGroup).toBeDefined();
            expect(agentGroup!.completions).toContain("comptest");
            // Subcommand + agent name sets are finite → exhaustive.
            expect(result!.complete).toBe(true);
        });

        it("does not set separatorMode for parameter completions only", async () => {
            const result = await getCommandCompletion(
                "@comptest run bu",
                context,
            );
            expect(result).toBeDefined();
            // Partial parameter token — only parameter completions returned,
            // no subcommand group, so separatorMode is not set.
            expect(result!.separatorMode).toBeUndefined();
        });

        it("returns no separatorMode for partial unmatched token consumed as param", async () => {
            const result = await getCommandCompletion("@comptest ne", context);
            expect(result).toBeDefined();
            // "ne" is fully consumed as the "task" arg by parameter
            // parsing → startIndex = 12 (past command boundary 10),
            // so subcommands are not included and separatorMode is
            // not set.
            expect(result!.separatorMode).toBeUndefined();
            const subcommands = result!.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeUndefined();
            expect(result!.startIndex).toBe(12);
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

        it("returns flag value completions for non-boolean flag without trailing space", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly --level",
                context,
            );
            // "--level" is a recognized number flag — the entire input
            // is the longest valid prefix.  startIndex = input.length
            // because the flag name is consumed, not filter text.
            // Completions should offer the flag's values (if any),
            // not flag names.
            expect(result.startIndex).toBe(27); // full input consumed
            const flags = result.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeUndefined(); // flag names not offered when pending
        });

        it("treats unrecognized flag prefix as filter text", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly --lev",
                context,
            );
            // "--lev" doesn't resolve (exact match only), so parseParams
            // leaves it unconsumed.  startIndex points to where "--lev"
            // starts — it is the filter text.
            // "@comptest flagsonly " = 20 chars consumed, then
            // unconditional whitespace backing → 19.
            expect(result.startIndex).toBe(19);
            const flags = result.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeDefined();
            expect(flags!.completions).toContain("--debug");
            expect(flags!.completions).toContain("--level");
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
            // startIndex = 15 - 5 ("--rel") = 10, then unconditional
            // whitespace backing rewinds over space → 9.
            expect(result.startIndex).toBe(9);
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
            // nocmdtest IS a recognized agent name (just not
            // command-enabled), so parsedAppAgentName is set and
            // agent names are NOT offered.
            const agentGroup = result.completions.find(
                (g) => g.name === "Agent Names",
            );
            expect(agentGroup).toBeUndefined();
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
            // "build" fills the "task" arg, trailing space present.
            // remainderLength = 0 → startIndex = 16, then unconditional
            // whitespace backing → 15, past the command boundary (10).
            // Subcommand names are no longer relevant at this
            // position; only parameter completions remain.
            const subcommands = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeUndefined();
            expect(result.startIndex).toBe(15);
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

        it("drops subcommands when partial token is consumed past boundary", async () => {
            const result = await getCommandCompletion("@comptest ne", context);
            // "@comptest ne" — suffix is "ne", parameter parsing fully
            // consumes it as the "task" arg → startIndex = 12, which
            // exceeds commandBoundary (10) → subcommands dropped.
            const subcommands = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeUndefined();
        });
    });

    describe("lastCompletableParam adjusts startIndex", () => {
        it("backs startIndex to open-quote token start for '@comptest run \"bu'", async () => {
            const result = await getCommandCompletion(
                '@comptest run "bu',
                context,
            );
            // '@comptest run "bu' (17 chars)
            // suffix is '"bu', parseParams consumes the open-quoted
            // token through EOF → remainderLength = 0.
            // lastCompletableParam = "task", quoted = false (open quote).
            // Exclusive path: startIndex = 17 - 3 = 14, then unconditional
            // whitespace backing rewinds over the space before '"bu' → 13.
            expect(result.startIndex).toBe(13);
            // Agent was invoked → not exhaustive.
            expect(result.complete).toBe(false);
            // Flag groups and nextArgs completions should be cleared.
            const flags = result.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeUndefined();
        });

        it("backs startIndex for multi-arg open quote '@comptest twoarg \"partial'", async () => {
            const result = await getCommandCompletion(
                '@comptest twoarg "partial',
                context,
            );
            // '@comptest twoarg "partial' (25 chars)
            // suffix is '"partial', parseParams consumes open quote
            // through EOF → remainderLength = 0.
            // lastCompletableParam = "first", quoted = false.
            // Exclusive path: startIndex = 25 - 8 = 17, then unconditional
            // whitespace backing rewinds over the space → 16.
            // "second" from nextArgs should NOT be in agentCommandCompletions.
            expect(result.startIndex).toBe(16);
            expect(result.complete).toBe(false);
        });

        it("backs startIndex for implicitQuotes '@comptest search hello world'", async () => {
            const result = await getCommandCompletion(
                "@comptest search hello world",
                context,
            );
            // "@comptest search hello world" (28 chars)
            // suffix is "hello world", implicitQuotes consumes rest
            // of line → remainderLength = 0, token = "hello world".
            // lastCompletableParam = "query", lastParamImplicitQuotes = true.
            // Exclusive path: startIndex = 28 - 11 = 17, then unconditional
            // whitespace backing rewinds over the space → 16.
            expect(result.startIndex).toBe(16);
            expect(result.complete).toBe(false);
        });

        it("does not adjust startIndex for fully-quoted token", async () => {
            const result = await getCommandCompletion(
                '@comptest run "build"',
                context,
            );
            // '@comptest run "build"' (21 chars)
            // Token '"build"' is fully quoted → isFullyQuoted returns true.
            // lastCompletableParam condition does NOT fire.
            // remainderLength = 0 → startIndex = 21, unconditional
            // whitespace backing finds no space at input[20]='"' → 21.
            // "task" is filled, no flags → exhaustive.
            expect(result.startIndex).toBe(21);
            expect(result.complete).toBe(true);
        });

        it("does not adjust startIndex for bare unquoted token", async () => {
            const result = await getCommandCompletion(
                "@comptest run bu",
                context,
            );
            // "bu" is not quoted at all → isFullyQuoted returns undefined.
            // lastParamImplicitQuotes is false for "task" arg.
            // lastCompletableParam condition does NOT fire.
            // startIndex stays at 16 (end of input).
            expect(result.startIndex).toBe(16);
            expect(result.complete).toBe(true);
        });
    });

    describe("groupPrefixLength overrides startIndex", () => {
        it("open-quote CJK advances startIndex by prefixLength", async () => {
            const result = await getCommandCompletion(
                '@comptest grammar "東京タ',
                context,
            );
            // '@comptest grammar "東京タ' (22 chars)
            //   0-8: @comptest  9: sp  10-16: grammar  17: sp
            //   18: "  19: 東  20: 京  21: タ
            // suffix = '"東京タ' (4 chars), open-quoted token.
            // lastCompletableParam fires (quoted=false).
            //   tokenStartIndex = 22 - 4 = 18 (position of '"')
            //   startIndex = tokenBoundary(input, 18) = 17
            // Agent strips opening quote, matches "東京" (2 chars),
            // returns prefixLength = 3 (1 quote + 2 CJK chars).
            //   startIndex = tokenStartIndex + 3 = 18 + 3 = 21.
            // rawPrefix = "タ", "タワー".startsWith("タ") ✓
            expect(result.startIndex).toBe(21);
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeDefined();
            expect(grammar!.completions).toContain("タワー");
            expect(grammar!.completions).toContain("駅");
            expect(result.complete).toBe(false);
        });

        it("implicitQuotes CJK advances startIndex by prefixLength", async () => {
            const result = await getCommandCompletion(
                "@comptest grammariq 東京タ",
                context,
            );
            // "@comptest grammariq 東京タ" (23 chars)
            //   0-8: @comptest  9: sp  10-18: grammariq  19: sp
            //   20: 東  21: 京  22: タ
            // suffix = "東京タ" (3 chars), implicitQuotes captures
            // rest of line as token.
            // lastCompletableParam fires (implicitQuotes).
            //   tokenStartIndex = 23 - 3 = 20 (position of "東")
            //   startIndex = tokenBoundary(input, 20) = 19
            // Agent matches "東京" (2 chars), returns prefixLength=2.
            //   startIndex = tokenStartIndex + 2 = 20 + 2 = 22.
            // rawPrefix = "タ", "タワー".startsWith("タ") ✓
            expect(result.startIndex).toBe(22);
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeDefined();
            expect(grammar!.completions).toContain("タワー");
            expect(grammar!.completions).toContain("駅");
            expect(result.complete).toBe(false);
        });

        it("fully-quoted token does not invoke grammar", async () => {
            const result = await getCommandCompletion(
                '@comptest grammar "東京タ"',
                context,
            );
            // Token '"東京タ"' is fully quoted → isFullyQuoted = true.
            // lastCompletableParam exclusive path does NOT fire.
            // All args consumed → nextArgs empty → agent not called.
            // prefixLength never applies.
            expect(result.startIndex).toBe(23);
            expect(result.complete).toBe(true);
            // No Grammar group since agent wasn't invoked.
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeUndefined();
        });

        it("bare unquoted token does not invoke grammar", async () => {
            const result = await getCommandCompletion(
                "@comptest grammar 東京タ",
                context,
            );
            // "東京タ" has no quotes, grammar command has no
            // implicitQuotes → lastCompletableParam condition false.
            // All args consumed → nextArgs empty → agent not called.
            expect(result.startIndex).toBe(21);
            expect(result.complete).toBe(true);
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeUndefined();
        });

        it("trailing space without text offers initial completions", async () => {
            const result = await getCommandCompletion(
                "@comptest grammar ",
                context,
            );
            // "@comptest grammar " (18 chars)
            // suffix is "", no tokens parsed → nextArgs = ["phrase"].
            // Agent called, mock sees empty token list → returns
            // completions ["東京"] with no prefixLength.
            // groupPrefixLength path does not fire.
            // startIndex = tokenBoundary(input, 18) = 17.
            expect(result.startIndex).toBe(17);
            expect(result.complete).toBe(false);
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeDefined();
            expect(grammar!.completions).toContain("Tokyo ");
            expect(grammar!.completions).toContain("東京");
        });

        it("clears earlier completions when prefixLength is set", async () => {
            const result = await getCommandCompletion(
                '@comptest grammar "東京タ',
                context,
            );
            // When groupPrefixLength fires, parameter/flag
            // completions from before the agent call are cleared.
            const flags = result.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeUndefined();
        });

        it("does not override startIndex when prefixLength is absent", async () => {
            // "run" handler returns groups without prefixLength.
            const result = await getCommandCompletion(
                "@comptest run bu",
                context,
            );
            expect(result.startIndex).toBe(16);
        });

        it("English prefix with space separator", async () => {
            const result = await getCommandCompletion(
                "@comptest grammariq Tokyo T",
                context,
            );
            // "@comptest grammariq Tokyo T" (27 chars)
            //   0-8: @comptest  9: sp  10-18: grammariq  19: sp
            //   20-24: Tokyo  25: sp  26: T
            // Token = "Tokyo T" (7 chars), implicitQuotes.
            // lastCompletableParam fires.
            //   tokenStartIndex = 27 - 7 = 20
            //   startIndex = tokenBoundary(input, 20) = 19
            // Mock matches "Tokyo" → prefixLength=5, separatorMode="space".
            //   startIndex = tokenStartIndex + 5 = 20 + 5 = 25.
            // rawPrefix = " T", consumer strips space → filter "T".
            // "Tower".startsWith("T") ✓
            expect(result.startIndex).toBe(25);
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeDefined();
            expect(grammar!.completions).toContain("Tower");
            expect(grammar!.completions).toContain("Station");
            expect(result.complete).toBe(false);
        });

        it("completed CJK match returns no completions", async () => {
            const result = await getCommandCompletion(
                "@comptest grammariq 東京タワー",
                context,
            );
            // Token = "東京タワー" (5 chars).  Mock matches "東京"
            // and finds suffix "タワー" starts with "タワー" →
            // returns empty (completed match, no more to suggest).
            // agentGroups is [], no prefixLength.
            // startIndex = tokenBoundary from lastCompletableParam path.
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeUndefined();
            expect(result.complete).toBe(false);
        });

        it("no-text offers initial completions via grammariq", async () => {
            const result = await getCommandCompletion(
                "@comptest grammariq ",
                context,
            );
            // "@comptest grammariq " (20 chars)
            // No tokens parsed → nextArgs = ["query"].
            // Mock sees empty token → falls to "no prefix matched"
            // branch → completions: ["Tokyo ", "東京"],
            // prefixLength: 0, separatorMode: "space".
            // groupPrefixLength = 0 → condition false → skip.
            // startIndex = tokenBoundary(input, 20) = 19.
            expect(result.startIndex).toBe(19);
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeDefined();
            expect(grammar!.completions).toContain("Tokyo ");
            expect(grammar!.completions).toContain("東京");
            expect(result.complete).toBe(false);
        });
    });
});
