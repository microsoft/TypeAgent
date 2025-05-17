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
import { AgentInterfaceFunctionName } from "agent-rpc/server";

const debug = registerDebug("typeagent:webAgent");
const debugError = registerDebug("typeagent:webAgent:error");

export type WebAgentChannels = {
    channelProvider: GenericChannelProvider;
    registerChannel: GenericChannel;
};

const dynamicAgentDomainsDataName = "allowDynamicAgentDomains.json";
export async function loadAllowDynamicAgentDomains(
    context: SessionContext<BrowserActionContext>,
) {
    try {
        const allowDynamicAgentDomains = await context.sessionStorage?.read(
            dynamicAgentDomainsDataName,
            "utf8",
        );
        if (allowDynamicAgentDomains) {
            const parsedDomains = JSON.parse(allowDynamicAgentDomains);
            if (
                Array.isArray(parsedDomains) &&
                parsedDomains.every((item) => typeof item === "string")
            ) {
                context.agentContext.allowDynamicAgentDomains = parsedDomains;
            } else {
                throw new Error(
                    `Invalid format for ${dynamicAgentDomainsDataName}. Expected an string array.`,
                );
            }
        }
    } catch (e) {
        debugError("Failed to load allowDynamicAgentDomains.json", e);
    }
}

async function addAllowDynamicAgentDomains(
    domain: string,
    context: SessionContext<BrowserActionContext>,
) {
    if (context.agentContext.allowDynamicAgentDomains === undefined) {
        context.agentContext.allowDynamicAgentDomains = [];
    }
    const allowDynamicAgentDomains =
        context.agentContext.allowDynamicAgentDomains;
    if (allowDynamicAgentDomains.includes(domain)) {
        return;
    }
    allowDynamicAgentDomains.push(domain);

    try {
        await context.sessionStorage?.write(
            dynamicAgentDomainsDataName,
            JSON.stringify(allowDynamicAgentDomains),
            "utf8",
        );
    } catch (e) {
        debugError("Failed to save allowDynamicAgentDomains.json", e);
    }
}

async function checkDynamicAgentPermission(
    title: string,
    url: string,
    context: SessionContext<BrowserActionContext>,
) {
    const domain = new URL(url).hostname;
    if (context.agentContext.allowDynamicAgentDomains?.includes(domain)) {
        return true;
    }
    const result = await context.popupQuestion(
        `The Web Page '${title}' from domain '${domain}' want to connect to TypeAgent?`,
        ["Allow Once", `Always Allow Domain ${domain}`, "Deny"],
    );

    if (result === 1) {
        await addAllowDynamicAgentDomains(domain, context);
        return true;
    }
    return result === 0;
}
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
            agentInterface: AgentInterfaceFunctionName[];
            title: string; // filled in by the proxy (service worker for browser or preload script in electron)
            url: string; // filled in by the proxy (service worker for browser or preload script in electron)
        }): Promise<void> => {
            const { name, manifest, title, url, agentInterface } = param;

            if (!(await checkDynamicAgentPermission(title, url, context))) {
                throw new Error(
                    `Permission denied: Dynamic agent ${param.name} is not allowed to connect to TypeAgent.`,
                );
            }
            try {
                await context.addDynamicAgent(
                    name,
                    manifest,
                    await createAgentRpcClient(
                        name,
                        channelProvider,
                        agentInterface,
                    ),
                );
                debug("Registered dynamic agent", name);
            } catch (e: any) {
                debugError("Failed to register dynamic agent", name, e);
                // Clean up the channel if adding the agent fails
                channelProvider.deleteChannel(name);
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
