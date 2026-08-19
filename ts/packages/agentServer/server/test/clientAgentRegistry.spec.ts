// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, test } from "@jest/globals";
import type {
    ActionContext,
    AppAgent,
    AppAgentManifest,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    agentAlreadyExistsMessage,
    createClientAgentRegistry,
    getInstanceChoices,
    getManifestKey,
    type ClientAgentHost,
    type ClientAgentRegistry,
} from "../src/clientAgentRegistry.js";

const AGENT_NAME = "androidDevice";
const SCHEMA =
    'export type AndroidDeviceAction = { actionName: "showAlarms" };';

function makeManifest(
    schemaContent: string = SCHEMA,
    extra?: Record<string, unknown>,
): AppAgentManifest {
    return {
        emojiChar: "\u23F0",
        description: "test",
        defaultEnabled: true,
        schemaDefaultEnabled: true,
        actionDefaultEnabled: true,
        ...extra,
        schema: {
            description: "test",
            schemaType: "AndroidDeviceAction",
            schemaFile: { format: "ts", content: schemaContent },
        },
    } as AppAgentManifest;
}

type FakeDevice = {
    appAgent: AppAgent;
    executed: TypeAgentAction[];
};

function makeDevice(): FakeDevice {
    const executed: TypeAgentAction[] = [];
    return {
        executed,
        appAgent: {
            async executeAction(action: TypeAgentAction) {
                executed.push(action);
                return undefined;
            },
        },
    };
}

type FakeHost = ClientAgentHost & {
    added: string[];
    removed: string[];
    registered: Map<string, AppAgent>;
};

function makeHost(): FakeHost {
    const added: string[] = [];
    const removed: string[] = [];
    const registered = new Map<string, AppAgent>();
    return {
        added,
        removed,
        registered,
        async addDynamicAgent(name, _manifest, appAgent) {
            if (registered.has(name)) {
                throw new Error(agentAlreadyExistsMessage(name));
            }
            added.push(name);
            registered.set(name, appAgent);
        },
        async removeDynamicAgent(name) {
            removed.push(name);
            registered.delete(name);
        },
    };
}

/**
 * Minimal stand-in for the SessionContext the dispatcher hands the mux. Only
 * the fields routing reads are real.
 */
function makeSessionContext(
    connectionId: string | undefined,
    popupAnswer?: number,
): {
    context: SessionContext<unknown>;
    prompts: { message: string; choices: string[] }[];
} {
    const prompts: { message: string; choices: string[] }[] = [];
    const context = {
        agentContext: undefined,
        sessionStorage: undefined,
        instanceStorage: undefined,
        sessionContextId: "test",
        currentConnectionId: connectionId,
        async popupQuestion(message: string, choices: string[] = []) {
            prompts.push({ message, choices });
            if (popupAnswer === undefined) {
                throw new Error("unexpected popupQuestion");
            }
            return popupAnswer;
        },
    } as unknown as SessionContext<unknown>;
    return { context, prompts };
}

function makeActionContext(
    sessionContext: SessionContext<unknown>,
): ActionContext<unknown> {
    return { sessionContext } as unknown as ActionContext<unknown>;
}

async function register(
    registry: ClientAgentRegistry,
    host: ClientAgentHost,
    options: {
        instanceId: string;
        displayName?: string;
        connectionId: string;
        appAgent: AppAgent;
        manifest?: AppAgentManifest;
        allowMultipleInstances?: boolean;
    },
): Promise<void> {
    await registry.add(
        host,
        AGENT_NAME,
        {
            instanceId: options.instanceId,
            displayName: options.displayName ?? options.instanceId,
            connectionId: options.connectionId,
            appAgent: options.appAgent,
            manifest: options.manifest ?? makeManifest(),
        },
        options.allowMultipleInstances === undefined
            ? undefined
            : { allowMultipleInstances: options.allowMultipleInstances },
    );
}

function getMux(registry: ClientAgentRegistry): AppAgent {
    const group = registry.groups.get(AGENT_NAME);
    expect(group).toBeDefined();
    return group!.mux;
}

async function execute(
    registry: ClientAgentRegistry,
    connectionId: string | undefined,
    popupAnswer?: number,
): Promise<{ prompts: { message: string; choices: string[] }[] }> {
    const { context, prompts } = makeSessionContext(connectionId, popupAnswer);
    await getMux(registry).executeAction!(
        { actionName: "showAlarms" } as TypeAgentAction,
        makeActionContext(context),
    );
    return { prompts };
}

describe("clientAgentRegistry registration", () => {
    // Case 1
    test("a second device with the same schema joins one dynamic agent", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const a = makeDevice();
        const b = makeDevice();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: a.appAgent,
        });
        await register(registry, host, {
            instanceId: "b",
            connectionId: "conn-b",
            appAgent: b.appAgent,
        });

        expect(host.added).toEqual([AGENT_NAME]);
        expect(registry.groups.size).toBe(1);
        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(2);
    });

    // Case 2
    test("the same instanceId re-registers by replacing the proxy in place", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const first = makeDevice();
        const second = makeDevice();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-1",
            appAgent: first.appAgent,
        });
        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-2",
            appAgent: second.appAgent,
        });

        const group = registry.groups.get(AGENT_NAME)!;
        expect(group.instances.size).toBe(1);
        expect(group.instances.get("a")!.connectionId).toBe("conn-2");
        expect(host.added).toEqual([AGENT_NAME]);

        await execute(registry, "conn-2");
        expect(second.executed).toHaveLength(1);
        expect(first.executed).toHaveLength(0);
    });

    // Case 3
    test("different schema content is rejected with a version-mismatch message", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeDevice().appAgent,
        });

        await expect(
            register(registry, host, {
                instanceId: "b",
                connectionId: "conn-b",
                appAgent: makeDevice().appAgent,
                manifest: makeManifest(`${SCHEMA} // v2`),
            }),
        ).rejects.toThrow(/different schema version/i);
        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(1);
    });

    // Case 4
    test("the same schema with reordered manifest keys is accepted", async () => {
        const ordered = makeManifest();
        // Rebuild the same manifest with its top-level keys in another order,
        // the way org.json.JSONObject would.
        const reordered = Object.fromEntries(
            Object.entries(ordered).reverse(),
        ) as AppAgentManifest;
        expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(ordered));
        expect(getManifestKey(reordered)).toBe(getManifestKey(ordered));

        const registry = createClientAgentRegistry();
        const host = makeHost();
        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeDevice().appAgent,
            manifest: ordered,
        });
        await register(registry, host, {
            instanceId: "b",
            connectionId: "conn-b",
            appAgent: makeDevice().appAgent,
            manifest: reordered,
        });

        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(2);
    });

    // Case 12
    test("with multi-instance off a second device is rejected with the original message", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const a = makeDevice();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: a.appAgent,
            allowMultipleInstances: false,
        });

        await expect(
            register(registry, host, {
                instanceId: "b",
                connectionId: "conn-b",
                appAgent: makeDevice().appAgent,
                allowMultipleInstances: false,
            }),
        ).rejects.toThrow(`App agent '${AGENT_NAME}' already exists`);

        // A reconnect of the instance already in the group still works.
        const reconnected = makeDevice();
        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a2",
            appAgent: reconnected.appAgent,
            allowMultipleInstances: false,
        });
        const group = registry.groups.get(AGENT_NAME)!;
        expect(group.instances.size).toBe(1);
        expect(group.instances.get("a")!.connectionId).toBe("conn-a2");
    });
});

describe("clientAgentRegistry teardown", () => {
    // Case 5
    test("device A disconnecting leaves device B working", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const a = makeDevice();
        const b = makeDevice();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: a.appAgent,
        });
        await register(registry, host, {
            instanceId: "b",
            connectionId: "conn-b",
            appAgent: b.appAgent,
        });

        await registry.remove(host, AGENT_NAME, "a", {
            ownerConnectionId: "conn-a",
        });

        expect(host.removed).toEqual([]);
        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(1);

        await execute(registry, "conn-b");
        expect(b.executed).toHaveLength(1);
        expect(a.executed).toHaveLength(0);
    });

    // Case 6
    test("removeDynamicAgent runs exactly once, when the last device leaves", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeDevice().appAgent,
        });
        await register(registry, host, {
            instanceId: "b",
            connectionId: "conn-b",
            appAgent: makeDevice().appAgent,
        });

        await registry.remove(host, AGENT_NAME, "a", {
            ownerConnectionId: "conn-a",
        });
        await registry.remove(host, AGENT_NAME, "b", {
            ownerConnectionId: "conn-b",
        });
        // Double removal (explicit unregister then socket disconnect) is inert.
        await registry.remove(host, AGENT_NAME, "b", {
            ownerConnectionId: "conn-b",
        });

        expect(host.removed).toEqual([AGENT_NAME]);
        expect(registry.groups.size).toBe(0);
    });

    // Case 7
    test("unregister resolves to the caller's own instance and removes nothing when it has none", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeDevice().appAgent,
        });
        await register(registry, host, {
            instanceId: "b",
            connectionId: "conn-b",
            appAgent: makeDevice().appAgent,
        });

        // A fresh connection owns nothing, so there is no instance to resolve.
        expect(
            registry.findInstanceIdForConnection(AGENT_NAME, "conn-new"),
        ).toBeUndefined();
        expect(registry.findInstanceIdForConnection(AGENT_NAME, "conn-b")).toBe(
            "b",
        );

        // Even naming another device's instance explicitly does nothing when
        // the caller does not own it.
        const removed = await registry.remove(host, AGENT_NAME, "a", {
            ownerConnectionId: "conn-new",
        });
        expect(removed).toBe(false);
        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(2);
    });

    // Case 13
    test("a late disconnect of a half-open socket does not evict the reconnected device", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const sleeping = makeDevice();
        const awake = makeDevice();

        await register(registry, host, {
            instanceId: "phone",
            connectionId: "conn-old",
            appAgent: sleeping.appAgent,
        });
        // The phone wakes and re-registers before its dead socket is reaped.
        await register(registry, host, {
            instanceId: "phone",
            connectionId: "conn-new",
            appAgent: awake.appAgent,
        });

        // The old socket's disconnect finally arrives.
        const removed = await registry.remove(host, AGENT_NAME, "phone", {
            ownerConnectionId: "conn-old",
        });

        expect(removed).toBe(false);
        expect(host.removed).toEqual([]);
        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(1);
        await execute(registry, "conn-new");
        expect(awake.executed).toHaveLength(1);
        expect(sleeping.executed).toHaveLength(0);
    });
});

describe("clientAgentRegistry routing", () => {
    // Case 8
    test("routes to the requester, the active device, the only device, then asks", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const a = makeDevice();
        const b = makeDevice();

        await register(registry, host, {
            instanceId: "a",
            displayName: "Pixel 8",
            connectionId: "conn-a",
            appAgent: a.appAgent,
        });

        // Only one device: no requester needed, no prompt.
        await execute(registry, undefined);
        expect(a.executed).toHaveLength(1);

        await register(registry, host, {
            instanceId: "b",
            displayName: "Galaxy Tab",
            connectionId: "conn-b",
            appAgent: b.appAgent,
        });

        // Requester wins.
        await execute(registry, "conn-b");
        expect(b.executed).toHaveLength(1);
        expect(a.executed).toHaveLength(1);

        // No requester and no active device: ask, and remember the answer.
        const { prompts } = await execute(registry, undefined, 1);
        expect(prompts).toHaveLength(1);
        expect(prompts[0].choices).toEqual(["Pixel 8", "Galaxy Tab"]);
        expect(b.executed).toHaveLength(2);
        expect(registry.groups.get(AGENT_NAME)!.activeInstanceId).toBe("b");

        // Active device is used without asking again.
        await execute(registry, undefined);
        expect(b.executed).toHaveLength(3);
        expect(a.executed).toHaveLength(1);
    });

    // Case 9
    test("two devices sharing a display name get distinct choices that resolve correctly", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const a = makeDevice();
        const b = makeDevice();

        await register(registry, host, {
            instanceId: "a",
            displayName: "Pixel 8",
            connectionId: "conn-a",
            appAgent: a.appAgent,
        });
        await register(registry, host, {
            instanceId: "b",
            displayName: "Pixel 8",
            connectionId: "conn-b",
            appAgent: b.appAgent,
        });

        const choices = getInstanceChoices(registry.groups.get(AGENT_NAME)!);
        expect(choices.map((c) => c.label)).toEqual([
            "Pixel 8 (1)",
            "Pixel 8 (2)",
        ]);
        expect(choices.map((c) => c.instanceId)).toEqual(["a", "b"]);

        const { prompts } = await execute(registry, undefined, 1);
        expect(prompts[0].choices).toEqual(["Pixel 8 (1)", "Pixel 8 (2)"]);
        expect(b.executed).toHaveLength(1);
        expect(a.executed).toHaveLength(0);
    });

    // Case 10
    test("overlapping requests from different connections route to their own devices", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();

        // Devices that only settle once both requests are in flight, so a
        // routing decision read after the fact would land on the wrong one.
        const makeSlowDevice = () => {
            const executed: TypeAgentAction[] = [];
            let release: (() => void) | undefined;
            const gate = new Promise<void>((resolve) => (release = resolve));
            return {
                executed,
                release: () => release!(),
                appAgent: {
                    async executeAction(action: TypeAgentAction) {
                        executed.push(action);
                        await gate;
                        return undefined;
                    },
                } as AppAgent,
            };
        };
        const a = makeSlowDevice();
        const b = makeSlowDevice();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: a.appAgent,
        });
        await register(registry, host, {
            instanceId: "b",
            connectionId: "conn-b",
            appAgent: b.appAgent,
        });

        const first = execute(registry, "conn-a");
        const second = execute(registry, "conn-b");
        a.release();
        b.release();
        await Promise.all([first, second]);

        expect(a.executed).toHaveLength(1);
        expect(b.executed).toHaveLength(1);
    });
});

describe("clientAgentRegistry concurrency", () => {
    // Case 11
    test("two simultaneous registrations produce one group and one addDynamicAgent", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();

        await Promise.all([
            register(registry, host, {
                instanceId: "a",
                connectionId: "conn-a",
                appAgent: makeDevice().appAgent,
            }),
            register(registry, host, {
                instanceId: "b",
                connectionId: "conn-b",
                appAgent: makeDevice().appAgent,
            }),
        ]);

        expect(host.added).toEqual([AGENT_NAME]);
        expect(registry.groups.size).toBe(1);
        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(2);
    });

    // Case 11, mirror case
    test("an add and a remove started together leave the group consistent", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeDevice().appAgent,
        });

        await Promise.all([
            register(registry, host, {
                instanceId: "b",
                connectionId: "conn-b",
                appAgent: makeDevice().appAgent,
            }),
            registry.remove(host, AGENT_NAME, "a", {
                ownerConnectionId: "conn-a",
            }),
        ]);

        const group = registry.groups.get(AGENT_NAME);
        expect(group).toBeDefined();
        expect(group!.instances.size).toBe(1);
        expect(group!.instances.has("b")).toBe(true);
        expect(host.removed).toEqual([]);
        expect(host.added).toEqual([AGENT_NAME]);

        // And the last one out still tears the dynamic agent down once.
        await registry.remove(host, AGENT_NAME, "b", {
            ownerConnectionId: "conn-b",
        });
        expect(host.removed).toEqual([AGENT_NAME]);
    });
});
