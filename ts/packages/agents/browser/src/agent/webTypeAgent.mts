// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentManifest, SessionContext } from "@typeagent/agent-sdk";
import { createAgentRpcClient } from "@typeagent/agent-rpc/client";
import {
    createChannelAdapter,
    createChannelProviderAdapter,
    ChannelAdapter,
    ChannelProviderAdapter,
} from "@typeagent/agent-rpc/channel";
import { createRpc } from "@typeagent/agent-rpc/rpc";
import { BrowserActionContext } from "./browserActions.mjs";
import { WebAgentMessage } from "../common/webAgentMessageTypes.mjs";

import registerDebug from "debug";
import { AgentInterfaceFunctionName } from "@typeagent/agent-rpc/server";

const debug = registerDebug("typeagent:webAgent");
const debugError = registerDebug("typeagent:webAgent:error");

export type WebAgentChannels = {
    channelProvider: ChannelProviderAdapter;
    registerChannel: ChannelAdapter;
};

// Built-in WebAgent URL patterns that are auto-approved (no user permission required)
const BUILTIN_WEBAGENT_URL_PATTERNS = [
    // Crossword sites
    /wsj\.com\/puzzles\/crossword/,
    /embed\.universaluclick\.com\//,
    /data\.puzzlexperts\.com\/puzzleapp/,
    /nytsyn\.pzzl\.com\/cwd_seattle/,
    /seattletimes\.com\/games-nytimes-crossword/,
    /denverpost\.com\/games\/daily-crossword/,
    /denverpost\.com\/puzzles\/\?amu=\/iwin-crossword/,
    /bestcrosswords\.com\/bestcrosswords\/guestconstructor/,
    // PaleoBioDb
    /paleobiodb\.org/,
];

function isBuiltInWebAgentUrl(url: string): boolean {
    return BUILTIN_WEBAGENT_URL_PATTERNS.some((pattern) => pattern.test(url));
}

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
    // Built-in WebAgents are auto-approved
    if (isBuiltInWebAgentUrl(url)) {
        debug(`Auto-approving built-in WebAgent from ${url}`);
        return true;
    }

    const domain = new URL(url).hostname;
    if (context.agentContext.allowDynamicAgentDomains?.includes(domain)) {
        return true;
    }

    try {
        const result = await context.popupQuestion(
            `The Web Page '${title}' from domain '${domain}' want to connect to TypeAgent?`,
            ["Allow Once", `Always Allow Domain ${domain}`, "Deny"],
        );

        if (result === 1) {
            await addAllowDynamicAgentDomains(domain, context);
            return true;
        }
        return result === 0;
    } catch (e: any) {
        // popupQuestion may throw "Not implemented" when running without GUI
        if (e.message === "Not implemented") {
            debugError(
                `Cannot prompt for permission for ${domain}: popup questions not supported in this environment. ` +
                    `Add the domain to allowDynamicAgentDomains.json or use the GUI shell.`,
            );
        } else {
            debugError(`Failed to check permission for ${domain}:`, e);
        }
        return false;
    }
}
function ensureWebAgentChannels(context: SessionContext<BrowserActionContext>) {
    const existing = context.agentContext.webAgentChannels;
    if (existing) {
        return existing;
    }

    const agentServer = context.agentContext.agentWebSocketServer;
    if (agentServer === undefined) {
        return undefined;
    }

    const channelProvider = createChannelProviderAdapter(
        "webAgent:server",
        (message) => {
            if (message === undefined || message === null) {
                debugError(
                    "Attempted to send undefined/null message via webAgent/message",
                );
                return;
            }
            const client = agentServer.getActiveClient();
            if (client) {
                client.socket.send(
                    JSON.stringify({
                        source: "dispatcher",
                        method: "webAgent/message",
                        params: message,
                    }),
                );
            }
        },
    );

    const registerChannel = createChannelAdapter((message) => {
        if (message === undefined || message === null) {
            debugError(
                "Attempted to send undefined/null message via webAgent/register",
            );
            return;
        }
        const client = agentServer.getActiveClient();
        if (client) {
            client.socket.send(
                JSON.stringify({
                    source: "dispatcher",
                    method: "webAgent/register",
                    params: message,
                }),
            );
        }
    });

    createRpc("webAgent:server", registerChannel.channel, {
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
                // If the channel already exists, the agent is already registered
                if (e.message?.includes("already exists")) {
                    debug("Dynamic agent already registered, skipping", name);
                    return;
                }
                debugError("Failed to register dynamic agent", name, e);
                // Clean up the channel if adding the agent fails
                channelProvider.deleteChannel(`agent:${name}`);
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
                webAgentChannels.registerChannel.notifyMessage(message.params);
                break;
            case "webAgent/message":
                webAgentChannels.channelProvider.notifyMessage(message.params);
                break;
            case "webAgent/disconnect":
                const agentNames = message.params;
                for (const name of agentNames) {
                    await context.removeDynamicAgent(name);
                    webAgentChannels.channelProvider.deleteChannel(
                        `agent:${name}`,
                    );
                }
                break;
        }
    } catch (e: any) {
        debugError("Error processing web agent message", e);
    }
}
