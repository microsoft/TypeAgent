// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import type {
    AgentSchemaInfo,
    DispatcherStatus,
} from "@typeagent/dispatcher-types";
import {
    buildActionCommand,
    filterActiveAgentSchemas,
    findActionSubSchema,
    getAgentActionNames,
} from "@typeagent/dispatcher-types/helpers/actionDispatch";

function agent(
    name: string,
    subSchemas: { schemaName: string; actions: string[] }[],
): AgentSchemaInfo {
    return {
        name,
        emoji: "🎵",
        description: `${name} agent`,
        subSchemas: subSchemas.map((subSchema) => ({
            schemaName: subSchema.schemaName,
            description: `${subSchema.schemaName} schema`,
            schemaText: `type ${subSchema.schemaName} = {};`,
            actions: subSchema.actions.map((actionName) => ({
                name: actionName,
                description: `${actionName} description`,
            })),
        })),
    };
}

function status(active: Record<string, boolean>): DispatcherStatus {
    return {
        agents: Object.entries(active).map(([name, isActive]) => ({
            emoji: "🎵",
            name,
            lastUsed: false,
            priority: false,
            request: false,
            active: isActive,
            actionActive: isActive,
        })),
        details: "",
    };
}

describe("buildActionCommand", () => {
    it("dispatches through @action instead of natural language", () => {
        expect(
            buildActionCommand({
                schemaName: "player",
                actionName: "createPlaylist",
                parameters: { name: "Top Jazz" },
            }),
        ).toBe(
            `@action player createPlaylist --parameters '{"name":"Top Jazz"}'`,
        );
    });

    it("omits an empty parameter object", () => {
        expect(
            buildActionCommand({
                schemaName: "player",
                actionName: "pause",
                parameters: {},
            }),
        ).toBe("@action player pause");
    });

    it("keeps apostrophes in parameters parseable by the command tokenizer", () => {
        const command = buildActionCommand({
            schemaName: "list",
            actionName: "addItems",
            parameters: { items: ["Bob's milk"] },
        });

        const json = command.slice(
            command.indexOf("'") + 1,
            command.lastIndexOf("'"),
        );
        expect(json).not.toContain("'");
        expect(JSON.parse(json)).toEqual({ items: ["Bob's milk"] });
    });

    it("quotes a natural language phrase with a quote character it does not use", () => {
        expect(
            buildActionCommand({
                schemaName: "player",
                actionName: "play",
                naturalLanguage: "play Bob's song",
            }),
        ).toBe(`@action player play --naturalLanguage "play Bob's song"`);
    });

    it("drops a natural language phrase that cannot round-trip", () => {
        expect(
            buildActionCommand({
                schemaName: "player",
                actionName: "play",
                naturalLanguage: `play Bob's "best" song`,
            }),
        ).toBe("@action player play");
    });

    it("ignores a blank natural language phrase", () => {
        expect(
            buildActionCommand({
                schemaName: "player",
                actionName: "play",
                naturalLanguage: "   ",
            }),
        ).toBe("@action player play");
    });

    it("rejects names that would add command tokens", () => {
        expect(() =>
            buildActionCommand({
                schemaName: "player --parameters '{}'",
                actionName: "play",
            }),
        ).toThrow("Invalid schema name");
        expect(() =>
            buildActionCommand({
                schemaName: "player",
                actionName: "play; @shutdown",
            }),
        ).toThrow("Invalid action name");
    });

    it("accepts dotted sub-schema names", () => {
        expect(
            buildActionCommand({
                schemaName: "desktop.desktop-taskbar",
                actionName: "alignTaskbar",
            }),
        ).toBe("@action desktop.desktop-taskbar alignTaskbar");
    });
});

describe("filterActiveAgentSchemas", () => {
    const schemas = [
        agent("player", [{ schemaName: "player", actions: ["play"] }]),
        agent("desktop", [
            { schemaName: "desktop", actions: ["launchApp"] },
            { schemaName: "desktop.desktop-taskbar", actions: ["align"] },
        ]),
    ];

    it("drops disabled sub-schemas but keeps the rest of the agent", () => {
        const filtered = filterActiveAgentSchemas(
            schemas,
            status({
                player: true,
                desktop: true,
                "desktop.desktop-taskbar": false,
            }),
        );

        expect(filtered.map((a) => a.name)).toEqual(["player", "desktop"]);
        expect(
            filtered[1].subSchemas.map((subSchema) => subSchema.schemaName),
        ).toEqual(["desktop"]);
    });

    it("drops an agent whose sub-schemas are all disabled", () => {
        const filtered = filterActiveAgentSchemas(
            schemas,
            status({
                player: false,
                desktop: true,
                "desktop.desktop-taskbar": true,
            }),
        );

        expect(filtered.map((a) => a.name)).toEqual(["desktop"]);
    });

    it("keeps sub-schemas the status does not mention", () => {
        const filtered = filterActiveAgentSchemas(schemas, status({}));

        expect(filtered).toEqual(schemas);
    });

    it("does not mutate the input schemas", () => {
        filterActiveAgentSchemas(schemas, status({ desktop: false }));

        expect(schemas[1].subSchemas).toHaveLength(2);
    });

    it("hides a schema whose actions are off even when its commands are on", () => {
        // `active` is true when either actions or commands are enabled, but
        // @action only runs when the actions themselves are enabled.
        const filtered = filterActiveAgentSchemas(schemas, {
            agents: [
                {
                    emoji: "🎵",
                    name: "player",
                    lastUsed: false,
                    priority: false,
                    request: false,
                    active: true,
                    actionActive: false,
                },
            ],
            details: "",
        });

        expect(filtered.map((a) => a.name)).toEqual(["desktop"]);
    });

    it("falls back to active for servers that do not report actionActive", () => {
        const filtered = filterActiveAgentSchemas(schemas, {
            agents: [
                {
                    emoji: "🎵",
                    name: "player",
                    lastUsed: false,
                    priority: false,
                    request: false,
                    active: false,
                },
            ],
            details: "",
        });

        expect(filtered.map((a) => a.name)).toEqual(["desktop"]);
    });
});

describe("agent action lookup", () => {
    const desktop = agent("desktop", [
        { schemaName: "desktop", actions: ["launchApp"] },
        { schemaName: "desktop.desktop-taskbar", actions: ["alignTaskbar"] },
    ]);

    it("finds the sub-schema that declares an action, ignoring case", () => {
        expect(findActionSubSchema(desktop, "aligntaskbar")).toMatchObject({
            subSchema: { schemaName: "desktop.desktop-taskbar" },
            action: { name: "alignTaskbar" },
        });
    });

    it("returns undefined for an unknown action", () => {
        expect(findActionSubSchema(desktop, "nope")).toBeUndefined();
    });

    it("lists every action name across sub-schemas", () => {
        expect(getAgentActionNames(desktop)).toEqual([
            "launchApp",
            "alignTaskbar",
        ]);
    });
});
