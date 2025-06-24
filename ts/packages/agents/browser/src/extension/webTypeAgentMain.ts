// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import {
    createGenericChannel,
    createGenericChannelProvider,
} from "agent-rpc/channel";
import { createRpc } from "agent-rpc/rpc";
import {
    AgentInterfaceFunctionName,
    createAgentRpcServer,
} from "agent-rpc/server";
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
    const messageChannelProvider = createGenericChannelProvider(
        (message: any) => {
            window.postMessage({
                source: "webAgent",
                method: "webAgent/message",
                params: message,
            } as WebAgentRpcMessage);
        },
    );

    const registerChannel = createGenericChannel((message: any) => {
        window.postMessage({
            source: "webAgent",
            method: "webAgent/register",
            params: message,
        } as WebAgentRegisterMessage);
    });

    const rpc = createRpc<DynamicTypeAgentManagerInvokeFunctions>(
        "webAgent",
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
                    registerChannel.message(data.params);
                    break;
                case "webAgent/message":
                    messageChannelProvider.message(data.params);
                    break;
                case "webAgent/disconnect":
                    messageChannelProvider.disconnect();
                    registerChannel.disconnect();
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

    window.addEventListener("beforeunload", (event) => {
        window.postMessage({
            source: "webAgent",
            method: "webAgent/disconnect",
            params: name,
        });
    });
};
