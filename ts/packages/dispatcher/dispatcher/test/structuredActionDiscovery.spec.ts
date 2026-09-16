// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { ActionPolicy, AppAgent } from "@typeagent/agent-sdk";
import type {
    ActionContractResult,
    ActionIdentity,
} from "@typeagent/dispatcher-types";
import { parseActionSchemaSource } from "@typeagent/action-schema";
import { AppAgentManager } from "../src/context/appAgentManager.js";
import { PortRegistrar } from "../src/context/portRegistrar.js";
import {
    convertToActionConfig,
    type ActionConfig,
} from "../src/translation/actionConfig.js";
import { StructuredActionDiscovery } from "../src/structuredAction/discovery.js";

const source = `
export type Actions = Select | Clear | Ping;
// Select an item.
export type Select = {
    actionName: "select";
    parameters: {
        item: Item;
        note?: string;
        comments?: string;
    };
};
type Item = {
    color: Color;
    details?: { label: string; count?: number };
};
type Color = "red" | "blue";
type Clear = { actionName: "clear"; parameters: { all: boolean } };
type Ping = { actionName: "ping" };
`;

const identity: ActionIdentity = {
    schemaName: "test.items",
    actionName: "select",
};

type AgentFixture = {
    schemas: Set<string>;
    actions: Set<string>;
    commands: boolean;
    appAgent: AppAgent;
    sessionContext?: object;
};

function fixture(content = source, policies?: Record<string, ActionPolicy>) {
    const agents = new AppAgentManager(undefined, new PortRegistrar());
    // Seed only the manager's persisted/loaded state; all discovery, parsing,
    // enablement, readiness snapshots, and fingerprinting run their real code.
    const state = agents as unknown as {
        agents: Map<string, AgentFixture>;
        actionConfigs: Map<string, ActionConfig>;
        transientAgents: Record<string, boolean>;
    };
    const configs = convertToActionConfig("test", {
        description: "Test agent",
        emojiChar: "",
        subActionManifests: {
            items: {
                schema: {
                    description: "Items",
                    schemaType: "Actions",
                    schemaFile: { format: "ts", content },
                    ...(policies === undefined
                        ? {}
                        : { actionPolicies: policies }),
                },
            },
            other: {
                schema: {
                    description: "Other",
                    schemaType: "Other",
                    schemaFile: {
                        format: "ts",
                        content:
                            'export type Other = { actionName: "select"; parameters: { id: number } };',
                    },
                },
            },
        },
    });
    for (const config of Object.values(configs)) {
        state.actionConfigs.set(config.schemaName, config);
    }
    const hooks = {
        executeAction: jest.fn<NonNullable<AppAgent["executeAction"]>>(),
        updateAgentContext:
            jest.fn<NonNullable<AppAgent["updateAgentContext"]>>(),
        setup: jest.fn<NonNullable<AppAgent["setup"]>>(),
        checkReadiness: jest.fn<NonNullable<AppAgent["checkReadiness"]>>(),
    };
    const agent: AgentFixture = {
        schemas: new Set(Object.keys(configs)),
        actions: new Set(Object.keys(configs)),
        commands: true,
        appAgent: hooks,
        sessionContext: {},
    };
    state.agents.set("test", agent);
    const context = { agents, session: {} };
    return {
        agents,
        state,
        agent,
        hooks,
        context,
        service: new StructuredActionDiscovery(context),
    };
}

function found(result: ActionContractResult) {
    if (result.status !== "found") {
        throw new Error("Expected contract");
    }
    return result.contract;
}

async function fingerprint(content = source, policy?: ActionPolicy) {
    const { service } = fixture(
        content,
        policy ? { select: policy } : undefined,
    );
    return found(await service.getActionContract(identity)).fingerprint;
}

describe("structured action contracts", () => {
    it("retrieves exactly one action directly, with a closed dependency graph", async () => {
        const { service, agents } = fixture();
        const enumerate = jest.spyOn(agents, "getActionConfigs");
        const result = await service.getActionContract(identity);
        const contract = found(result);
        expect(enumerate).not.toHaveBeenCalled();
        expect(result.protocolVersion).toBe(1);
        expect(result.scopeId).toEqual(expect.any(String));
        expect(contract.input.format).toBe("typescript");
        expect(contract.input.schemaText).toContain(
            'type Color = "red" | "blue"',
        );
        expect(contract.input.schemaText).toContain("note?: string");
        expect(contract.input.schemaText).toContain("details?:");
        expect(contract.input.schemaText).not.toContain("type Clear");
        expect(contract.input.schemaText).not.toContain("type Actions");
        const reparsed = parseActionSchemaSource(
            contract.input.schemaText,
            identity.schemaName,
            contract.input.typeName,
        );
        expect([...reparsed.actionSchemas.keys()]).toEqual(["select"]);
        expect(contract.output).toMatchObject({
            envelope: "ActionResult",
            resultValue: { type: "unknown", optional: true },
            resultEntity: { type: "Entity", optional: true },
            entities: { type: "Entity[]", optional: true },
        });
        expect(contract).not.toHaveProperty("availability");
    });

    it("distinguishes duplicate action names and rejects case-insensitive guesses", async () => {
        const { service } = fixture();
        const other = found(
            await service.getActionContract({
                schemaName: "test.other",
                actionName: "select",
            }),
        );
        expect(other.input.schemaText).toContain("id: number");
        for (const missing of [
            { schemaName: "test", actionName: "select" },
            { schemaName: "TEST.items", actionName: "select" },
            { schemaName: "test.items", actionName: "SELECT" },
        ]) {
            expect((await service.getActionContract(missing)).status).toBe(
                "not-found",
            );
        }
    });

    it("handles no parameters and an optional parameter object", async () => {
        const { service } = fixture();
        expect(
            found(
                await service.getActionContract({
                    ...identity,
                    actionName: "ping",
                }),
            ).input.schemaText,
        ).not.toContain("parameters");
        const optional = fixture(
            source.replace("parameters: {", "parameters?: {"),
        );
        expect(
            found(await optional.service.getActionContract(identity)).input
                .schemaText,
        ).toContain("parameters?:");
    });

    it("closes recursive references without importing sibling actions", async () => {
        const recursive = fixture(
            source.replace(
                "color: Color;",
                "color: Color;\n    children?: Item[];",
            ),
        );
        const contract = found(
            await recursive.service.getActionContract(identity),
        );
        expect(contract.input.schemaText).toContain("children?: Item[]");
        expect(contract.input.schemaText.match(/type Item =/g)).toHaveLength(1);
        expect(contract.input.schemaText).not.toContain("type Clear");
        expect(
            await fingerprint(
                source.replace(
                    "color: Color;",
                    "color: Color;\n    children?: Item[];",
                ),
            ),
        ).toBe(contract.fingerprint);
    });

    it("fingerprints execution semantics, not descriptions, ordering, or siblings", async () => {
        const original = await fingerprint();
        expect(
            await fingerprint(
                source.replace("Select an item.", "A better description."),
            ),
        ).toBe(original);
        expect(
            await fingerprint(
                source.replace(
                    "note?: string;",
                    "note?: string; // explanation",
                ),
            ),
        ).toBe(original);
        expect(
            await fingerprint(
                source.replace(
                    "note?: string;\n        comments?: string;",
                    "comments?: string;\n        note?: string;",
                ),
            ),
        ).toBe(original);
        expect(
            await fingerprint(source.replace("all: boolean", "all: string")),
        ).toBe(original);
        for (const changed of [
            source.replace(
                'type Color = "red" | "blue"',
                'type Color = "red" | "green"',
            ),
            source.replace("count?: number", "count?: string"),
            source.replace("note?: string", "note: string"),
            source.replace("comments?: string", "comments?: boolean"),
        ]) {
            expect(await fingerprint(changed)).not.toBe(original);
        }
        expect(await fingerprint(source, { effects: "read-only" })).not.toBe(
            original,
        );
        expect(
            await fingerprint(source, {
                effects: "read-only",
                confirmation: "required",
            }),
        ).not.toBe(await fingerprint(source, { effects: "read-only" }));
    });

    it.each([
        [undefined, "unknown", "required"],
        [{ effects: "state-changing" }, "state-changing", "required"],
        [{ effects: "read-only" }, "read-only", "not-required"],
        [
            { effects: "read-only", confirmation: "required" },
            "read-only",
            "required",
        ],
    ] as const)(
        "derives confirmation only from trusted policy %j",
        async (policy, effects, confirmation) => {
            const { service } = fixture(
                source,
                policy ? { select: policy } : undefined,
            );
            const contract = found(await service.getActionContract(identity));
            expect(contract.policy).toEqual({ effects, confirmation });
            expect(contract.interactions.mode).toBe("may-require-interaction");
        },
    );

    it("rejects malformed declarations instead of weakening confirmation", async () => {
        const { service, agents } = fixture();
        Object.assign(agents.getActionConfig(identity.schemaName), {
            actionPolicies: {
                select: { effects: "read-only", confirmation: "never" },
            },
        });
        await expect(service.getActionContract(identity)).rejects.toThrow(
            "Invalid structured action policy",
        );
    });
});

describe("structured action discovery", () => {
    it("lists compact action summaries with filters and pagination", async () => {
        const { service } = fixture();
        const page = await service.searchActions({ limit: 2 });
        expect(page.total).toBe(4);
        expect(page.actions.map((a) => a.actionName)).toEqual([
            "clear",
            "ping",
        ]);
        expect(page.nextOffset).toBe(2);
        expect(page.actions[0]).not.toHaveProperty("input");
        expect(page.actions[0]).not.toHaveProperty("availability");
        if (page.nextOffset === undefined) {
            throw new Error("Expected another page");
        }
        const remaining = await service.searchActions({
            offset: page.nextOffset,
            limit: 2,
        });
        expect(remaining.actions.map((a) => a.schemaName)).toEqual([
            "test.items",
            "test.other",
        ]);
        expect(remaining.nextOffset).toBeUndefined();
        expect((await service.searchActions({ query: "SELECT" })).total).toBe(
            2,
        );
        expect(
            (await service.searchActions({ schemaName: "test.other" })).total,
        ).toBe(1);
        expect(
            (await service.searchActions({ agentName: "missing" })).total,
        ).toBe(0);
        expect((await service.searchActions({ query: "an item" })).total).toBe(
            1,
        );
        expect((await service.searchActions({ offset: 50 })).actions).toEqual(
            [],
        );
    });

    it.each([
        { limit: 0 },
        { limit: 201 },
        { offset: -1 },
        { offset: 0.5 },
        { schemaName: "" },
    ])("rejects malformed search %j", async (request) => {
        await expect(
            fixture().service.searchActions(request),
        ).rejects.toThrow();
    });

    it("excludes actions unless their schema and action are active", async () => {
        const { service, state, agent, hooks } = fixture();
        const assertHidden = async () => {
            expect(
                (await service.searchActions()).actions.some(
                    (action) => action.schemaName === identity.schemaName,
                ),
            ).toBe(false);
            expect(await service.getActionContract(identity)).toMatchObject({
                status: "not-found",
            });
        };

        agent.actions.delete(identity.schemaName);
        await assertHidden();
        agent.actions.add(identity.schemaName);
        agent.schemas.delete(identity.schemaName);
        await assertHidden();
        agent.schemas.add(identity.schemaName);
        state.transientAgents[identity.schemaName] = false;
        await assertHidden();

        for (const hook of Object.values(hooks)) {
            expect(hook).not.toHaveBeenCalled();
        }
    });

    it("filters inactive schemas before parsing them", async () => {
        const { service, agents, agent } = fixture();
        agents.getActionConfig("test.other").schemaFile = {
            format: "ts",
            content: "invalid schema",
        };
        agent.actions.delete("test.other");

        expect((await service.searchActions()).total).toBe(3);
        expect(
            await service.getActionContract({
                schemaName: "test.other",
                actionName: "select",
            }),
        ).toMatchObject({ status: "not-found" });
    });

    it("binds scope to the facade, live session, and trusted permission revision", async () => {
        const { context, service } = fixture();
        const first = await service.getActionContract(identity);
        expect((await service.searchActions()).scopeId).toBe(first.scopeId);
        expect(
            (await new StructuredActionDiscovery(context).searchActions())
                .scopeId,
        ).not.toBe(first.scopeId);
        context.session = {};
        expect((await service.searchActions()).scopeId).not.toBe(first.scopeId);
        let scope = {};
        const restricted = new StructuredActionDiscovery(context, () => ({
            scope,
            canDiscoverSchema: () => true,
        }));
        const before = await restricted.searchActions();
        const reconnected = new StructuredActionDiscovery(context, () => ({
            scope,
            canDiscoverSchema: () => true,
        }));
        expect((await reconnected.searchActions()).scopeId).toBe(
            before.scopeId,
        );
        scope = {};
        expect((await restricted.searchActions()).scopeId).not.toBe(
            before.scopeId,
        );
    });

    it("filters denied schemas before parsing and does not reveal their existence", async () => {
        const { context, agents } = fixture();
        agents.getActionConfig("test.other").schemaFile = {
            format: "ts",
            content: "invalid schema",
        };
        const scope = {};
        const service = new StructuredActionDiscovery(context, () => ({
            scope,
            canDiscoverSchema: (name) => name === identity.schemaName,
        }));
        expect((await service.searchActions()).total).toBe(3);
        expect(
            await service.getActionContract({
                schemaName: "test.other",
                actionName: "select",
            }),
        ).toEqual(
            await service.getActionContract({
                schemaName: "secret",
                actionName: "select",
            }),
        );
    });

    it("propagates visible schema failures rather than returning empty success", async () => {
        const { service } = fixture("invalid schema");
        await expect(service.getActionContract(identity)).rejects.toThrow();
        await expect(service.searchActions()).rejects.toThrow();
    });
});
