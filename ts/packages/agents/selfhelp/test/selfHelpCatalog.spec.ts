// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Unit tests for the deterministic core of the Help agent: catalog
// projection/pairing (selectRelevantGroups, formatGrounding) and the markdown
// renderer. No LLM is involved - a small synthetic catalog exercises the same
// command<->action linking the real Action Browser catalog carries.

import {
    Catalog,
    cleanDescription,
    cleanPhrasing,
    findAgent,
    formatAgentRoster,
    formatGrounding,
    groupForAgent,
    indexCatalog,
    selectRelevantGroups,
} from "../src/catalog.js";
import { CommandHelpResponse } from "../src/commandHelpResponseSchema.js";
import { renderStructured } from "../src/render.js";

function makeCatalog(): Catalog {
    return {
        generatedAt: "test",
        agents: [
            {
                name: "system",
                category: "System",
                emoji: "🔧",
                description: "Built-in system agent",
                schemas: [
                    {
                        schemaName: "system",
                        description: "system",
                        defaultEnabled: true,
                        transient: false,
                        actions: [
                            {
                                actionName: "newConversation",
                                description: "Create a new conversation",
                                parameters: [],
                                phrasings: [
                                    "start a new conversation",
                                    "new conversation called design review",
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
        commands: [
            {
                host: "system",
                path: "conversation new",
                description:
                    "Create a new conversation, optionally with a name",
                group: false,
                args: [
                    {
                        name: "name",
                        type: "string",
                        optional: true,
                        description: "Name for the new conversation",
                    },
                ],
                flags: [],
                action: { actionName: "newConversation" },
            },
            {
                host: "system",
                path: "history save",
                description: "Save the chat history to a file",
                group: false,
                args: [
                    {
                        name: "file",
                        type: "string",
                        optional: false,
                        description: "File to save to",
                    },
                ],
                flags: [],
            },
        ],
        counts: { agents: 1, actions: 1, commands: 2 },
    };
}

describe("selectRelevantGroups", () => {
    test("keeps a matched command together with its linked action", () => {
        const index = indexCatalog(makeCatalog());
        const groups = selectRelevantGroups(index, "create a new conversation");

        const system = groups.find((g) => g.host === "system");
        expect(system).toBeDefined();
        expect(system!.commands.map((c) => c.path)).toContain(
            "conversation new",
        );
        expect(system!.actions.map((a) => a.actionName)).toContain(
            "newConversation",
        );
    });

    test("matches via the linked action's phrasings, not just the command text", () => {
        const index = indexCatalog(makeCatalog());
        // "design review" only appears in the action's phrasings.
        const groups = selectRelevantGroups(index, "new design review");
        const system = groups.find((g) => g.host === "system");
        expect(system?.commands.map((c) => c.path)).toContain(
            "conversation new",
        );
    });

    test("falls back to all commands when nothing matches", () => {
        const index = indexCatalog(makeCatalog());
        const groups = selectRelevantGroups(index, "xyzzy nothing matches");
        const paths = groups.flatMap((g) => g.commands.map((c) => c.path));
        expect(paths).toContain("conversation new");
        expect(paths).toContain("history save");
    });
});

describe("formatGrounding", () => {
    test("surfaces the command's action link and the action's phrasings", () => {
        const index = indexCatalog(makeCatalog());
        const text = formatGrounding(
            selectRelevantGroups(index, "create a new conversation"),
        );
        expect(text).toContain('commandPath: "conversation new"');
        expect(text).toContain("(action: newConversation)");
        expect(text).toContain('actionName: "newConversation"');
        expect(text).toContain("start a new conversation");
    });
});

describe("renderStructured", () => {
    test("renders the command as a card with the paired phrasing from the link alone", () => {
        const index = indexCatalog(makeCatalog());
        // The model returned only the command; the phrasings come from the
        // command's declared action link, not from the model.
        const response: CommandHelpResponse = {
            summary: "Use the conversation command.",
            ways: [
                { host: "system", commandPath: "conversation new", does: "" },
            ],
        };
        const blocks = renderStructured(response, index);
        expect(blocks[0]).toMatchObject({
            kind: "text",
            text: "Use the conversation command.",
        });
        const card = blocks.find((b) => b.kind === "card") as any;
        expect(card).toBeDefined();
        expect(card.title).toBe("@conversation new [<name>]");
        expect(card.subtitle).toBe(
            "Create a new conversation, optionally with a name",
        );
        expect(card.fields[0].label).toBe("Or say");
        expect(card.fields[0].value).toContain("start a new conversation");
    });

    test("a command with no action link has no phrasing field", () => {
        const index = indexCatalog(makeCatalog());
        const response: CommandHelpResponse = {
            summary: "Save it.",
            ways: [{ host: "system", commandPath: "history save", does: "" }],
        };
        const card = renderStructured(response, index).find(
            (b) => b.kind === "card",
        ) as any;
        expect(card.title).toBe("@history save <file>");
        expect(card.fields).toBeUndefined();
    });

    test("empty ways points the user at @help", () => {
        const index = indexCatalog(makeCatalog());
        const blocks = renderStructured({ summary: "", ways: [] }, index);
        const text = blocks
            .filter((b) => b.kind === "text")
            .map((b) => (b as any).text)
            .join(" ");
        expect(text).toContain("@help");
    });
});

describe("cleanPhrasing", () => {
    test("drops {polite} filler and shows slots as <slot>", () => {
        expect(
            cleanPhrasing("{polite} create new conversation called {name}"),
        ).toBe("create new conversation called <name>");
        expect(cleanPhrasing("{polite} new conversation")).toBe(
            "new conversation",
        );
    });
});

describe("cleanDescription", () => {
    test("drops few-shot examples and JSON blobs", () => {
        expect(
            cleanDescription(
                'Create a new conversation. Example: User: new conversation Agent: { actionName: "newConversation", parameters: {} }',
            ),
        ).toBe("Create a new conversation.");
    });
});

// A two-agent catalog for the agent-scoped selection used by describeAgent.
function makeMultiCatalog(): Catalog {
    return {
        generatedAt: "test",
        agents: [
            {
                name: "browser",
                category: "App",
                emoji: "🌐",
                description: "Control the web browser",
                schemas: [
                    {
                        schemaName: "browser",
                        description: "browser",
                        defaultEnabled: true,
                        transient: false,
                        actions: [
                            {
                                actionName: "openTab",
                                description: "Open a new browser tab",
                                parameters: [],
                                phrasings: ["open a new tab"],
                            },
                            {
                                actionName: "closeTab",
                                description: "Close the current tab",
                                parameters: [],
                                phrasings: ["close this tab"],
                            },
                        ],
                    },
                ],
            },
            {
                name: "list",
                category: "App",
                emoji: "📝",
                description: "Manage lists",
                schemas: [
                    {
                        schemaName: "list",
                        description: "list",
                        defaultEnabled: true,
                        transient: false,
                        actions: [
                            {
                                actionName: "removeItem",
                                description: "Remove an item from a list",
                                parameters: [],
                                phrasings: ["remove eggs from my grocery list"],
                            },
                        ],
                    },
                ],
            },
        ],
        commands: [
            {
                host: "browser",
                path: "browser open",
                description: "Open a browser tab",
                group: false,
                args: [],
                flags: [],
                action: { actionName: "openTab" },
            },
        ],
        counts: { agents: 2, actions: 3, commands: 1 },
    };
}

describe("findAgent", () => {
    test("resolves an explicit agent name exactly", () => {
        const index = indexCatalog(makeMultiCatalog());
        const agent = findAgent(index, "does it remove things", "list");
        expect(agent?.name).toBe("list");
    });

    test("resolves the agent named in the question", () => {
        const index = indexCatalog(makeMultiCatalog());
        const agent = findAgent(index, "what can the browser agent do");
        expect(agent?.name).toBe("browser");
    });

    test("matches on an action phrasing when no agent is named", () => {
        const index = indexCatalog(makeMultiCatalog());
        const agent = findAgent(index, "how do I remove eggs from a list");
        expect(agent?.name).toBe("list");
    });

    test("returns undefined when nothing overlaps", () => {
        const index = indexCatalog(makeMultiCatalog());
        expect(findAgent(index, "xyzzy nothing here")).toBeUndefined();
    });
});

describe("groupForAgent", () => {
    test("returns all of the agent's actions and its commands", () => {
        const index = indexCatalog(makeMultiCatalog());
        const agent = findAgent(index, "browser")!;
        const group = groupForAgent(index, agent);
        expect(group.host).toBe("browser");
        expect(group.actions.map((a) => a.actionName).sort()).toEqual([
            "closeTab",
            "openTab",
        ]);
        expect(group.commands.map((c) => c.path)).toEqual(["browser open"]);
    });
});

describe("formatAgentRoster", () => {
    test("summarizes the installed agents with a count and names", () => {
        const index = indexCatalog(makeMultiCatalog());
        const roster = formatAgentRoster(index);
        expect(roster).toContain("Installed agents (2)");
        expect(roster).toContain("browser");
        expect(roster).toContain("list");
    });

    test("truncates to the sample size and reports the remainder", () => {
        const index = indexCatalog(makeMultiCatalog());
        const roster = formatAgentRoster(index, 1);
        expect(roster).toContain("and 1 more");
    });
});
