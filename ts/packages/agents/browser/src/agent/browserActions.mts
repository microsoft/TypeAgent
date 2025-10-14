// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BrowserControl, SearchProvider } from "../common/browserControl.mjs";
import { ExternalBrowserClient } from "./rpc/externalBrowserControlClient.mjs";
import { Crossword } from "./crossword/schema/pageSchema.mjs";
import { ChildProcess } from "child_process";
import { TabTitleIndex } from "./tabTitleIndex.mjs";
import { BrowserConnector } from "./browserConnector.mjs";
import { TextEmbeddingModel } from "aiclient";
import * as website from "website-memory";
import { ActionContext, SessionContext } from "@typeagent/agent-sdk";
import { MacroStore } from "./storage/index.mjs";
import { WebAgentChannels } from "./webTypeAgent.mjs";
import {
    BrowserClient,
    AgentWebSocketServer,
} from "./agentWebSocketServer.mjs";

export type BrowserActionContext = {
    clientBrowserControl?: BrowserControl | undefined;
    externalBrowserControl?: ExternalBrowserClient | undefined;
    useExternalBrowserControl: boolean;
    preferredClientType?: "extension" | "electron";
    agentWebSocketServer?: AgentWebSocketServer;
    browserConnector?: BrowserConnector;
    currentClient?: BrowserClient;
    extractionClients?: Map<string, string>;
    webAgentChannels?: WebAgentChannels | undefined;
    crosswordCachedSchemas?: Map<string, Crossword> | undefined;
    crossWordState?: Crossword | undefined;
    browserProcess?: ChildProcess | undefined;
    tabTitleIndex?: TabTitleIndex | undefined;
    allowDynamicAgentDomains?: string[];
    websiteCollection?: website.WebsiteCollection | undefined;
    fuzzyMatchingModel?: TextEmbeddingModel | undefined;
    index: website.IndexData | undefined;
    viewProcess?: ChildProcess | undefined;
    localHostPort: number;
    macrosStore?: MacroStore | undefined; // Add MacroStore instance
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

export async function saveSettings(
    context: SessionContext<BrowserActionContext>,
) {
    await context.sessionStorage?.write(
        "settings.json",
        JSON.stringify({
            resolverSettings: context.agentContext.resolverSettings,
            searchProviders: context.agentContext.searchProviders,
            activeSearchProvider: context.agentContext.activeSearchProvider,
        }),
    );
}

export function getActionBrowserControl(
    actionContext: ActionContext<BrowserActionContext>,
) {
    return getBrowserControl(actionContext.sessionContext.agentContext);
}
export function getSessionBrowserControl(
    sessionContext: SessionContext<BrowserActionContext>,
) {
    return getBrowserControl(sessionContext.agentContext);
}
