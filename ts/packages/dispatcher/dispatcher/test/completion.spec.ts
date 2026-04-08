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
            matchedPrefixLength: quoteOffset + 5,
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
                    separatorMode: "optionalSpace",
                },
            ],
            matchedPrefixLength: quoteOffset + 2,
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
        ...(token.length > 0 ? { matchedPrefixLength: 0 } : {}),
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
            description: "Grammar matchedPrefixLength command",
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
        exhaustive: {
            description: "Agent returns closedSet=true",
            parameters: {
                args: {
                    color: {
                        description: "A color",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("color")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "Colors",
                            completions: ["red", "green", "blue"],
                        },
                    ],
                    closedSet: true,
                };
            },
        },
        nonexhaustive: {
            description: "Agent returns closedSet=false",
            parameters: {
                args: {
                    item: {
                        description: "An item",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("item")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "Items",
                            completions: ["apple", "banana"],
                        },
                    ],
                    closedSet: false,
                };
            },
        },
        nocompletefield: {
            description: "Agent does not set closedSet",
            parameters: {
                args: {
                    thing: {
                        description: "A thing",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("thing")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "Things",
                            completions: ["widget", "gadget"],
                        },
                    ],
                };
            },
        },
        wildcard: {
            description: "Simulates grammar open-wildcard result",
            parameters: {
                args: {
                    request: {
                        description: "A request with wildcard",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("request")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "Keywords",
                            completions: ["by", "from"],
                            separatorMode: "spacePunctuation",
                        },
                    ],
                    matchedPrefixLength: 5,
                    closedSet: true,
                    directionSensitive: true,
                    afterWildcard: "all",
                };
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

// ---------------------------------------------------------------------------
// numstr agent — number arg followed by string arg (with getCompletion)
// ---------------------------------------------------------------------------
const numstrHandlers = {
    description: "Agent with number then string arg",
    defaultSubCommand: "numstr",
    commands: {
        numstr: {
            description: "Number then string command",
            parameters: {
                args: {
                    count: {
                        description: "A count",
                        type: "number" as const,
                    },
                    name: {
                        description: "A name",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("name")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "Names",
                            completions: ["alice", "bob"],
                        },
                    ],
                };
            },
        },
    },
} as const;

const numstrConfig: AppAgentManifest = {
    emojiChar: "🔢",
    description: "Numstr completion test",
};

const numstrAgent: AppAgent = {
    ...getCommandInterface(numstrHandlers),
};

// ---------------------------------------------------------------------------
// Throwing agent — getCommandCompletion always throws
// ---------------------------------------------------------------------------
const throwHandlers = {
    description: "Agent whose completion throws",
    defaultSubCommand: "boom",
    commands: {
        boom: {
            description: "Throws on completion",
            parameters: {
                args: {
                    value: {
                        description: "A value",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (): Promise<CompletionGroups> => {
                throw new Error("agent completion exploded");
            },
        },
    },
} as const;

const throwConfig: AppAgentManifest = {
    emojiChar: "💥",
    description: "Throwing completion test",
};

const throwAgent: AppAgent = {
    ...getCommandInterface(throwHandlers),
};

// ---------------------------------------------------------------------------
// automode agent — returns groups with autoSpacePunctuation /
// spacePunctuation / none and matchedPrefixLength=0.  Exercises the
// separator override logic in getCommandParameterCompletion when the
// agent has NOT advanced the prefix.
// ---------------------------------------------------------------------------
const automodeHandlers = {
    description: "Agent returning autoSpacePunctuation groups",
    defaultSubCommand: "auto",
    commands: {
        auto: {
            description: "Returns autoSpacePunctuation with mpl=0",
            parameters: {
                args: {
                    entity: {
                        description: "An entity",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("entity")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "AutoEntities",
                            completions: ["タワー", "駅"],
                            separatorMode: "autoSpacePunctuation",
                        },
                    ],
                    matchedPrefixLength: 0,
                };
            },
        },
        spacepunct: {
            description: "Returns spacePunctuation with mpl=0",
            parameters: {
                args: {
                    entity: {
                        description: "An entity",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("entity")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "SpacePunctEntities",
                            completions: ["alpha", "beta"],
                            separatorMode: "spacePunctuation",
                        },
                    ],
                    matchedPrefixLength: 0,
                };
            },
        },
        optpunct: {
            description: "Returns optionalSpacePunctuation with mpl=0",
            parameters: {
                args: {
                    entity: {
                        description: "An entity",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("entity")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "OptPunctEntities",
                            completions: ["gamma", "delta"],
                            separatorMode: "optionalSpacePunctuation",
                        },
                    ],
                    matchedPrefixLength: 0,
                };
            },
        },
        nonemode: {
            description: "Returns none separatorMode with mpl=0",
            parameters: {
                args: {
                    entity: {
                        description: "An entity",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("entity")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "NoneEntities",
                            completions: ["epsilon", "zeta"],
                            separatorMode: "none",
                        },
                    ],
                    matchedPrefixLength: 0,
                };
            },
        },
        nompl: {
            description: "Returns groups with no matchedPrefixLength",
            parameters: {
                args: {
                    entity: {
                        description: "An entity",
                    },
                },
            },
            run: async () => {},
            getCompletion: async (
                _context: unknown,
                _params: unknown,
                names: string[],
            ): Promise<CompletionGroups> => {
                if (!names.includes("entity")) {
                    return { groups: [] };
                }
                return {
                    groups: [
                        {
                            name: "NoMplEntities",
                            completions: ["eta", "theta"],
                            separatorMode: "autoSpacePunctuation",
                        },
                    ],
                };
            },
        },
    },
} as const;

const automodeConfig: AppAgentManifest = {
    emojiChar: "🔀",
    description: "Automode completion test",
};

const automodeAgent: AppAgent = {
    ...getCommandInterface(automodeHandlers),
};

const testCompletionAgentProviderMulti: AppAgentProvider = {
    getAppAgentNames: () => [
        "comptest",
        "flattest",
        "nocmdtest",
        "numstrtest",
        "throwtest",
        "automodetest",
    ],
    getAppAgentManifest: async (name: string) => {
        if (name === "comptest") return config;
        if (name === "flattest") return flatConfig;
        if (name === "nocmdtest") return noCommandsConfig;
        if (name === "numstrtest") return numstrConfig;
        if (name === "throwtest") return throwConfig;
        if (name === "automodetest") return automodeConfig;
        throw new Error(`Unknown: ${name}`);
    },
    loadAppAgent: async (name: string) => {
        if (name === "comptest") return agent;
        if (name === "flattest") return flatAgent;
        if (name === "nocmdtest") return noCommandsAgent;
        if (name === "numstrtest") return numstrAgent;
        if (name === "throwtest") return throwAgent;
        if (name === "automodetest") return automodeAgent;
        throw new Error(`Unknown: ${name}`);
    },
    unloadAppAgent: async (name: string) => {
        if (
            ![
                "comptest",
                "flattest",
                "nocmdtest",
                "numstrtest",
                "throwtest",
                "automodetest",
            ].includes(name)
        )
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
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // "@comptest run " → suffix is "" after command resolution,
            // "run" is explicitly matched so no Subcommands group.
            // parameter parsing has no tokens so
            // startIndex = inputLength - 0 = 14 (includes trailing space).
            expect(result!.startIndex).toBe(14);
            // Agent getCompletion is invoked for the "task" arg →
            // completions are not exhaustive.
            expect(result!.closedSet).toBe(false);
        });

        it("returns startIndex accounting for partial param for '@comptest run bu'", async () => {
            const result = await getCommandCompletion(
                "@comptest run bu",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // "@comptest run bu" (16 chars)
            // No trailing space → direction="forward".
            // suffix is "bu", parameter parsing fully consumes "bu".
            // lastCompletableParam="task", bare unquoted token,
            // no trailing space → exclusive path fires: backs up
            // startIndex to the start of "bu" → 14.
            expect(result!.startIndex).toBe(14);
            // Agent IS invoked ("task" in agentCommandCompletions).
            // Agent does not set closedSet → defaults to false.
            expect(result!.closedSet).toBe(false);
        });

        it("returns startIndex for nested command '@comptest nested sub '", async () => {
            const result = await getCommandCompletion(
                "@comptest nested sub ",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // "@comptest nested sub " (21 chars)
            // suffix is "" after command resolution;
            // parameter parsing has no tokens; startIndex = 21 - 0 = 21
            // (includes trailing space).
            expect(result!.startIndex).toBe(21);
            // Unfilled "value" arg (free-form) → not exhaustive.
            expect(result!.closedSet).toBe(false);
        });

        it("returns startIndex for partial flag '@comptest nested sub --ver'", async () => {
            const result = await getCommandCompletion(
                "@comptest nested sub --ver",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // "@comptest nested sub --ver" (26 chars)
            // suffix is "--ver", parameter parsing sees token "--ver" (5 chars)
            // startIndex = 26 - 5 = 21.
            expect(result!.startIndex).toBe(21);
            // Unfilled "value" arg → not exhaustive.
            expect(result!.closedSet).toBe(false);
        });
    });

    describe("empty and minimal input", () => {
        it("returns completions for empty input", async () => {
            const result = await getCommandCompletion("", "forward", context);
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
            expect(result!.closedSet).toBe(false);
        });

        it("returns startIndex 0 for empty input", async () => {
            const result = await getCommandCompletion("", "forward", context);
            expect(result).toBeDefined();
            expect(result!.startIndex).toBe(0);
        });

        it("returns startIndex at end for whitespace-only input", async () => {
            const result = await getCommandCompletion("  ", "forward", context);
            expect(result).toBeDefined();
            // "  " normalizes to a command prefix with no suffix;
            // startIndex = input.length - suffix.length = 2.
            // Trailing whitespace is preserved (no tokenBoundary rewind).
            expect(result!.startIndex).toBe(2);
        });
    });

    describe("agent name level", () => {
        it("returns subcommands at agent boundary '@comptest '", async () => {
            const result = await getCommandCompletion(
                "@comptest ",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            const subcommands = result!.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeDefined();
            expect(subcommands!.completions).toContain("run");
            expect(subcommands!.completions).toContain("nested");
            // Default subcommand "run" has agent completions → not exhaustive.
            expect(result!.closedSet).toBe(false);
            // Agent was recognized → no agent names offered.
            const agentGroup = result!.completions.find(
                (g) => g.name === "Agent Names",
            );
            expect(agentGroup).toBeUndefined();
        });

        it("returns matching agent names for partial prefix '@com'", async () => {
            const result = await getCommandCompletion(
                "@com",
                "forward",
                context,
            );
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
            expect(result.closedSet).toBe(true);
        });

        it("returns completions for unknown agent with startIndex at '@'", async () => {
            const result = await getCommandCompletion(
                "@unknownagent ",
                "forward",
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
            expect(result.closedSet).toBe(true);
        });
    });

    describe("startIndex tracks last token position", () => {
        it("startIndex at token boundary with trailing space", async () => {
            const result = await getCommandCompletion(
                "@comptest run build ",
                "forward",
                context,
            );
            // "@comptest run build " (20 chars)
            // suffix is "build ", token "build" is fully consumed,
            // remainderLength = 0 → startIndex = 20 (includes
            // trailing space, no rewind).
            expect(result).toBeDefined();
            expect(result!.startIndex).toBe(20);
            // All positional args filled ("task" consumed "build"),
            // no flags, agent not invoked (agentCommandCompletions
            // is empty) → exhaustive.
            expect(result!.closedSet).toBe(true);
        });

        it("startIndex backs over whitespace before unconsumed remainder", async () => {
            const result = await getCommandCompletion(
                "@comptest run hello --unknown",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // "@comptest run hello --unknown" (29 chars)
            // suffix is "hello --unknown", "hello" fills the "task" arg,
            // "--unknown" is not a defined flag → remainderLength = 9.
            // startIndex = 29 - 9 = 20 (includes trailing space
            // between "hello" and "--unknown").
            expect(result!.startIndex).toBe(20);
        });

        it("startIndex backs over multiple spaces before unconsumed remainder", async () => {
            const result = await getCommandCompletion(
                "@comptest run hello   --unknown",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // "@comptest run hello   --unknown" (31 chars)
            // suffix is "hello   --unknown", "hello" fills "task",
            // "--unknown" unconsumed → remainderLength = 9.
            // startIndex = 31 - 9 = 22 (includes trailing spaces).
            expect(result!.startIndex).toBe(22);
        });
    });

    describe("separatorMode for command completions", () => {
        it("returns separatorMode for subcommand completions at agent boundary", async () => {
            const result = await getCommandCompletion(
                "@comptest ",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // "run" is the default subcommand, so subcommand alternatives
            // are included.  Per-group separatorMode is "optionalSpace"
            // because the trailing whitespace is already consumed.
            expect(result!.completions[0].separatorMode).toBe("optionalSpace");
            // startIndex includes trailing whitespace.
            expect(result!.startIndex).toBe(10);
        });

        it("returns separatorMode for resolved agent without trailing space", async () => {
            const result = await getCommandCompletion(
                "@comptest",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // Subcommand group gets "optionalSpace" — no explicit
            // subcommand was typed, alternatives offered at the agent
            // boundary.
            expect(result!.completions[0].separatorMode).toBe("optionalSpace");
            expect(result!.startIndex).toBe(9);
            // Default subcommand has agent completions → not exhaustive.
            expect(result!.closedSet).toBe(false);
        });

        it("does not set separatorMode at top level (@)", async () => {
            const result = await getCommandCompletion("@", "forward", context);
            expect(result).toBeDefined();
            // Top-level completions (agent names, system subcommands)
            // follow '@' — agent names use optionalSpace since the '@'
            // marker doesn't require whitespace before the name.
            const agentNamesGroup = result!.completions.find(
                (g) => g.name === "Agent Names",
            );
            expect(agentNamesGroup).toBeDefined();
            expect(agentNamesGroup!.separatorMode).toBe("optionalSpace");
            expect(agentNamesGroup!.completions).toContain("comptest");
            // Subcommand + agent name sets are finite → exhaustive.
            expect(result!.closedSet).toBe(true);
        });

        it("returns optionalSpace separatorMode for parameter completions after space", async () => {
            const result = await getCommandCompletion(
                "@comptest run bu",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // Partial parameter token — the space before "bu" was already
            // consumed, so the group's separatorMode is "optionalSpace".
            expect(result!.completions[0].separatorMode).toBe("optionalSpace");
        });

        it("returns optionalSpace separatorMode for partial unmatched token consumed as param", async () => {
            const result = await getCommandCompletion(
                "@comptest ne",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // "ne" is fully consumed as the "task" arg by parameter
            // parsing.  startIndex = 10 (after "@comptest "), which is ≤
            // commandConsumedLength (10), so sibling subcommands are
            // included with per-group separatorMode.
            const subcommands = result!.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeDefined();
            expect(subcommands!.separatorMode).toBe("optionalSpace");
            expect(result!.startIndex).toBe(10);
        });
    });

    describe("closedSet flag", () => {
        it("returns empty completions for command with no parameters", async () => {
            const result = await getCommandCompletion(
                "@comptest noop ",
                "forward",
                context,
            );
            // "noop" has no parameters at all → nothing more to type.
            // getCommandParameterCompletion returns undefined and
            // no subcommand alternatives exist (explicit match) →
            // empty completions with closedSet=true.
            expect(result.completions).toHaveLength(0);
            expect(result.closedSet).toBe(true);
        });

        it("closedSet=true for flags-only command with no args unfilled", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly ",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // No positional args, only flags. nextArgs is empty.
            // No agent getCompletion. Flags are a finite set → exhaustive.
            expect(result!.closedSet).toBe(true);
            const flags = result!.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeDefined();
            expect(flags!.completions).toContain("--debug");
            expect(flags!.completions).toContain("--level");
        });

        it("closedSet=true for boolean flag pending", async () => {
            const result = await getCommandCompletion(
                "@comptest nested sub --verbose ",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // --verbose is boolean; getPendingFlag pushed ["true", "false"]
            // and returned undefined (not a pending non-boolean flag).
            // nextArgs still has "value" unfilled → closedSet = false.
            expect(result!.closedSet).toBe(false);
        });

        it("closedSet=false when agent completions are invoked without closedSet flag", async () => {
            const result = await getCommandCompletion(
                "@comptest run ",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // Agent getCompletion is invoked but does not set closedSet →
            // defaults to false.
            expect(result!.closedSet).toBe(false);
        });

        it("closedSet=true when agent returns closedSet=true", async () => {
            const result = await getCommandCompletion(
                "@comptest exhaustive ",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            const colors = result!.completions.find((g) => g.name === "Colors");
            expect(colors).toBeDefined();
            expect(colors!.completions).toContain("red");
            expect(colors!.completions).toContain("green");
            expect(colors!.completions).toContain("blue");
            // Agent explicitly signals exhaustive completions.
            expect(result!.closedSet).toBe(true);
        });

        it("closedSet=false when agent returns closedSet=false", async () => {
            const result = await getCommandCompletion(
                "@comptest nonexhaustive ",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            const items = result!.completions.find((g) => g.name === "Items");
            expect(items).toBeDefined();
            expect(items!.completions).toContain("apple");
            expect(items!.completions).toContain("banana");
            // Agent explicitly signals non-exhaustive.
            expect(result!.closedSet).toBe(false);
        });

        it("closedSet=false when agent does not set closedSet field", async () => {
            const result = await getCommandCompletion(
                "@comptest nocompletefield ",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            const things = result!.completions.find((g) => g.name === "Things");
            expect(things).toBeDefined();
            expect(things!.completions).toContain("widget");
            expect(things!.completions).toContain("gadget");
            // Agent omits closedSet → defaults to false.
            expect(result!.closedSet).toBe(false);
        });

        it("closedSet=false for unfilled positional args without agent", async () => {
            const result = await getCommandCompletion(
                "@comptest nested sub ",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // "value" arg is unfilled, no agent getCompletion → not exhaustive
            // (free-form text).
            expect(result!.closedSet).toBe(false);
        });

        it("closedSet=true for flags-only after one flag is set", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly --debug true ",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            // --debug is consumed; only --level remains. Still a finite set.
            expect(result!.closedSet).toBe(true);
        });

        it("returns flag names for non-boolean flag without trailing space", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly --level",
                "backward",
                context,
            );
            // "--level" is a recognized number flag.  With
            // direction="backward" (user reconsidering), offer flag
            // names at the start of "--level" (position 20,
            // after space) instead of flag values.
            expect(result.startIndex).toBe(20);
            const flags = result.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeDefined();
            expect(flags!.completions).toContain("--debug");
            expect(flags!.completions).toContain("--level");
        });

        it("treats unrecognized flag prefix as filter text", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly --lev",
                "forward",
                context,
            );
            // "--lev" doesn't resolve (exact match only), so parseParams
            // leaves it unconsumed.  startIndex points to where "--lev"
            // starts — it is the filter text.
            // "@comptest flagsonly " = 20 chars consumed, remainderLength=5,
            // startIndex = 25 - 5 = 20.
            expect(result.startIndex).toBe(20);
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
            const result = await getCommandCompletion(
                "@flattest ",
                "forward",
                context,
            );
            // flattest has no subcommand table (table===undefined),
            // but its descriptor has parameters (args + flags).
            // Should return flag completions.
            const flags = result.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeDefined();
            expect(flags!.completions).toContain("--release");
            // Unfilled "target" arg → not exhaustive.
            expect(result.closedSet).toBe(false);
        });

        it("returns correct startIndex for flat agent with partial token", async () => {
            const result = await getCommandCompletion(
                "@flattest --rel",
                "forward",
                context,
            );
            // "@flattest --rel" (15 chars)
            // startIndex = 15 - 5 ("--rel") = 10 (after space).
            expect(result.startIndex).toBe(10);
            expect(result.closedSet).toBe(false);
        });

        it("falls back to system for agent with no commands", async () => {
            const result = await getCommandCompletion(
                "@nocmdtest ",
                "forward",
                context,
            );
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
                "forward",
                context,
            );
            // "@comptest build " (16 chars)
            // Resolves to default "run" (not explicit match).
            // "build" fills the "task" arg, trailing space present.
            // remainderLength = 0 → startIndex = 16 (includes
            // trailing space).
            // Subcommand names are no longer relevant at this
            // position; only parameter completions remain.
            const subcommands = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeUndefined();
            expect(result.startIndex).toBe(16);
            // All positional args filled, no flags → exhaustive.
            expect(result.closedSet).toBe(true);
        });

        it("keeps subcommands when at the command boundary", async () => {
            const result = await getCommandCompletion(
                "@comptest ",
                "forward",
                context,
            );
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

        it("includes subcommands when no trailing space at default command", async () => {
            const result = await getCommandCompletion(
                "@comptest ne",
                "forward",
                context,
            );
            // "@comptest ne" — suffix is "ne", parameter parsing
            // fully consumes it as the "task" arg.  No trailing space
            // backs up startIndex to 9, which is ≤ commandBoundary
            // (10), so subcommands ARE included.
            const subcommands = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeDefined();
            expect(subcommands!.completions).toContain("nested");
        });
    });

    describe("lastCompletableParam adjusts startIndex", () => {
        it("backs startIndex to open-quote token start for '@comptest run \"bu'", async () => {
            const result = await getCommandCompletion(
                '@comptest run "bu',
                "forward",
                context,
            );
            // '@comptest run "bu' (17 chars)
            // suffix is '"bu', parseParams consumes the open-quoted
            // token through EOF → remainderLength = 0.
            // lastCompletableParam = "task", quoted = false (open quote).
            // Exclusive path: tokenStartIndex = 17 - 3 = 14.
            // startIndex = 14 (no rewind).
            expect(result.startIndex).toBe(14);
            // Agent was invoked → not exhaustive.
            expect(result.closedSet).toBe(false);
            // Flag groups and nextArgs completions should be cleared.
            const flags = result.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeUndefined();
        });

        it("backs startIndex for multi-arg open quote '@comptest twoarg \"partial'", async () => {
            const result = await getCommandCompletion(
                '@comptest twoarg "partial',
                "forward",
                context,
            );
            // '@comptest twoarg "partial' (25 chars)
            // suffix is '"partial', parseParams consumes open quote
            // through EOF → remainderLength = 0.
            // lastCompletableParam = "first", quoted = false.
            // Exclusive path: tokenStartIndex = 25 - 8 = 17.
            // startIndex = 17 (no rewind).
            // "second" from nextArgs should NOT be in agentCommandCompletions.
            expect(result.startIndex).toBe(17);
            expect(result.closedSet).toBe(false);
        });

        it("backs startIndex for implicitQuotes '@comptest search hello world'", async () => {
            const result = await getCommandCompletion(
                "@comptest search hello world",
                "forward",
                context,
            );
            // "@comptest search hello world" (28 chars)
            // suffix is "hello world", implicitQuotes consumes rest
            // of line → remainderLength = 0, token = "hello world".
            // lastCompletableParam = "query", lastParamImplicitQuotes = true.
            // Exclusive path: tokenStartIndex = 28 - 11 = 17.
            // startIndex = 17 (no rewind).
            expect(result.startIndex).toBe(17);
            expect(result.closedSet).toBe(false);
        });

        it("does not adjust startIndex for fully-quoted token", async () => {
            const result = await getCommandCompletion(
                '@comptest run "build"',
                "forward",
                context,
            );
            // '@comptest run "build"' (21 chars)
            // Token '"build"' is fully quoted → isFullyQuoted returns true.
            // Fully-quoted tokens are committed by their closing quote;
            // neither lastCompletableParam nor the fallback back-up fires.
            // startIndex stays at 21.
            expect(result.startIndex).toBe(21);
            expect(result.closedSet).toBe(true);
        });

        it("adjusts startIndex for bare unquoted token without trailing space", async () => {
            const result = await getCommandCompletion(
                "@comptest run bu",
                "forward",
                context,
            );
            // "bu" is not quoted → isFullyQuoted returns undefined.
            // No trailing space → lastCompletableParam exclusive path
            // fires: backs up startIndex to the start of "bu" → 14.
            // Agent IS invoked for "task" completions.
            expect(result.startIndex).toBe(14);
            expect(result.closedSet).toBe(false);
        });
    });

    describe("groupPrefixLength overrides startIndex", () => {
        it("open-quote CJK advances startIndex by matchedPrefixLength", async () => {
            const result = await getCommandCompletion(
                '@comptest grammar "東京タ',
                "forward",
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
            // returns matchedPrefixLength = 3 (1 quote + 2 CJK chars).
            //   startIndex = tokenStartIndex + 3 = 18 + 3 = 21.
            // rawPrefix = "タ", "タワー".startsWith("タ") ✓
            expect(result.startIndex).toBe(21);
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeDefined();
            expect(grammar!.completions).toContain("タワー");
            expect(grammar!.completions).toContain("駅");
            expect(result.closedSet).toBe(false);
        });

        it("implicitQuotes CJK advances startIndex by matchedPrefixLength", async () => {
            const result = await getCommandCompletion(
                "@comptest grammariq 東京タ",
                "forward",
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
            // Agent matches "東京" (2 chars), returns matchedPrefixLength=2.
            //   startIndex = tokenStartIndex + 2 = 20 + 2 = 22.
            // rawPrefix = "タ", "タワー".startsWith("タ") ✓
            expect(result.startIndex).toBe(22);
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeDefined();
            expect(grammar!.completions).toContain("タワー");
            expect(grammar!.completions).toContain("駅");
            expect(result.closedSet).toBe(false);
        });

        it("fully-quoted token does not invoke grammar", async () => {
            const result = await getCommandCompletion(
                '@comptest grammar "東京タ"',
                "forward",
                context,
            );
            // Token '"東京タ"' is fully quoted → isFullyQuoted = true.
            // Fully-quoted tokens are committed; neither
            // lastCompletableParam nor the fallback back-up fires.
            // startIndex stays at 23.
            expect(result.startIndex).toBe(23);
            expect(result.closedSet).toBe(true);
            // No Grammar group since agent wasn't invoked.
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeUndefined();
        });

        it("bare unquoted token invokes grammar without trailing space", async () => {
            const result = await getCommandCompletion(
                "@comptest grammar 東京タ",
                "forward",
                context,
            );
            // "東京タ" has no quotes and no trailing space.
            // lastCompletableParam exclusive path fires
            // (no trailing space && pendingFlag === undefined).
            // Agent is invoked with grammar mock → matches "東京" →
            // returns matchedPrefixLength=2.  tokenStartIndex = 21-3 = 18,
            // startIndex = 18 + 2 = 20.
            expect(result.startIndex).toBe(20);
            expect(result.closedSet).toBe(false);
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeDefined();
            expect(grammar!.completions).toContain("タワー");
            expect(grammar!.completions).toContain("駅");
        });

        it("trailing space without text offers initial completions", async () => {
            const result = await getCommandCompletion(
                "@comptest grammar ",
                "forward",
                context,
            );
            // "@comptest grammar " (18 chars)
            // suffix is "", no tokens parsed → nextArgs = ["phrase"].
            // Agent called, mock sees empty token list → returns
            // completions ["東京"] with no matchedPrefixLength.
            // groupPrefixLength path does not fire.
            // startIndex = 18 (includes trailing space).
            expect(result.startIndex).toBe(18);
            expect(result.closedSet).toBe(false);
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeDefined();
            expect(grammar!.completions).toContain("Tokyo ");
            expect(grammar!.completions).toContain("東京");
        });

        it("clears earlier completions when matchedPrefixLength is set", async () => {
            const result = await getCommandCompletion(
                '@comptest grammar "東京タ',
                "forward",
                context,
            );
            // When groupPrefixLength fires, parameter/flag
            // completions from before the agent call are cleared.
            const flags = result.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeUndefined();
        });

        it("does not override startIndex when matchedPrefixLength is absent", async () => {
            // "run" handler returns groups without matchedPrefixLength.
            // No trailing space → backs up to start of "bu".
            const result = await getCommandCompletion(
                "@comptest run bu",
                "forward",
                context,
            );
            expect(result.startIndex).toBe(14);
        });

        it("English prefix with space separator", async () => {
            const result = await getCommandCompletion(
                "@comptest grammariq Tokyo T",
                "forward",
                context,
            );
            // "@comptest grammariq Tokyo T" (27 chars)
            //   0-8: @comptest  9: sp  10-18: grammariq  19: sp
            //   20-24: Tokyo  25: sp  26: T
            // Token = "Tokyo T" (7 chars), implicitQuotes.
            // lastCompletableParam fires.
            //   tokenStartIndex = 27 - 7 = 20
            //   startIndex = tokenBoundary(input, 20) = 19
            // Mock matches "Tokyo" → matchedPrefixLength=5, separatorMode="space".
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
            expect(result.closedSet).toBe(false);
        });

        it("completed CJK match returns no completions", async () => {
            const result = await getCommandCompletion(
                "@comptest grammariq 東京タワー",
                "forward",
                context,
            );
            // Token = "東京タワー" (5 chars).  Mock matches "東京"
            // and finds suffix "タワー" starts with "タワー" →
            // returns empty (completed match, no more to suggest).
            // agentGroups is [], no matchedPrefixLength.
            // startIndex = tokenBoundary from lastCompletableParam path.
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeUndefined();
            expect(result.closedSet).toBe(false);
        });

        it("no-text offers initial completions via grammariq", async () => {
            const result = await getCommandCompletion(
                "@comptest grammariq ",
                "forward",
                context,
            );
            // "@comptest grammariq " (20 chars)
            // No tokens parsed → nextArgs = ["query"].
            // Mock sees empty token → falls to "no prefix matched"
            // branch → completions: ["Tokyo ", "東京"],
            // matchedPrefixLength: 0, separatorMode: "space".
            // groupPrefixLength = 0 → condition false → skip.
            // startIndex = 20 (includes trailing space).
            expect(result.startIndex).toBe(20);
            const grammar = result.completions.find(
                (g) => g.name === "Grammar",
            );
            expect(grammar).toBeDefined();
            expect(grammar!.completions).toContain("Tokyo ");
            expect(grammar!.completions).toContain("東京");
            expect(result.closedSet).toBe(false);
        });
    });

    describe("Bug 1: fallback startIndex", () => {
        // When the agent has no getCommandCompletion, the fallback
        // path handles no-trailing-space.  startIndex lands at the
        // raw token start position.
        it("startIndex for '@comptest nested sub val' (no agent getCommandCompletion)", async () => {
            const result = await getCommandCompletion(
                "@comptest nested sub val",
                "forward",
                context,
            );
            // "@comptest nested sub val" (24 chars)
            //   0-8: @comptest  9: sp  10-15: nested  16: sp
            //   17-19: sub  20: sp  21-23: val
            // "nested sub" has no getCommandCompletion, so the
            // exclusive path inside `if (agent.getCommandCompletion)`
            // is skipped.  The fallback fires because
            // no trailing space, remainderLength=0, tokens=["val"].
            // It should land at 21 (raw token start of "val").
            expect(result.startIndex).toBe(21);
        });

        it("startIndex for '@comptest nested sub --verbose val' (no agent getCommandCompletion)", async () => {
            const result = await getCommandCompletion(
                "@comptest nested sub --verbose val",
                "forward",
                context,
            );
            // "@comptest nested sub --verbose val" (33 chars)
            //   0-8: @comptest  9: sp  10-15: nested  16: sp
            //   17-19: sub  20: sp  21-29: --verbose  30: sp
            //   31-33: val
            // --verbose is parsed as boolean flag (defaults true),
            // then "val" fills the "value" arg.  No trailing space.
            // startIndex at raw token start of "val" → 31.
            expect(result.startIndex).toBe(31);
        });
    });

    describe("Bug 2: fallback does not fire when agent was invoked", () => {
        // When the last consumed parameter is non-string (e.g. number),
        // lastCompletableParam is undefined so the exclusive path
        // doesn't fire.  But the agent IS invoked for nextArgs.
        // The fallback must NOT back up startIndex because the
        // completions describe the NEXT position, not the current token.
        it("does not back up over number arg for '@numstrtest numstr 42' (no trailing space)", async () => {
            const result = await getCommandCompletion(
                "@numstrtest numstr 42",
                "forward",
                context,
            );
            // "@numstrtest numstr 42" (21 chars)
            //   0-10: @numstrtest  11: sp  12-17: numstr  18: sp
            //   19-20: 42
            // suffix = "42", parseParams consumes 42 as number arg
            // "count".  remainderLength=0, lastCompletableParam=undefined
            // (number type).  nextArgs=["name"], agent invoked for
            // "name" completions.  Fallback should NOT fire because
            // the agent was already invoked — startIndex should stay
            // at the end of consumed text (21), not back up to 19.
            expect(result.startIndex).toBe(21);
            // Agent was invoked for "name" completions.
            const names = result.completions.find((g) => g.name === "Names");
            expect(names).toBeDefined();
            expect(names!.completions).toContain("alice");
            expect(names!.completions).toContain("bob");
            expect(result.closedSet).toBe(false);
        });

        it("baseline: '@numstrtest numstr 42 ' with trailing space works correctly", async () => {
            const result = await getCommandCompletion(
                "@numstrtest numstr 42 ",
                "forward",
                context,
            );
            // "@numstrtest numstr 42 " (22 chars)
            // Trailing space → startIndex = 22 (includes trailing
            // space).
            // Agent invoked for "name" completions.
            expect(result.startIndex).toBe(22);
            const names = result.completions.find((g) => g.name === "Names");
            expect(names).toBeDefined();
            expect(names!.completions).toContain("alice");
            expect(names!.completions).toContain("bob");
            expect(result.closedSet).toBe(false);
        });

        it("does not back up over number arg for '@numstrtest numstr 42 al' (partial second arg)", async () => {
            const result = await getCommandCompletion(
                "@numstrtest numstr 42 al",
                "forward",
                context,
            );
            // "@numstrtest numstr 42 al" (24 chars)
            // suffix = "42 al", parseParams: 42 → count, "al" → name.
            // lastCompletableParam = "name" (string), no trailing space.
            // Exclusive path fires (bare token, no trailing space):
            //   tokenStartIndex = before "al" → 22.
            // Agent invoked for "name".
            expect(result.startIndex).toBe(22);
            const names = result.completions.find((g) => g.name === "Names");
            expect(names).toBeDefined();
            expect(names!.completions).toContain("alice");
            expect(names!.completions).toContain("bob");
            expect(result.closedSet).toBe(false);
        });
    });

    describe("backward direction", () => {
        it("backs up to subcommand alternatives for '@comptest run' backward", async () => {
            // "run" is a valid subcommand of @comptest; with backward
            // direction the user is reconsidering the subcommand choice.
            const result = await getCommandCompletion(
                "@comptest run",
                "backward",
                context,
            );
            // startIndex backs up to the start of "run" in the
            // input (position 10, after "@comptest ").
            expect(result.startIndex).toBe(10);
            const subcommands = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeDefined();
            expect(subcommands!.completions).toContain("run");
            expect(subcommands!.completions).toContain("nested");
            expect(subcommands!.completions).toContain("noop");
            // Subcommand names are exhaustive.
            expect(result.closedSet).toBe(true);
        });

        it("does not back up with trailing space '@comptest run ' backward", async () => {
            // Trailing space means the user already committed "run",
            // so backward doesn't trigger reconsideringCommand; parameter
            // completions are offered instead.
            const result = await getCommandCompletion(
                "@comptest run ",
                "backward",
                context,
            );
            // startIndex should be at the parameter boundary (14,
            // after trailing space), not backed up to subcommand level.
            expect(result.startIndex).toBe(14);
            const subcommands = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeUndefined();
        });

        it("backs up to nested subcommand alternatives for '@comptest nested sub' backward", async () => {
            const result = await getCommandCompletion(
                "@comptest nested sub",
                "backward",
                context,
            );
            // "sub" is a valid subcommand of "nested"; backward
            // should back up to the start of "sub" (position 17,
            // after "@comptest nested ").
            expect(result.startIndex).toBe(17);
            const subcommands = result.completions.find(
                (g) => g.name === "Subcommands",
            );
            expect(subcommands).toBeDefined();
            expect(subcommands!.completions).toContain("sub");
        });

        it("boolean flag '@comptest flagsonly --debug' backward does not back up (boolean consumed)", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly --debug",
                "backward",
                context,
            );
            // "--debug" is a boolean flag — it has no pending value,
            // so the backward flag-backtrack path (pendingFlag) is
            // not triggered.  startIndex is at the end of the input.
            expect(result.startIndex).toBe(27);
        });

        it("backs up to flag alternatives for non-boolean flag '@comptest flagsonly --level' backward", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly --level",
                "backward",
                context,
            );
            // "--level" is a non-boolean flag (its value is pending).
            // Backward backs up to the flag token start.
            const flags = result.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeDefined();
            expect(flags!.completions).toContain("--debug");
            expect(flags!.completions).toContain("--level");
        });

        it("trailing space commits flag — '@comptest flagsonly --level ' backward offers value completions", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly --level ",
                "backward",
                context,
            );
            // Trailing space is a commit signal.  Even though
            // direction is "backward", the flag is committed and
            // value completions should be offered (same as forward).
            // Should NOT back up to flag alternatives.
            const flags = result.completions.find(
                (g) => g.name === "Command Flags",
            );
            expect(flags).toBeUndefined();
            // startIndex includes the trailing space.
            expect(result.startIndex).toBe(28);
        });

        it("forward on '@comptest run' offers parameter completions", async () => {
            // Contrast with the backward test above: forward on a
            // resolved subcommand without trailing space should still
            // offer parameters (task completions from the agent).
            const result = await getCommandCompletion(
                "@comptest run",
                "forward",
                context,
            );
            // With forward, startIndex is at end of "run" (13) and
            // parameter/agent completions are offered.
            expect(result.startIndex).toBe(13);
            // Forward still includes subcommand alternatives since
            // the default subcommand was resolved.
            expect(result.closedSet).toBe(false);
        });

        it("empty input backward does not backtrack", async () => {
            // Empty input with backward shouldn't crash; normalizeCommand
            // generates implicit tokens that are implicitly committed.
            const result = await getCommandCompletion("", "backward", context);
            expect(result).toBeDefined();
            expect(result.completions.length).toBeGreaterThan(0);
        });
    });

    describe("directionSensitive", () => {
        it("is true for '@comptest run' (exact subcommand match)", async () => {
            const result = await getCommandCompletion(
                "@comptest run",
                "forward",
                context,
            );
            // "run" exactly matches a subcommand — backward would
            // reconsider, so the result is direction-sensitive.
            expect(result.directionSensitive).toBe(true);
        });

        it("is true for '@comptest run' backward", async () => {
            const result = await getCommandCompletion(
                "@comptest run",
                "backward",
                context,
            );
            expect(result.directionSensitive).toBe(true);
        });

        it("is false for '@comptest run ' with trailing space (committed)", async () => {
            const result = await getCommandCompletion(
                "@comptest run ",
                "forward",
                context,
            );
            // Trailing space commits the subcommand — direction no
            // longer matters at the command level.
            expect(result.directionSensitive).toBeFalsy();
        });

        it("is true for '@comptest flagsonly --level' (pending flag, no trailing space)", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly --level",
                "forward",
                context,
            );
            // "--level" is a non-boolean flag without trailing space.
            // Backward would back up to flag alternatives.
            expect(result.directionSensitive).toBe(true);
        });

        it("is false for '@comptest flagsonly --level ' (trailing space commits flag)", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly --level ",
                "forward",
                context,
            );
            // Trailing space commits the flag — direction doesn't matter.
            expect(result.directionSensitive).toBeFalsy();
        });

        it("is false for empty input", async () => {
            const result = await getCommandCompletion("", "forward", context);
            // Empty input: normalizeCommand inserts implicit tokens
            // that are inherently committed.
            expect(result.directionSensitive).toBeFalsy();
        });

        it("is false for '@comptest flagsonly --debug' (boolean flag, no pending value)", async () => {
            const result = await getCommandCompletion(
                "@comptest flagsonly --debug",
                "forward",
                context,
            );
            // "--debug" is boolean — fully consumed, no pending flag.
            // No direction-sensitive branch applies.
            expect(result.directionSensitive).toBeFalsy();
        });
    });

    describe("graceful fallback", () => {
        it("backward with unknown agent falls back to system completions", async () => {
            const result = await getCommandCompletion(
                "@nonexistent cmd",
                "backward",
                context,
            );
            expect(result).toBeDefined();
            expect(result.startIndex).toBeGreaterThanOrEqual(0);
            // Should fall back to system agent completions.
            expect(result.completions.length).toBeGreaterThan(0);
            expect(result.directionSensitive).toBeDefined();
        });
    });

    describe("catch block — agent completion throws", () => {
        it("returns safe default when agent getCommandCompletion throws", async () => {
            // throwtest's getCompletion always throws.
            // The catch block in getCommandCompletion should return
            // { startIndex: 0, completions: [], closedSet: false,
            //   directionSensitive: false }.
            const result = await getCommandCompletion(
                "@throwtest boom val",
                "forward",
                context,
            );
            expect(result.startIndex).toBe(0);
            expect(result.completions).toHaveLength(0);
            expect(result.closedSet).toBe(false);
            expect(result.directionSensitive).toBe(false);
        });

        it("returns safe default for throwing agent with backward direction", async () => {
            const result = await getCommandCompletion(
                "@throwtest boom val",
                "backward",
                context,
            );
            expect(result.startIndex).toBe(0);
            expect(result.completions).toHaveLength(0);
            expect(result.closedSet).toBe(false);
            expect(result.directionSensitive).toBe(false);
        });
    });

    describe("backward direction — flat agent (no subcommand table)", () => {
        it("backward on '@flattest' with no trailing space", async () => {
            const result = await getCommandCompletion(
                "@flattest",
                "backward",
                context,
            );
            // "@flattest" — agent recognized but no subcommand table.
            // Backward shouldn't crash even though there are no
            // subcommands to reconsider.
            expect(result).toBeDefined();
            expect(result.startIndex).toBeGreaterThanOrEqual(0);
            expect(result.completions).toBeDefined();
            expect(result.closedSet).toBeDefined();
            expect(result.directionSensitive).toBeDefined();
        });

        it("backward on '@flattest --release' backs up to flag alternatives", async () => {
            const result = await getCommandCompletion(
                "@flattest --release",
                "backward",
                context,
            );
            // "--release" is a boolean flag — fully consumed, so
            // backward does not trigger flag-backtrack.
            expect(result).toBeDefined();
            expect(result.startIndex).toBeGreaterThanOrEqual(0);
            // Boolean flag is consumed — no pending value to reconsider.
            expect(result.directionSensitive).toBeFalsy();
        });

        it("directionSensitive is false for '@flattest ' with trailing space", async () => {
            const result = await getCommandCompletion(
                "@flattest ",
                "forward",
                context,
            );
            // Trailing space commits — no direction-sensitive boundary.
            // Flat agents have no subcommand to reconsider.
            expect(result.directionSensitive).toBeFalsy();
        });
    });

    describe("afterWildcard propagation", () => {
        it('propagates afterWildcard="all" from agent result', async () => {
            const result = await getCommandCompletion(
                "@comptest wildcard hello",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            expect(result.afterWildcard).toBe("all");
        });

        it('afterWildcard defaults to "none" when agent does not set it', async () => {
            const result = await getCommandCompletion(
                "@comptest run ",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            expect(result.afterWildcard).toBe("none");
        });

        it('afterWildcard is "none" for commands with no agent completion', async () => {
            const result = await getCommandCompletion(
                "@comptest noop",
                "forward",
                context,
            );
            expect(result).toBeDefined();
            expect(result.afterWildcard).toBe("none");
        });
    });

    // ── Gap 1: separatorMode override logic when matchedPrefixLength=0 ──

    describe("separatorMode override when agent has not advanced prefix (mpl=0)", () => {
        // When the agent returns matchedPrefixLength=0 (or undefined),
        // the dispatcher overrides per-group separatorMode based on
        // target.separatorMode (which reflects trailing whitespace).
        // Groups with autoSpacePunctuation / spacePunctuation /
        // optionalSpacePunctuation are resolved to either
        // "optionalSpacePunctuation" (if target has "optionalSpace")
        // or "spacePunctuation" (otherwise).  Other modes get the
        // target's separatorMode directly.

        it("autoSpacePunctuation with trailing space → optionalSpacePunctuation", async () => {
            // "@automodetest auto " — trailing space makes target.separatorMode = "optionalSpace"
            const result = await getCommandCompletion(
                "@automodetest auto ",
                "forward",
                context,
            );
            const group = result.completions.find(
                (g) => g.name === "AutoEntities",
            );
            expect(group).toBeDefined();
            expect(group!.separatorMode).toBe("optionalSpacePunctuation");
        });

        it("autoSpacePunctuation without trailing space → spacePunctuation", async () => {
            // "@automodetest auto" — no trailing space, target.separatorMode = undefined
            const result = await getCommandCompletion(
                "@automodetest auto",
                "forward",
                context,
            );
            // Agent returns mpl=0 and autoSpacePunctuation.
            // target.separatorMode is undefined (no trailing whitespace
            // after the implicit-default-subcommand boundary at pos 13).
            // Override: auto/spacePunct/optPunct without optionalSpace → "spacePunctuation".
            const group = result.completions.find(
                (g) => g.name === "AutoEntities",
            );
            expect(group).toBeDefined();
            expect(group!.separatorMode).toBe("spacePunctuation");
        });

        it("spacePunctuation with trailing space → optionalSpacePunctuation", async () => {
            const result = await getCommandCompletion(
                "@automodetest spacepunct ",
                "forward",
                context,
            );
            const group = result.completions.find(
                (g) => g.name === "SpacePunctEntities",
            );
            expect(group).toBeDefined();
            expect(group!.separatorMode).toBe("optionalSpacePunctuation");
        });

        it("spacePunctuation without trailing space → spacePunctuation", async () => {
            const result = await getCommandCompletion(
                "@automodetest spacepunct",
                "forward",
                context,
            );
            const group = result.completions.find(
                (g) => g.name === "SpacePunctEntities",
            );
            expect(group).toBeDefined();
            expect(group!.separatorMode).toBe("spacePunctuation");
        });

        it("optionalSpacePunctuation with trailing space → optionalSpacePunctuation", async () => {
            const result = await getCommandCompletion(
                "@automodetest optpunct ",
                "forward",
                context,
            );
            const group = result.completions.find(
                (g) => g.name === "OptPunctEntities",
            );
            expect(group).toBeDefined();
            expect(group!.separatorMode).toBe("optionalSpacePunctuation");
        });

        it("optionalSpacePunctuation without trailing space → spacePunctuation", async () => {
            const result = await getCommandCompletion(
                "@automodetest optpunct",
                "forward",
                context,
            );
            const group = result.completions.find(
                (g) => g.name === "OptPunctEntities",
            );
            expect(group).toBeDefined();
            expect(group!.separatorMode).toBe("spacePunctuation");
        });

        it("none mode with trailing space → overridden to optionalSpace", async () => {
            const result = await getCommandCompletion(
                "@automodetest nonemode ",
                "forward",
                context,
            );
            const group = result.completions.find(
                (g) => g.name === "NoneEntities",
            );
            expect(group).toBeDefined();
            // "none" is not auto/spacePunct/optPunct so takes target.separatorMode directly.
            expect(group!.separatorMode).toBe("optionalSpace");
        });

        it("none mode without trailing space → overridden to target (undefined)", async () => {
            const result = await getCommandCompletion(
                "@automodetest nonemode",
                "forward",
                context,
            );
            const group = result.completions.find(
                (g) => g.name === "NoneEntities",
            );
            expect(group).toBeDefined();
            // target.separatorMode is undefined (default "space")
            expect(group!.separatorMode).toBeUndefined();
        });

        it("undefined matchedPrefixLength triggers override path", async () => {
            const result = await getCommandCompletion(
                "@automodetest nompl ",
                "forward",
                context,
            );
            // nompl handler returns no matchedPrefixLength at all.
            // Override branch fires (groupPrefixLength undefined).
            const group = result.completions.find(
                (g) => g.name === "NoMplEntities",
            );
            expect(group).toBeDefined();
            expect(group!.separatorMode).toBe("optionalSpacePunctuation");
        });
    });

    // ── Gap 2: inferSeparatorMode at position 0 ──────────────────────────

    describe("inferSeparatorMode at position 0 (empty parameter input)", () => {
        it("returns optionalSpace for resolved agent with no parameter text", async () => {
            // "@automodetest " — default subcommand "auto" resolved,
            // no parameter text typed.  inferSeparatorMode(input, 14)
            // sees trailing space → optionalSpace.
            const result = await getCommandCompletion(
                "@automodetest ",
                "forward",
                context,
            );
            // Agent returns autoSpacePunctuation, trailing space makes
            // target.separatorMode = "optionalSpace", auto → optionalSpacePunctuation.
            const group = result.completions.find(
                (g) => g.name === "AutoEntities",
            );
            expect(group).toBeDefined();
            expect(group!.separatorMode).toBe("optionalSpacePunctuation");
        });

        it("empty input (@) returns optionalSpace for agent names", async () => {
            // Position 0 in "@" → inferSeparatorMode returns "optionalSpace"
            // at the command level.
            const result = await getCommandCompletion("@", "forward", context);
            const agentNamesGroup = result.completions.find(
                (g) => g.name === "Agent Names",
            );
            expect(agentNamesGroup).toBeDefined();
            expect(agentNamesGroup!.separatorMode).toBe("optionalSpace");
        });

        it("completely empty input returns optionalSpace", async () => {
            const result = await getCommandCompletion("", "forward", context);
            // System completions at position 0.
            expect(result).toBeDefined();
            for (const group of result.completions) {
                // All groups at position 0 should have optionalSpace
                // since inferSeparatorMode(text, 0) returns "optionalSpace".
                expect(group.separatorMode).toBe("optionalSpace");
            }
        });
    });
});
