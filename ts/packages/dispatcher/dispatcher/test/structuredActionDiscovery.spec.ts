// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { ActionPolicy, AppAgent } from "@typeagent/agent-sdk";
import type { ActionIdentity } from "@typeagent/dispatcher-types";
import { parseActionSchemaSource } from "@typeagent/action-schema";
import { AppAgentManager } from "../src/context/appAgentManager.js";
import { PortRegistrar } from "../src/context/portRegistrar.js";
import {
    convertToActionConfig,
    type ActionConfig,
} from "../src/translation/actionConfig.js";
import type {
    ActionCandidateRanker,
    ActionCandidateResult,
} from "../src/translation/actionCandidateRanker.js";
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

async function getContract(
    service: StructuredActionDiscovery,
    actionIdentity: ActionIdentity = identity,
) {
    const result = await service.searchActions({
        query: `${actionIdentity.schemaName} ${actionIdentity.actionName}`,
    });
    if (result.actions.length !== 1) {
        throw new Error(`Expected one contract, got ${result.actions.length}`);
    }
    return result.actions[0];
}

async function fingerprint(content = source, policy?: ActionPolicy) {
    const { service } = fixture(
        content,
        policy ? { select: policy } : undefined,
    );
    return (await getContract(service)).fingerprint;
}

function candidate(
    agents: AppAgentManager,
    schemaName: string,
    actionName: string,
    score: number,
): ActionCandidateResult {
    const schema = agents.getActionSchemaFileForConfig(
        agents.getActionConfig(schemaName),
    );
    const definition = schema.parsedActionSchema.actionSchemas.get(actionName);
    if (definition === undefined) {
        throw new Error(`Missing test action ${schemaName}.${actionName}`);
    }
    return { schemaName, actionName, score, definition };
}

function createRanker(
    implementation: ActionCandidateRanker["rankActionCandidates"],
): ActionCandidateRanker & {
    rankActionCandidates: jest.MockedFunction<
        ActionCandidateRanker["rankActionCandidates"]
    >;
} {
    return {
        rankActionCandidates: jest.fn(implementation),
    };
}

describe("structured action contracts", () => {
    it("hydrates an exact action with a closed dependency graph", async () => {
        const { service, agents } = fixture();
        const enumerate = jest.spyOn(agents, "getActionConfigs");
        const result = await service.searchActions({
            query: `${identity.schemaName} ${identity.actionName}`,
        });
        const contract = result.actions[0];
        expect(enumerate).toHaveBeenCalledTimes(1);
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

    it("preserves exact identities for duplicate action names", async () => {
        const { service } = fixture();
        const matches = await service.searchActions({ query: "select" });
        expect(
            matches.actions.map(({ schemaName, actionName }) => ({
                schemaName,
                actionName,
            })),
        ).toEqual([
            { schemaName: "test.items", actionName: "select" },
            { schemaName: "test.other", actionName: "select" },
        ]);
        const other = await getContract(service, {
            schemaName: "test.other",
            actionName: "select",
        });
        expect(other.input.schemaText).toContain("id: number");
    });

    it("handles no parameters and an optional parameter object", async () => {
        const { service } = fixture();
        expect(
            (
                await getContract(service, {
                    ...identity,
                    actionName: "ping",
                })
            ).input.schemaText,
        ).not.toContain("parameters");
        const optional = fixture(
            source.replace("parameters: {", "parameters?: {"),
        );
        expect(
            (await getContract(optional.service)).input.schemaText,
        ).toContain("parameters?:");
    });

    it("closes recursive references without importing sibling actions", async () => {
        const recursive = fixture(
            source.replace(
                "color: Color;",
                "color: Color;\n    children?: Item[];",
            ),
        );
        const contract = await getContract(recursive.service);
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
            const contract = await getContract(service);
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
        await expect(
            service.searchActions({
                query: `${identity.schemaName} ${identity.actionName}`,
            }),
        ).rejects.toThrow("Invalid structured action policy");
    });
});

describe("structured action discovery", () => {
    it("hydrates ranked candidates by score with stable identity ties", async () => {
        const { agents, context } = fixture();
        const ranker = createRanker(async () => [
            candidate(agents, "test.items", "ping", 0.7),
            candidate(agents, "test.other", "select", 0.9),
            candidate(agents, "test.items", "select", 0.7),
            candidate(agents, "test.items", "clear", 0.7),
        ]);
        const service = new StructuredActionDiscovery(
            context,
            undefined,
            ranker,
        );

        const result = await service.searchActions({ query: "  choose item " });

        expect(ranker.rankActionCandidates).toHaveBeenCalledWith(
            "choose item",
            5,
            expect.any(Function),
        );
        expect(
            result.actions.map(({ schemaName, actionName }) => ({
                schemaName,
                actionName,
            })),
        ).toEqual([
            { schemaName: "test.other", actionName: "select" },
            { schemaName: "test.items", actionName: "clear" },
            { schemaName: "test.items", actionName: "ping" },
            { schemaName: "test.items", actionName: "select" },
        ]);
        expect(
            result.actions.every((action) => action.input !== undefined),
        ).toBe(true);
        expect(result.actions[0]).not.toHaveProperty("score");
    });

    it("does not use literal fallback after a successful zero-candidate ranking", async () => {
        const { agents, context } = fixture();
        const enumerate = jest.spyOn(agents, "getActionConfigs");
        const ranker = createRanker(async () => []);
        const service = new StructuredActionDiscovery(
            context,
            undefined,
            ranker,
        );

        expect(
            (await service.searchActions({ query: "select" })).actions,
        ).toEqual([]);
        expect(enumerate).not.toHaveBeenCalled();
    });

    it.each(["unavailable", "failure"] as const)(
        "uses stable literal fallback when ranking is %s",
        async (condition) => {
            const { context } = fixture();
            const ranker = createRanker(async () => {
                if (condition === "failure") {
                    throw new Error("ranking failed");
                }
                return undefined;
            });
            const service = new StructuredActionDiscovery(
                context,
                undefined,
                ranker,
            );

            expect(
                (
                    await service.searchActions({
                        query: "select",
                    })
                ).actions.map(({ schemaName, actionName }) => ({
                    schemaName,
                    actionName,
                })),
            ).toEqual([
                { schemaName: "test.items", actionName: "select" },
                { schemaName: "test.other", actionName: "select" },
            ]);
        },
    );

    it("passes trusted permission filtering into ranking", async () => {
        const { agents, context } = fixture();
        const candidates = [
            candidate(agents, "test.items", "select", 0.8),
            candidate(agents, "test.other", "select", 0.9),
        ];
        const filterResults = new Map<string, boolean>();
        const ranker = createRanker(async (_request, maxCandidates, filter) =>
            candidates
                .filter(({ schemaName, actionName }) => {
                    const allowed = filter(schemaName, actionName);
                    filterResults.set(schemaName, allowed);
                    return allowed;
                })
                .slice(0, maxCandidates),
        );
        agents.getActionConfig("test.other").schemaFile = {
            format: "ts",
            content: "invalid denied schema",
        };
        const service = new StructuredActionDiscovery(
            context,
            () => ({
                scope: {},
                canDiscoverSchema: (schemaName) => schemaName !== "test.other",
            }),
            ranker,
        );

        expect(
            (await service.searchActions({ query: "select" })).actions.map(
                ({ schemaName }) => schemaName,
            ),
        ).toEqual(["test.items"]);
        expect(filterResults).toEqual(
            new Map([
                ["test.items", true],
                ["test.other", false],
            ]),
        );
    });

    it("waits for pending schemas before ranking or catalog access", async () => {
        const { agents, context } = fixture();
        const pendingState = agents as unknown as {
            loadingSchemas: Set<string>;
            notifyReadyIfDone(): void;
        };
        pendingState.loadingSchemas.add("test.pending");
        const enumerate = jest.spyOn(agents, "getActionConfigs");
        const ranker = createRanker(async () => []);
        const service = new StructuredActionDiscovery(
            context,
            undefined,
            ranker,
        );

        const result = service.searchActions({ query: "select" });
        await Promise.resolve();
        expect(ranker.rankActionCandidates).not.toHaveBeenCalled();
        expect(enumerate).not.toHaveBeenCalled();

        await expect(
            service.searchActions(undefined as unknown as { query: string }),
        ).rejects.toThrow("Action search request must be an object");

        pendingState.loadingSchemas.delete("test.pending");
        pendingState.notifyReadyIfDone();
        await expect(result).resolves.toMatchObject({ actions: [] });
        expect(ranker.rankActionCandidates).toHaveBeenCalledTimes(1);
    });

    it("returns every matching action as a complete contract", async () => {
        const { service } = fixture();
        const result = await service.searchActions({ query: "test" });
        expect(result.actions.map((a) => a.actionName)).toEqual([
            "clear",
            "ping",
            "select",
            "select",
        ]);
        expect(
            result.actions.every((action) => action.input !== undefined),
        ).toBe(true);
        expect(result.actions[0]).not.toHaveProperty("availability");
        expect(
            (await service.searchActions({ query: "SELECT" })).actions,
        ).toHaveLength(2);
        expect(
            (await service.searchActions({ query: "test.other select" }))
                .actions,
        ).toHaveLength(1);
        expect(
            (await service.searchActions({ query: "missing" })).actions,
        ).toEqual([]);
        expect(
            (await service.searchActions({ query: "an item" })).actions,
        ).toHaveLength(1);
    });

    it.each([{ query: "" }, { query: "   " }])(
        "rejects malformed search %j",
        async (request) => {
            await expect(
                fixture().service.searchActions(request),
            ).rejects.toThrow();
        },
    );

    it("rejects a missing search request", async () => {
        await expect(
            fixture().service.searchActions(
                undefined as unknown as { query: string },
            ),
        ).rejects.toThrow();
    });

    it("excludes actions unless their schema and action are active", async () => {
        const { service, state, agent, hooks } = fixture();
        const assertHidden = async () => {
            expect(
                (await service.searchActions({ query: identity.schemaName }))
                    .actions,
            ).toEqual([]);
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

        expect(
            (await service.searchActions({ query: "test" })).actions,
        ).toHaveLength(3);
        expect(
            (await service.searchActions({ query: "test.other select" }))
                .actions,
        ).toEqual([]);
    });

    it("binds scope to the facade, live session, and trusted permission revision", async () => {
        const { context, service } = fixture();
        const first = await service.searchActions({ query: "select" });
        expect((await service.searchActions({ query: "test" })).scopeId).toBe(
            first.scopeId,
        );
        expect(
            (
                await new StructuredActionDiscovery(context).searchActions({
                    query: "test",
                })
            ).scopeId,
        ).not.toBe(first.scopeId);
        context.session = {};
        expect(
            (await service.searchActions({ query: "test" })).scopeId,
        ).not.toBe(first.scopeId);
        let scope = {};
        const restricted = new StructuredActionDiscovery(context, () => ({
            scope,
            canDiscoverSchema: () => true,
        }));
        const before = await restricted.searchActions({ query: "test" });
        const reconnected = new StructuredActionDiscovery(context, () => ({
            scope,
            canDiscoverSchema: () => true,
        }));
        expect(
            (await reconnected.searchActions({ query: "test" })).scopeId,
        ).toBe(before.scopeId);
        scope = {};
        expect(
            (await restricted.searchActions({ query: "test" })).scopeId,
        ).not.toBe(before.scopeId);
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
        expect(
            (await service.searchActions({ query: "test" })).actions,
        ).toHaveLength(3);
        expect(
            (await service.searchActions({ query: "test.other select" }))
                .actions,
        ).toEqual([]);
        expect(
            (await service.searchActions({ query: "secret select" })).actions,
        ).toEqual([]);
    });

    it("propagates visible schema failures rather than returning empty success", async () => {
        const { service } = fixture("invalid schema");
        await expect(
            service.searchActions({ query: "test" }),
        ).rejects.toThrow();
    });
});
