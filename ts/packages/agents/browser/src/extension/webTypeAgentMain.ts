// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, AppAgentManifest } from "@typeagent/agent-sdk";
import {
    createGenericChannel,
    createGenericChannelProvider,
} from "agent-rpc/channel";
import { createRpc } from "agent-rpc/rpc";
import { createAgentRpcServer } from "agent-rpc/server";
import { isWebAgentMessageFromDispatcher } from "../../dist/common/webAgentMessageTypes.mjs";
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
    }) => Promise<void>;
};

let manager: DynamicTypeAgentManager | undefined;
function ensureDynamicTypeAgentManager(): DynamicTypeAgentManager {
    if (manager !== undefined) {
        return manager;
    }
    const messageChannelProvider = createGenericChannelProvider(
        (message: any) =>
            window.postMessage({
                target: "dispatcher",
                source: "webAgent",
                messageType: "message",
                body: message,
            } as WebAgentRpcMessage),
    );

    const registerChannel = createGenericChannel((message: any) =>
        window.postMessage({
            target: "dispatcher",
            source: "webAgent",
            messageType: "register",
            body: message,
        } as WebAgentRegisterMessage),
    );

    const rpc = createRpc<DynamicTypeAgentManagerInvokeFunctions>(
        registerChannel.channel,
    );
    manager = {
        addTypeAgent: async (name, manifest, agent) => {
            const p = rpc.invoke("addTypeAgent", {
                name,
                manifest,
            });

            const closeFn = createAgentRpcServer(
                name,
                agent,
                messageChannelProvider,
            );
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
            switch (data.messageType) {
                case "register":
                    registerChannel.message(data.body);
                    break;
                case "message":
                    messageChannelProvider.message(data.body);
                    break;
                case "disconnect":
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

global.registerTypeAgent = async (
    name: string,
    manifest: AppAgentManifest,
    agent: AppAgent,
): Promise<void> => {
    const manager = ensureDynamicTypeAgentManager();
    return manager.addTypeAgent(name, manifest, agent);
};
