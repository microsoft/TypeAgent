// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import {
    createChannelAdapter,
    createChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import {
    AgentInterfaceFunctionName,
    createAgentRpcServer,
} from "@typeagent/agent-rpc/server";
import { isWebAgentMessageFromDispatcher } from "../common/webAgentMessageTypes.mjs";
import {
    WebAgentRegisterMessage,
    WebAgentRpcMessage,
} from "../common/webAgentMessageTypes.mjs";

declare global {
    function registerTypeAgent(
        name: string,
        manifest: AppAgentManifest,
        agent: AppAgent,
    ): void;

    interface Window {
        webAgentApi: {
            onWebAgentMessage: (callback: (message: any) => void) => void;
            sendWebAgentMessage: (message: any) => void;
        };
    }
}

type DynamicTypeAgentManager = {
    addTypeAgent: (
        name: string,
        manifest: AppAgentManifest,
        agent: AppAgent,
    ) => Promise<void>;
};

type DynamicTypeAgentManagerInvokeFunctions = {
    addTypeAgent: (param: {
        name: string;
        manifest: AppAgentManifest;
        agentInterface: AgentInterfaceFunctionName[];
    }) => Promise<void>;
};

let manager: DynamicTypeAgentManager | undefined;
function ensureDynamicTypeAgentManager(): DynamicTypeAgentManager {
    if (manager !== undefined) {
        return manager;
    }
    const messageChannelProvider = createChannelProviderAdapter(
        "webAgent:client",
        (message: any) => {
            const wrapped: WebAgentRpcMessage = {
                source: "webAgent",
                method: "webAgent/message",
                // REVIEW: fields in the original message may not be structure cloneable.  Use JSON stringify/parse to sanitize.
                params: JSON.parse(JSON.stringify(message)),
            };

            window.postMessage(wrapped);
        },
    );

    const registerChannel = createChannelAdapter((message: any) => {
        const wrapped: WebAgentRegisterMessage = {
            source: "webAgent",
            method: "webAgent/register",
            // REVIEW: fields in the original message may not be structure cloneable.  Use JSON stringify/parse to sanitize.
            params: JSON.parse(JSON.stringify(message)),
        };
        window.postMessage(wrapped);
    });

    const rpc = createRpc<DynamicTypeAgentManagerInvokeFunctions>(
        "webAgent:client",
        registerChannel.channel,
    );
    manager = {
        addTypeAgent: async (name, manifest, agent) => {
            const { closeFn, agentInterface } = createAgentRpcServer(
                name,
                agent,
                messageChannelProvider,
            );

            const p = rpc.invoke("addTypeAgent", {
                name,
                manifest,
                agentInterface,
            });

            try {
                await p;
            } catch (e) {
                closeFn();
                throw e;
            }
        },
    };

    const messageHandler = (event: MessageEvent) => {
        const data = event.data;
        if (isWebAgentMessageFromDispatcher(data)) {
            switch (data.method) {
                case "webAgent/register":
                    registerChannel.notifyMessage(data.params);
                    break;
                case "webAgent/message":
                    messageChannelProvider.notifyMessage(data.params);
                    break;
                case "webAgent/disconnect":
                    messageChannelProvider.notifyDisconnected();
                    registerChannel.notifyDisconnected();
                    window.removeEventListener("message", messageHandler);
                    manager = undefined;
                    break;
            }
        }
    };

    window.addEventListener("message", messageHandler);

    return manager;
}

const actualGlobal = globalThis ?? global;

actualGlobal.registerTypeAgent = async (
    name: string,
    manifest: AppAgentManifest,
    agent: AppAgent,
): Promise<void> => {
    const manager = ensureDynamicTypeAgentManager();
    await manager.addTypeAgent(name, manifest, agent);
};
