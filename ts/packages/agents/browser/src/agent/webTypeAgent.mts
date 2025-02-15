// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentManifest, SessionContext } from "@typeagent/agent-sdk";
import { createAgentRpcClient } from "agent-rpc/client";
import {
    createGenericChannel,
    createGenericChannelProvider,
    GenericChannel,
    GenericChannelProvider,
} from "agent-rpc/channel";
import { createRpc } from "agent-rpc/rpc";
import { BrowserActionContext } from "./actionHandler.mjs";
import { WebAgentMessage } from "../common/webAgentMessageTypes.mjs";

import registerDebug from "debug";

const debugError = registerDebug("typeagent:webAgent:error");

export type WebAgentChannels = {
    channelProvider: GenericChannelProvider;
    registerChannel: GenericChannel;
};

function ensureWebAgentChannels(context: SessionContext<BrowserActionContext>) {
    const existing = context.agentContext.webAgentChannels;
    if (existing) {
        return existing;
    }

    const webSocket = context.agentContext.webSocket;
    if (webSocket === undefined) {
        return undefined;
    }

    const channelProvider = createGenericChannelProvider((message) => {
        webSocket.send(
            JSON.stringify({
                source: "dispatcher",
                method: "webAgent/message",
                params: message,
            }),
        );
    });

    const registerChannel = createGenericChannel((message) => {
        webSocket.send(
            JSON.stringify({
                source: "dispatcher",
                method: "webAgent/register",
                params: message,
            }),
        );
    });

    createRpc(registerChannel.channel, {
        addTypeAgent: async (param: {
            name: string;
            manifest: AppAgentManifest;
        }): Promise<void> => {
            try {
                await context.addDynamicAgent(
                    param.name,
                    param.manifest,
                    await createAgentRpcClient(param.name, channelProvider),
                );
            } catch (e: any) {
                // Clean up the channel if adding the agent fails
                channelProvider.deleteChannel(param.name);
                throw e;
            }
        },
    });

    const webAgentChannels = {
        channelProvider,
        registerChannel,
    };
    context.agentContext.webAgentChannels = webAgentChannels;
    return webAgentChannels;
}

export async function processWebAgentMessage(
    message: WebAgentMessage,
    context: SessionContext<BrowserActionContext>,
) {
    const webAgentChannels = ensureWebAgentChannels(context);
    if (webAgentChannels === undefined) {
        return;
    }
    try {
        switch (message.method) {
            case "webAgent/register":
                webAgentChannels.registerChannel.message(message.params);
                break;
            case "webAgent/message":
                webAgentChannels.channelProvider.message(message.params);
                break;
            case "webAgent/disconnect":
                await context.removeDynamicAgent(message.params);
                webAgentChannels.channelProvider.deleteChannel(message.params);
                break;
        }
    } catch (e: any) {
        debugError("Error processing web agent message", e);
    }
}
