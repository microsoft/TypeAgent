// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BrowserControl, SearchProvider } from "../common/browserControl.mjs";
import { ExternalBrowserClient } from "./rpc/externalBrowserControlClient.mjs";
import { ChildProcess } from "child_process";
import { TabTitleIndex } from "./tabTitleIndex.mjs";
import { TextEmbeddingModel } from "aiclient";
import type { WebsiteCollection, IndexData } from "website-memory";
import { ActionContext, SessionContext } from "@typeagent/agent-sdk";
import { WebFlowStore } from "./webFlows/store/webFlowStore.mjs";
import { WebAgentChannels } from "./webTypeAgent.mjs";
import {
    BrowserClient,
    AgentWebSocketServer,
} from "./agentWebSocketServer.mjs";
import { getClientType } from "@typeagent/agent-server-protocol";

export type BrowserActionContext = {
    sessionId: string;
    clientBrowserControl?: BrowserControl | undefined;
    externalBrowserControl?: ExternalBrowserClient | undefined;
    useExternalBrowserControl: boolean;
    preferredClientType?: "extension" | "electron";
    agentWebSocketServer?: AgentWebSocketServer;
    browserControl?: BrowserControl;
    currentClient?: BrowserClient;
    extractionClients?: Map<string, string>;
    webAgentChannels?: WebAgentChannels | undefined;
    browserProcess?: ChildProcess | undefined;
    tabTitleIndex?: TabTitleIndex | undefined;
    allowDynamicAgentDomains?: string[];
    websiteCollection?: WebsiteCollection | undefined;
    graphJsonStorage?: any | undefined; // GraphologyPersistenceManager - field name maintained for compatibility
    fuzzyMatchingModel?: TextEmbeddingModel | undefined;
    index: IndexData | undefined;
    viewProcess?: ChildProcess | undefined;
    localHostPort: number;
    webFlowStore?: WebFlowStore | undefined;
    currentWebSearchResults?: Map<string, any[]> | undefined; // Store search results for follow-up actions
    resolverSettings: {
        searchResolver?: boolean | undefined;
        keywordResolver?: boolean | undefined;
        wikipediaResolver?: boolean | undefined;
        historyResolver?: boolean | undefined;
    };
    searchProviders: SearchProvider[];
    activeSearchProvider: SearchProvider;
};

export function getBrowserControl(agentContext: BrowserActionContext) {
    const browserControl = agentContext.useExternalBrowserControl
        ? agentContext.externalBrowserControl?.control
        : agentContext.clientBrowserControl;
    if (!browserControl) {
        throw new Error(
            `${agentContext.externalBrowserControl ? "External" : "Client"} browser control is not available.`,
        );
    }
    return browserControl;
}

/**
 * Get the appropriate browser control for a specific request.
 *
 * Uses the requestId's connectionId to look up which client initiated
 * the request. Extension clients route to the external browser control
 * (Chrome native); shell clients route to the inline browser control.
 *
 * Falls back to the session-wide getBrowserControl() if the client type
 * is unknown or if the preferred control is not available.
 */
export function getBrowserControlForRequest(
    agentContext: BrowserActionContext,
    connectionId: string | undefined,
): BrowserControl {
    if (connectionId) {
        const clientType = getClientType(connectionId);
        if (clientType === "extension" && agentContext.externalBrowserControl) {
            return agentContext.externalBrowserControl.control;
        }

        if (clientType === "shell" && agentContext.clientBrowserControl) {
            return agentContext.clientBrowserControl;
        }
    }

    return getBrowserControl(agentContext);
}

export function getActionBrowserControl(
    context: ActionContext<BrowserActionContext>,
): BrowserControl {
    const browserControl = context.sessionContext.agentContext.browserControl;
    if (!browserControl) {
        throw new Error("Browser control is not available.");
    }
    return browserControl;
}

export function getSessionBrowserControl(
    sessionContext: SessionContext<BrowserActionContext>,
) {
    return getBrowserControl(sessionContext.agentContext);
}

export async function getCurrentPageScreenshot(
    browserControl: BrowserControl,
): Promise<string> {
    return await Promise.race<string>([
        (async () => {
            try {
                return await browserControl.captureScreenshot();
            } catch (err) {
                const message = (err as Error)?.message || "";
                if (
                    message.includes(
                        "MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND",
                    ) ||
                    message.includes("Tabs cannot be edited right now")
                ) {
                    return "";
                }
                throw new Error(`Screenshot capture failed: ${message}`);
            }
        })(),
        new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error("Screenshot capture timed out")),
                10000,
            ),
        ),
    ]);
}

export async function saveSettings(
    context: SessionContext<BrowserActionContext>,
) {
    const agentContext = context.agentContext;
    const settings = {
        resolverSettings: agentContext.resolverSettings,
        searchProviders: agentContext.searchProviders,
        activeSearchProvider: agentContext.activeSearchProvider,
    };

    await context.sessionStorage?.write(
        "settings.json",
        JSON.stringify(settings),
    );
}
