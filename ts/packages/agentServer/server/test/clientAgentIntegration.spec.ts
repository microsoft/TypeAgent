// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Integration coverage for two clients hosting one agent name on one
 * conversation, driven through the real connection handler and agent-rpc
 * transport with an in-memory channel pair. The conversation manager is stubbed
 * (a real one needs a real dispatcher, which needs models) but its client-agent
 * methods are backed by the real registry.
 */

import { describe, expect, test } from "@jest/globals";
import {
    createChannelProviderAdapter,
    type ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import type { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import type { TypeAgentAction } from "@typeagent/agent-sdk";
import type { ClientIO } from "@typeagent/dispatcher-rpc/types";
import type { MacroManager } from "@typeagent/copilot-macros";
import {
    createAgentServerConnection,
    type AgentServerConnection,
} from "@typeagent/agent-server-client";
import { createAgentServerConnectionHandler } from "../src/connectionHandler.js";
import {
    createClientAgentRegistry,
    type ClientAgentHost,
    type ClientAgentRegistry,
} from "../src/clientAgentRegistry.js";
import type { ConversationManager } from "../src/conversationManager.js";

const AGENT_NAME = "androidDevice";
const CONVERSATION_ID = "conv-1";

const manifest: AppAgentManifest = {
    emojiChar: "\u23F0",
    description: "test",
    defaultEnabled: true,
    schemaDefaultEnabled: true,
    actionDefaultEnabled: true,
    schema: {
        description: "test",
        schemaType: "AndroidDeviceAction",
        schemaFile: {
            format: "ts",
            content:
                'export type AndroidDeviceAction = { actionName: "showAlarms" };',
        },
    },
} as AppAgentManifest;

type TestServer = {
    registry: ClientAgentRegistry;
    host: ClientAgentHost & { added: string[]; removed: string[] };
    connect(): TestClient;
};

type TestClient = {
    connection: AgentServerConnection;
    connectionId: string;
    join(): Promise<void>;
    disconnect(): void;
};

function createTestServer(): TestServer {
    const registry = createClientAgentRegistry();
    const added: string[] = [];
    const removed: string[] = [];
    const host = {
        added,
        removed,
        async addDynamicAgent(name: string) {
            added.push(name);
        },
        async removeDynamicAgent(name: string) {
            removed.push(name);
        },
    };

    let nextConnection = 0;
    const conversationManager = {
        async resolveConversationId(conversationId?: string) {
            return conversationId ?? CONVERSATION_ID;
        },
        async joinConversation() {
            nextConnection += 1;
            return {
                dispatcher: {} as any,
                connectionId: `conn-${nextConnection}`,
                name: "test",
                pendingInteractions: [],
            };
        },
        async leaveConversation() {},
        async addClientAgent(
            _conversationId: string,
            name: string,
            agentManifest: AppAgentManifest,
            appAgent: AppAgent,
            instanceId: string,
            displayName: string,
            connectionId: string,
            multiInstance: boolean,
            options?: any,
        ) {
            await registry.add(
                host,
                name,
                {
                    instanceId,
                    displayName,
                    connectionId,
                    appAgent,
                    manifest: agentManifest,
                    multiInstance,
                },
                options,
            );
        },
        findClientAgentInstance(
            _conversationId: string,
            name: string,
            connectionId: string,
        ) {
            return registry.findInstanceIdForConnection(name, connectionId);
        },
        async removeClientAgent(
            _conversationId: string,
            name: string,
            instanceId: string,
            options?: any,
        ) {
            await registry.remove(host, name, instanceId, options);
        },
    } as unknown as ConversationManager;

    const { handler } = createAgentServerConnectionHandler({
        conversationManager,
        macroManager: {} as MacroManager,
        shutdown: () => {},
        getUserIdentity: () => ({
            username: "test",
            displayName: "test",
            initial: "T",
        }),
    });

    return {
        registry,
        host,
        connect(): TestClient {
            let clientAdapter: ChannelProviderAdapter | undefined;
            const serverAdapter = createChannelProviderAdapter(
                "test:server",
                (message: any) => clientAdapter?.notifyMessage(message),
            );
            clientAdapter = createChannelProviderAdapter(
                "test:client",
                (message: any) => serverAdapter.notifyMessage(message),
            );
            handler(serverAdapter, () => {});
            const connection = createAgentServerConnection(
                clientAdapter,
                () => {},
            );
            const client: TestClient = {
                connection,
                connectionId: "",
                async join() {
                    const joined = await connection.joinConversation(
                        {} as ClientIO,
                        {
                            conversationId: CONVERSATION_ID,
                            clientType: "android",
                        },
                    );
                    client.connectionId = joined.connectionId;
                },
                disconnect() {
                    serverAdapter.notifyDisconnected();
                    clientAdapter!.notifyDisconnected();
                },
            };
            return client;
        },
    };
}

function makeAgent(executed: TypeAgentAction[]): AppAgent {
    return {
        async executeAction(action: TypeAgentAction) {
            executed.push(action);
            return undefined;
        },
    };
}

async function executeVia(
    server: TestServer,
    connectionId: string | undefined,
): Promise<void> {
    const group = server.registry.groups.get(AGENT_NAME);
    expect(group).toBeDefined();
    const sessionContext = {
        sessionContextId: "test",
        currentConnectionId: connectionId,
    } as any;
    await group!.mux.executeAction!(
        { actionName: "showAlarms" } as TypeAgentAction,
        { sessionContext } as any,
    );
}

describe("client agent multi-instance integration", () => {
    // Case 14
    test("two clients register the same agent name and each executes its own actions", async () => {
        const server = createTestServer();

        const executedA: TypeAgentAction[] = [];
        const clientA = server.connect();
        await clientA.join();
        await clientA.connection.registerClientAgent(
            AGENT_NAME,
            manifest,
            makeAgent(executedA),
            CONVERSATION_ID,
            {
                instanceId: "device-a",
                displayName: "Pixel 8",
                multiInstance: true,
            },
        );

        const executedB: TypeAgentAction[] = [];
        const clientB = server.connect();
        await clientB.join();
        await clientB.connection.registerClientAgent(
            AGENT_NAME,
            manifest,
            makeAgent(executedB),
            CONVERSATION_ID,
            {
                instanceId: "device-b",
                displayName: "Galaxy Tab",
                multiInstance: true,
            },
        );

        // One dynamic agent, two instances.
        expect(server.host.added).toEqual([AGENT_NAME]);
        expect(server.registry.groups.get(AGENT_NAME)!.instances.size).toBe(2);

        await executeVia(server, clientB.connectionId);
        expect(executedB).toHaveLength(1);
        expect(executedA).toHaveLength(0);

        await executeVia(server, clientA.connectionId);
        expect(executedA).toHaveLength(1);
        expect(executedB).toHaveLength(1);

        // Device A drops; device B keeps working and the dynamic agent stays.
        clientA.disconnect();
        await new Promise((resolve) => setImmediate(resolve));
        expect(server.registry.groups.get(AGENT_NAME)!.instances.size).toBe(1);
        expect(server.host.removed).toEqual([]);

        await executeVia(server, clientB.connectionId);
        expect(executedB).toHaveLength(2);

        // Last device out tears the dynamic agent down exactly once.
        clientB.disconnect();
        await new Promise((resolve) => setImmediate(resolve));
        expect(server.host.removed).toEqual([AGENT_NAME]);
        expect(server.registry.groups.size).toBe(0);
    });

    // Backward compatibility: a client that sends no identity still works.
    test("a client that sends no instanceId registers as a single instance", async () => {
        const server = createTestServer();

        const executed: TypeAgentAction[] = [];
        const client = server.connect();
        await client.join();
        await client.connection.registerClientAgent(
            AGENT_NAME,
            manifest,
            makeAgent(executed),
            CONVERSATION_ID,
        );

        const group = server.registry.groups.get(AGENT_NAME)!;
        expect(group.instances.size).toBe(1);
        const instance = [...group.instances.values()][0];
        expect(instance.connectionId).toBe(client.connectionId);
        expect(instance.displayName).toBe(AGENT_NAME);

        await executeVia(server, undefined);
        expect(executed).toHaveLength(1);
    });
});
