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
    getInstanceLabels,
    getManifestKey,
    type ClientAgentHost,
    type ClientAgentRegistry,
} from "../src/clientAgentRegistry.js";
import type { AgentInterfaceFunctionName } from "@typeagent/agent-rpc/server";

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
    dynamicDisplays: string[];
};

/** What a device implements unless a test asks for something else. */
const DEFAULT_INTERFACE: AgentInterfaceFunctionName[] = ["executeAction"];

/**
 * A device whose proxy carries exactly the methods it declares. The interface
 * checks are about a device advertising methods it cannot answer, so a fake
 * that always implements the same one would not show the difference.
 * `getDynamicDisplay` is the optional method those tests move in and out.
 */
function makeDevice(
    agentInterface: readonly AgentInterfaceFunctionName[] = DEFAULT_INTERFACE,
): FakeDevice {
    const executed: TypeAgentAction[] = [];
    const dynamicDisplays: string[] = [];
    const available: Record<string, unknown> = {
        async executeAction(action: TypeAgentAction) {
            executed.push(action);
            return undefined;
        },
        async getDynamicDisplay(_type: string, displayId: string) {
            dynamicDisplays.push(displayId);
            return { type: "text", content: displayId };
        },
    };
    const appAgent: Record<string, unknown> = {};
    for (const method of agentInterface) {
        if (available[method] === undefined) {
            throw new Error(`makeDevice has no fake for '${method}'`);
        }
        appAgent[method] = available[method];
    }
    return {
        executed,
        dynamicDisplays,
        appAgent: appAgent as unknown as AppAgent,
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
 * Minimal stand-in for the SessionContext the dispatcher hands the mux.
 * `popupQuestion` throws: routing must never ask which device to use.
 */
function makeSessionContext(connectionId: string | undefined): {
    context: SessionContext<unknown>;
} {
    const context = {
        agentContext: undefined,
        sessionStorage: undefined,
        instanceStorage: undefined,
        sessionContextId: "test",
        currentConnectionId: connectionId,
        async popupQuestion() {
            throw new Error("routing must not prompt");
        },
    } as unknown as SessionContext<unknown>;
    return { context };
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
        agentInterface?: readonly AgentInterfaceFunctionName[];
        multiInstance?: boolean;
    },
): Promise<void> {
    await registry.add(host, AGENT_NAME, {
        instanceId: options.instanceId,
        displayName: options.displayName ?? options.instanceId,
        connectionId: options.connectionId,
        appAgent: options.appAgent,
        manifest: options.manifest ?? makeManifest(),
        // Default to what the proxy actually implements, which is what the
        // real client sends: createAgentRpcServer derives agentInterface from
        // the agent object. A test that passes one explicitly is deliberately
        // making the two disagree.
        agentInterface:
            options.agentInterface ??
            (Object.keys(options.appAgent) as AgentInterfaceFunctionName[]),
        // Devices opt in; the tests that pin single-host behaviour pass
        // false explicitly.
        multiInstance: options.multiInstance ?? true,
    });
}

function getMux(registry: ClientAgentRegistry): AppAgent {
    const group = registry.groups.get(AGENT_NAME);
    expect(group).toBeDefined();
    return group!.mux;
}

async function execute(
    registry: ClientAgentRegistry,
    connectionId: string | undefined,
): Promise<void> {
    const { context } = makeSessionContext(connectionId);
    await getMux(registry).executeAction!(
        { actionName: "showAlarms" } as TypeAgentAction,
        makeActionContext(context),
    );
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

    test("a second device implementing fewer methods is rejected", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const a = makeDevice(["executeAction", "getDynamicDisplay"]);

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: a.appAgent,
        });
        // The mux is built from A's proxy, so the dynamic agent the dispatcher
        // holds offers getDynamicDisplay.
        expect(getMux(registry).getDynamicDisplay).toBeDefined();

        // B is an older build: same schema, but no getDynamicDisplay. Without
        // the check it would join, and the first getDynamicDisplay that routed
        // to B would fail at call time.
        await expect(
            register(registry, host, {
                instanceId: "b",
                connectionId: "conn-b",
                appAgent: makeDevice(["executeAction"]).appAgent,
            }),
        ).rejects.toThrow(/different set of methods/i);
        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(1);
        expect(getMux(registry).getDynamicDisplay).toBeDefined();
    });

    test("a second device implementing extra methods is rejected", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeDevice(["executeAction"]).appAgent,
        });

        // The other direction: B's extra method would be silently unreachable,
        // since the mux only carries what A's proxy had.
        await expect(
            register(registry, host, {
                instanceId: "b",
                connectionId: "conn-b",
                appAgent: makeDevice(["executeAction", "getDynamicDisplay"])
                    .appAgent,
            }),
        ).rejects.toThrow(/different set of methods/i);
        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(1);
    });

    test("the same method set in another order is accepted", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeDevice(["executeAction", "getDynamicDisplay"])
                .appAgent,
            agentInterface: ["executeAction", "getDynamicDisplay"],
        });
        await register(registry, host, {
            instanceId: "b",
            connectionId: "conn-b",
            appAgent: makeDevice(["executeAction", "getDynamicDisplay"])
                .appAgent,
            agentInterface: ["getDynamicDisplay", "executeAction"],
        });

        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(2);
    });

    test("an empty method set is compared like any other", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeDevice(["executeAction"]).appAgent,
        });

        // Nothing in common with the group, so it is a mismatch rather than an
        // opt-out: the key for [] is the empty string, not undefined.
        await expect(
            register(registry, host, {
                instanceId: "b",
                connectionId: "conn-b",
                appAgent: makeDevice([]).appAgent,
            }),
        ).rejects.toThrow(/different set of methods/i);
        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(1);
    });

    test("a device reconnecting with the same method set keeps its slot", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeDevice(["executeAction", "getDynamicDisplay"])
                .appAgent,
        });
        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a2",
            appAgent: makeDevice(["executeAction", "getDynamicDisplay"])
                .appAgent,
        });

        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(1);
        expect(host.added).toEqual([AGENT_NAME]);
    });

    test("a lone device that upgrades its app changes the group's method set", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeDevice(["executeAction"]).appAgent,
        });
        expect(getMux(registry).getDynamicDisplay).toBeUndefined();

        // Same device, same schema, new build that implements one more method.
        // Nobody else is in the group, so there is no other device to conflict
        // with and nothing for the user to disconnect.
        const upgraded = makeDevice(["executeAction", "getDynamicDisplay"]);
        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a2",
            appAgent: upgraded.appAgent,
        });

        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(1);
        // The dispatcher still holds the object it was handed, so the new
        // method has to show up on that same mux and route to the device.
        const { context } = makeSessionContext("conn-a2");
        expect(getMux(registry).getDynamicDisplay).toBeDefined();
        await getMux(registry).getDynamicDisplay!("html", "display-1", context);
        expect(upgraded.dynamicDisplays).toEqual(["display-1"]);
    });

    test("a lone device that downgrades loses the method from the mux", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeDevice(["executeAction", "getDynamicDisplay"])
                .appAgent,
        });
        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a2",
            appAgent: makeDevice(["executeAction"]).appAgent,
        });

        // Leaving it on the mux would advertise a method no device can answer.
        expect(getMux(registry).getDynamicDisplay).toBeUndefined();
        expect(getMux(registry).executeAction).toBeDefined();
    });

    test("a reconnecting device cannot change a shared group's method set", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const shared: AgentInterfaceFunctionName[] = [
            "executeAction",
            "getDynamicDisplay",
        ];

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeDevice(shared).appAgent,
        });
        await register(registry, host, {
            instanceId: "b",
            connectionId: "conn-b",
            appAgent: makeDevice(shared).appAgent,
        });

        // Replacing in place keeps the mux built from the original proxy, so
        // the check has to cover a replacement too, not just a new instance.
        // B is still there and still expects getDynamicDisplay to work.
        await expect(
            register(registry, host, {
                instanceId: "a",
                connectionId: "conn-a2",
                appAgent: makeDevice(["executeAction"]).appAgent,
            }),
        ).rejects.toThrow(/different set of methods/i);
        expect(getMux(registry).getDynamicDisplay).toBeDefined();
    });

    // Case 12
    test("a client that does not opt in stays the only host of its agent", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const first = makeDevice();

        // This is the shell: it registers without asking to share the name, so
        // nothing about grouping changes for it.
        await register(registry, host, {
            instanceId: "shell-1",
            connectionId: "conn-1",
            appAgent: first.appAgent,
            multiInstance: false,
        });

        await expect(
            register(registry, host, {
                instanceId: "shell-2",
                connectionId: "conn-2",
                appAgent: makeDevice().appAgent,
                multiInstance: false,
            }),
        ).rejects.toThrow(`App agent '${AGENT_NAME}' already exists`);

        // Even a client that does opt in cannot join a group whose creator did
        // not: the creator decides, so no one can widen someone else's agent.
        await expect(
            register(registry, host, {
                instanceId: "other",
                connectionId: "conn-3",
                appAgent: makeDevice().appAgent,
                multiInstance: true,
            }),
        ).rejects.toThrow(`App agent '${AGENT_NAME}' already exists`);

        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(1);

        // Reconnecting on a new socket still works, which is the one thing the
        // old code could not do.
        const reconnected = makeDevice();
        await register(registry, host, {
            instanceId: "shell-1",
            connectionId: "conn-1b",
            appAgent: reconnected.appAgent,
            multiInstance: false,
        });
        expect(registry.groups.get(AGENT_NAME)!.instances.size).toBe(1);
        await execute(registry, "conn-1b");
        expect(reconnected.executed).toHaveLength(1);
    });

    test("a new instanceId on the same connection takes over that connection's slot", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const other = makeDevice();
        const stale = makeDevice();
        const live = makeDevice();

        await register(registry, host, {
            instanceId: "other",
            connectionId: "conn-other",
            appAgent: other.appAgent,
        });
        await register(registry, host, {
            instanceId: "old",
            connectionId: "conn-1",
            appAgent: stale.appAgent,
        });
        // Same socket, new identity: one client, not a third device.
        await register(registry, host, {
            instanceId: "new",
            connectionId: "conn-1",
            appAgent: live.appAgent,
        });

        const group = registry.groups.get(AGENT_NAME)!;
        expect([...group.instances.keys()]).toEqual(["other", "new"]);
        // Handing the slot over never empties the group, so the dynamic agent
        // is not torn down and rebuilt.
        expect(host.added).toEqual([AGENT_NAME]);
        expect(host.removed).toEqual([]);

        // Routing scans in insertion order, so a surviving stale instance
        // would have been picked ahead of the live one.
        await execute(registry, "conn-1");
        expect(live.executed).toHaveLength(1);
        expect(stale.executed).toHaveLength(0);
    });

    test("taking over a slot does not need the sharing opt-in", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const live = makeDevice();

        await register(registry, host, {
            instanceId: "old",
            connectionId: "conn-1",
            appAgent: makeDevice().appAgent,
            multiInstance: false,
        });
        // Replacing itself is not a second device, so the single-host rule
        // must not reject it.
        await register(registry, host, {
            instanceId: "new",
            connectionId: "conn-1",
            appAgent: live.appAgent,
            multiInstance: false,
        });

        expect([...registry.groups.get(AGENT_NAME)!.instances.keys()]).toEqual([
            "new",
        ]);
        await execute(registry, "conn-1");
        expect(live.executed).toHaveLength(1);
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
    test("routes to the requester, then to the only device, and otherwise refuses", async () => {
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

        // One device, so a request from anywhere else still lands on it. This
        // is "ask the shell, act on my only phone".
        await execute(registry, undefined);
        expect(a.executed).toHaveLength(1);

        await register(registry, host, {
            instanceId: "b",
            displayName: "Galaxy Tab",
            connectionId: "conn-b",
            appAgent: b.appAgent,
        });

        // The device that asked always wins, however many are connected.
        await execute(registry, "conn-b");
        expect(b.executed).toHaveLength(1);
        await execute(registry, "conn-a");
        expect(a.executed).toHaveLength(2);

        // Two devices and the asker is neither of them: refuse rather than
        // guess, and say which devices are connected.
        await expect(execute(registry, undefined)).rejects.toThrow(
            /Pixel 8, Galaxy Tab/,
        );
        // Nothing ran anywhere.
        expect(a.executed).toHaveLength(2);
        expect(b.executed).toHaveLength(1);

        // A request from an unknown connection is treated the same way.
        await expect(execute(registry, "conn-shell")).rejects.toThrow(
            /hosted by 2 devices/,
        );
    });

    test("refusing to route leaves no remembered device behind", async () => {
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

        // Asking from a device must not make it the target for later requests
        // from elsewhere. That hidden state is what sends an action to the
        // wrong phone.
        await execute(registry, "conn-a");
        await expect(execute(registry, undefined)).rejects.toThrow(
            /hosted by 2 devices/,
        );

        // Once only one device is left, routing becomes unambiguous again.
        await registry.remove(host, AGENT_NAME, "a", {
            ownerConnectionId: "conn-a",
        });
        await execute(registry, undefined);
        expect(b.executed).toHaveLength(1);
    });

    // Case 9
    test("two devices sharing a display name are listed distinctly", async () => {
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

        expect(getInstanceLabels(registry.groups.get(AGENT_NAME)!)).toEqual([
            "Pixel 8 (1)",
            "Pixel 8 (2)",
        ]);

        await expect(execute(registry, undefined)).rejects.toThrow(
            /Pixel 8 \(1\), Pixel 8 \(2\)/,
        );
        expect(a.executed).toHaveLength(0);
        expect(b.executed).toHaveLength(0);
    });

    test("a read-only call still runs when the target is ambiguous", async () => {
        const registry = createClientAgentRegistry();
        const host = makeHost();
        const readinessCalls: string[] = [];
        const makeReadyDevice = (id: string): AppAgent => ({
            async executeAction() {
                return undefined;
            },
            async checkReadiness() {
                readinessCalls.push(id);
                return { kind: "ready" } as any;
            },
        });

        await register(registry, host, {
            instanceId: "a",
            connectionId: "conn-a",
            appAgent: makeReadyDevice("a"),
        });
        await register(registry, host, {
            instanceId: "b",
            connectionId: "conn-b",
            appAgent: makeReadyDevice("b"),
        });

        // Readiness changes nothing on the device, so failing it would make the
        // agent look broken for a question the user never asked.
        const { context } = makeSessionContext(undefined);
        await getMux(registry).checkReadiness!(context);

        expect(readinessCalls).toHaveLength(1);
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
