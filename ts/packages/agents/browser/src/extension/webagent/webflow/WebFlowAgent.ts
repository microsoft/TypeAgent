// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebAgent, WebAgentContext } from "../WebAgentContext";
import {
    ContinuationState,
    continuationStorage,
} from "../../contentScript/webAgentStorage";
import { createBrowserAdapter } from "./webFlowBrowserAdapter";
import { getWebFlowsForDomain, WebFlowDefinitionTransport } from "./webFlowRpc";
import { isWebFlowRefreshMessage } from "../../../common/webAgentMessageTypes.mjs";

interface WebFlowParameter {
    type: "string" | "number" | "boolean";
    required: boolean;
    description: string;
    default?: unknown;
    valueOptions?: string[];
}

interface WebFlowContinuationData {
    flowName: string;
    flowParams: Record<string, unknown>;
    [key: string]: unknown;
}

interface WebFlowExecutionResult {
    success: boolean;
    message?: string;
    continuation?: {
        step: string;
        data?: Record<string, unknown>;
    };
}

/**
 * WebFlowAgent runs in the browser extension's MAIN world.
 *
 * With the global schema migration, grammar matching and action dispatch are
 * handled server-side via getDynamicGrammar/getDynamicSchema on the browser
 * agent. This agent now only handles:
 * - Caching flows locally for continuation support
 * - Listening for server refresh messages to update the local cache
 * - Executing continuations (multi-page flows) in the MAIN world
 */
export class WebFlowAgent implements WebAgent {
    name = "webflow";
    urlPatterns = [/^https?:\/\//];

    private context: WebAgentContext | null = null;
    private flowsByName: Map<string, WebFlowDefinitionTransport> = new Map();
    private cachedLastUpdated: string | null = null;
    private refreshListenerAttached = false;

    async initialize(context: WebAgentContext): Promise<void> {
        console.log("[WebFlowAgent] initialize() called");
        this.context = context;

        if (!this.refreshListenerAttached) {
            window.addEventListener("message", (event: MessageEvent) => {
                if (event.source !== window) return;
                if (isWebFlowRefreshMessage(event.data)) {
                    console.log("[WebFlowAgent] Refresh message from server");
                    this.handleRefresh();
                }
            });
            this.refreshListenerAttached = true;
        }

        const url = context.getCurrentUrl();
        let hostname: string;
        try {
            hostname = new URL(url).hostname;
        } catch {
            console.log("[WebFlowAgent] Invalid URL, skipping");
            return;
        }

        // Cache flows locally for continuation support
        await this.fetchAndCacheFlows(hostname);
    }

    async handleContinuation(
        continuation: ContinuationState,
        context: WebAgentContext,
    ): Promise<void> {
        if (continuation.type !== "webflow") {
            console.log(
                `[WebFlowAgent] Ignoring continuation type: ${continuation.type}`,
            );
            return;
        }

        this.context = context;
        const data = continuation.data as WebFlowContinuationData;
        let flow = this.flowsByName.get(data.flowName);

        if (!flow) {
            // Flow not loaded yet — try fetching for current domain
            const url = context.getCurrentUrl();
            try {
                const hostname = new URL(url).hostname;
                await this.fetchAndCacheFlows(hostname);
            } catch {
                // ignore
            }
            flow = this.flowsByName.get(data.flowName);
        }

        if (!flow) {
            console.error(
                `[WebFlowAgent] Continuation flow not found: ${data.flowName}`,
            );
            await context.notify(
                `Flow "${data.flowName}" not found for continuation`,
            );
            return;
        }

        console.log(
            `[WebFlowAgent] Handling continuation: flow=${data.flowName}, step=${continuation.step}`,
        );

        try {
            const { flowName, flowParams, ...stepData } = data;
            const result =
                (await this.executeFlow(flow, flowParams, {
                    step: continuation.step,
                    data: stepData,
                })) ?? {};

            if (result.continuation) {
                await this.storeContinuation(
                    flow.name,
                    flowParams,
                    result.continuation.step,
                    result.continuation.data ?? {},
                );
                console.log(
                    `[WebFlowAgent] Stored next continuation: step=${result.continuation.step}`,
                );
            }

            await context.notify(result.message ?? "Done");
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(
                `[WebFlowAgent] Continuation execution failed:`,
                error,
            );
            await context.notify(`Error: ${msg}`);
        }
    }

    private async handleRefresh(): Promise<void> {
        if (!this.context) return;

        const url = this.context.getCurrentUrl();
        let hostname: string;
        try {
            hostname = new URL(url).hostname;
        } catch {
            return;
        }

        console.log(`[WebFlowAgent] Refreshing flow cache for ${hostname}`);
        await this.fetchAndCacheFlows(hostname);
    }

    private async fetchAndCacheFlows(hostname: string): Promise<void> {
        try {
            const response = await getWebFlowsForDomain(
                hostname,
                this.cachedLastUpdated ?? undefined,
            );
            if (response.notModified) {
                return;
            }
            this.flowsByName = new Map(response.flows.map((f) => [f.name, f]));
            this.cachedLastUpdated = response.lastUpdated;
            console.log(
                `[WebFlowAgent] Cached ${response.flows.length} flows for ${hostname}`,
            );
        } catch (error) {
            console.error("[WebFlowAgent] Failed to fetch flows:", error);
        }
    }

    private async storeContinuation(
        flowName: string,
        flowParams: Record<string, unknown>,
        step: string,
        stepData: Record<string, unknown>,
    ): Promise<void> {
        if (!this.context) return;

        const tabId = await this.context.getTabId();
        if (!tabId) {
            console.warn("[WebFlowAgent] Could not get tabId for continuation");
            return;
        }

        const data: WebFlowContinuationData = {
            flowName,
            flowParams,
            ...stepData,
        };

        continuationStorage.set(tabId, {
            type: "webflow",
            step,
            data,
            url: window.location.href,
        });
    }

    private async executeFlow(
        flow: WebFlowDefinitionTransport,
        params: Record<string, unknown>,
        continuation?: { step: string; data: Record<string, unknown> },
    ): Promise<WebFlowExecutionResult> {
        if (!this.context) {
            throw new Error("WebFlowAgent context not available");
        }

        const browserApi = createBrowserAdapter(this.context);
        const resolvedParams = resolveParams(flow.parameters, params);

        const fn = new Function(
            "browser",
            "params",
            "continuation",
            `"use strict"; return (${flow.script})(browser, params, continuation);`,
        );

        return await fn(
            Object.freeze(browserApi),
            Object.freeze(resolvedParams),
            continuation ? Object.freeze(continuation) : undefined,
        );
    }
}

function resolveParams(
    paramDefs: Record<string, WebFlowParameter>,
    provided: Record<string, unknown>,
): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(paramDefs)) {
        if (provided[name] !== undefined && provided[name] !== null) {
            resolved[name] = provided[name];
        } else if (def.default !== undefined) {
            resolved[name] = def.default;
        } else {
            resolved[name] = def.type === "boolean" ? false : "";
        }
    }
    return resolved;
}
