// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import { getCommandInterface } from "@typeagent/agent-sdk/helpers/command";
import { AppAgentProvider } from "../src/agentProvider/agentProvider.js";
import {
    type CommandHandlerContext,
    closeCommandHandlerContext,
    initializeCommandHandlerContext,
} from "../src/context/commandHandlerContext.js";
import { collectCommandReferenceMarkdown } from "../src/command/commandReference.js";

// A small inline agent that exercises the generator's edge cases: an inline
// default subcommand, a nested subcommand, optional/multiple args, and boolean
// and typed flags (with char + default).
const manifest: AppAgentManifest = {
    emojiChar: "🧪",
    description: "Doc reference test agent",
};

const handlers = {
    description: "Doc Reference Test Commands",
    commands: {
        run: {
            description: "Run a task",
            parameters: {
                args: {
                    task: {
                        description: "Task name",
                    },
                    rest: {
                        description: "Extra tokens",
                        optional: true,
                        multiple: true,
                    },
                },
                flags: {
                    verbose: {
                        description: "Enable verbose output",
                        type: "boolean" as const,
                        char: "v",
                        default: false,
                    },
                    level: {
                        description: "Log level",
                        type: "string" as const,
                    },
                },
            },
            run: async () => {},
        },
        group: {
            description: "A subcommand group",
            commands: {
                leaf: {
                    description: "A leaf command",
                    run: async () => {},
                },
            },
        },
    },
} as const;

const agent: AppAgent = { ...getCommandInterface(handlers) };

const testAgentProvider: AppAgentProvider = {
    getAppAgentNames: () => ["doctest"],
    getAppAgentManifest: async (name: string) => {
        if (name !== "doctest") throw new Error(`Unknown app agent: ${name}`);
        return manifest;
    },
    loadAppAgent: async (name: string) => {
        if (name !== "doctest") throw new Error(`Unknown app agent: ${name}`);
        return agent;
    },
    unloadAppAgent: async (name: string) => {
        if (name !== "doctest") throw new Error(`Unknown app agent: ${name}`);
    },
};

describe("collectCommandReferenceMarkdown", () => {
    let context: CommandHandlerContext;
    let markdown: string;

    beforeAll(async () => {
        context = await initializeCommandHandlerContext("test", {
            agents: {
                actions: false,
                schemas: false,
                commands: true,
            },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
            appAgentProviders: [testAgentProvider],
        });
        markdown = await collectCommandReferenceMarkdown(context);
    });

    afterAll(async () => {
        if (context) {
            await closeCommandHandlerContext(context);
        }
    });

    it("renders a system command with flags before args in the usage line", () => {
        expect(markdown).toContain("## @action - Execute an action");
        const actionIdx = markdown.indexOf("## @action - Execute an action");
        const usageLine = markdown
            .slice(actionIdx)
            .split("\n")
            .find((line) => line.startsWith("Usage:"));
        expect(usageLine).toBeDefined();
        // Positional args are emitted after all flags.
        expect(usageLine!.endsWith("<schemaName> <actionName>`")).toBe(true);
        // The `parameters` flag appears before the positional args.
        expect(usageLine!.indexOf("[--parameters <json>]")).toBeGreaterThan(0);
        expect(usageLine!.indexOf("[--parameters <json>]")).toBeLessThan(
            usageLine!.indexOf("<schemaName>"),
        );
    });

    it("escapes angle brackets in argument bullets", () => {
        expect(markdown).toContain(
            "- &lt;schemaName&gt; - Action schema name (type: string)",
        );
    });

    it("normalizes flag types to escaped angle brackets in bullets", () => {
        // Drift fix: the hand-written doc left `--parameters <json>` unescaped.
        expect(markdown).toContain(
            "- --parameters &lt;json&gt; : Action parameter",
        );
    });

    it("renders an inline default subcommand at the parent path (@clear)", () => {
        expect(markdown).toContain("## @clear - Clear the console");
        expect(markdown).toContain("## @clear deep -");
    });

    it("prefixes non-system agents with the agent name (@dispatcher request)", () => {
        expect(markdown).toContain("## @dispatcher request -");
        // system is the default agent — no `@system` prefix.
        expect(markdown).not.toContain("## @system ");
    });

    it("renders optional + multiple args and boolean/typed flags for a custom agent", () => {
        expect(markdown).toContain("## @doctest run - Run a task");
        // Flags precede args in the usage line, and (like getUsage) are emitted
        // in reverse definition order via unshift: level before verbose.
        expect(markdown).toContain(
            "Usage: `@doctest run [--level <string>] [-v|--verbose] <task> [<rest>...]`",
        );
        expect(markdown).toContain(
            "- &lt;rest&gt; - (optional) Extra tokens (type: string)",
        );
        expect(markdown).toContain(
            "- --verbose -v : Enable verbose output (default: false)",
        );
        expect(markdown).toContain("- --level &lt;string&gt; : Log level");
    });

    it("recurses into nested subcommand groups", () => {
        expect(markdown).toContain("## @doctest group leaf - A leaf command");
    });

    it("omits Flags/Arguments sections for parameter-less commands", () => {
        const exitIndex = markdown.indexOf("## @exit -");
        expect(exitIndex).toBeGreaterThanOrEqual(0);
        const nextSection = markdown.indexOf("\n## ", exitIndex + 1);
        const exitBlock = markdown.slice(
            exitIndex,
            nextSection === -1 ? undefined : nextSection,
        );
        expect(exitBlock).toContain("Usage: `@exit`");
        expect(exitBlock).not.toContain("### Flags:");
        expect(exitBlock).not.toContain("### Arguments:");
    });
});
