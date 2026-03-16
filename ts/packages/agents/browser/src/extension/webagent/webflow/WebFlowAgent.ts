// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionResult,
    AppAgent,
    AppAgentManifest,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { WebAgent, WebAgentContext } from "../WebAgentContext";
import {
    ContinuationState,
    continuationStorage,
    registrationStorage,
} from "../../contentScript/webAgentStorage";
import { createBrowserAdapter } from "./webFlowBrowserAdapter";
import { getWebFlowsForDomain, WebFlowDefinitionTransport } from "./webFlowRpc";
import { isWebFlowRefreshMessage } from "../../../common/webAgentMessageTypes.mjs";

declare global {
    interface Window {
        registerTypeAgent?: (
            name: string,
            manifest: AppAgentManifest,
            agent: AppAgent,
        ) => Promise<void>;
    }
}

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

export class WebFlowAgent implements WebAgent {
    name = "webflow";
    urlPatterns = [/^https?:\/\//];

    private context: WebAgentContext | null = null;
    private flowsByName: Map<string, WebFlowDefinitionTransport> = new Map();
    private registeredHost: string | null = null;
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

        // If already registered for this host, check cache freshness
        if (this.registeredHost === hostname && this.cachedLastUpdated) {
            const response = await getWebFlowsForDomain(
                hostname,
                this.cachedLastUpdated,
            );
            if (response.notModified) {
                console.log(`[WebFlowAgent] Cache still valid for ${hostname}`);
                return;
            }
            // Cache is stale — fall through to re-register
            console.log(
                `[WebFlowAgent] Cache stale for ${hostname}, re-fetching`,
            );
            await this.registerForHost(
                hostname,
                response.flows,
                response.lastUpdated,
            );
            return;
        }

        await context.awaitPageReady({ stabilityMs: 300, timeoutMs: 2000 });

        const response = await getWebFlowsForDomain(hostname);
        if (response.flows.length === 0) {
            console.log(`[WebFlowAgent] No flows found for ${hostname}`);
            return;
        }

        await this.registerForHost(
            hostname,
            response.flows,
            response.lastUpdated,
        );
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
        const flow = this.flowsByName.get(data.flowName);

        if (!flow) {
            // Flow not loaded yet — try fetching for current domain
            const url = context.getCurrentUrl();
            try {
                const hostname = new URL(url).hostname;
                const response = await getWebFlowsForDomain(hostname);
                if (response.flows.length > 0) {
                    this.flowsByName = new Map(
                        response.flows.map((f) => [f.name, f]),
                    );
                }
            } catch {
                // ignore
            }

            const retryFlow = this.flowsByName.get(data.flowName);
            if (!retryFlow) {
                console.error(
                    `[WebFlowAgent] Continuation flow not found: ${data.flowName}`,
                );
                await context.notify(
                    `Flow "${data.flowName}" not found for continuation`,
                );
                return;
            }

            await this.executeContinuationStep(
                retryFlow,
                data,
                continuation,
                context,
            );
            return;
        }

        await this.executeContinuationStep(flow, data, continuation, context);
    }

    private async executeContinuationStep(
        flow: WebFlowDefinitionTransport,
        data: WebFlowContinuationData,
        continuation: ContinuationState,
        context: WebAgentContext,
    ): Promise<void> {
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

    /**
     * Called by the refresh event listener when the server signals
     * that flows have changed (e.g., after discovery or recording).
     */
    private async handleRefresh(): Promise<void> {
        if (!this.context) return;

        const url = this.context.getCurrentUrl();
        let hostname: string;
        try {
            hostname = new URL(url).hostname;
        } catch {
            return;
        }

        console.log(`[WebFlowAgent] Refreshing flows for ${hostname}`);

        // Force re-fetch (no ifModifiedSince)
        const response = await getWebFlowsForDomain(hostname);
        if (response.flows.length === 0 && this.registeredHost === hostname) {
            console.log(
                `[WebFlowAgent] No flows after refresh for ${hostname}`,
            );
            return;
        }

        await this.registerForHost(
            hostname,
            response.flows,
            response.lastUpdated,
        );
    }

    private async registerForHost(
        hostname: string,
        flows: WebFlowDefinitionTransport[],
        lastUpdated: string,
    ): Promise<void> {
        this.flowsByName = new Map(flows.map((f) => [f.name, f]));
        this.cachedLastUpdated = lastUpdated;

        const schema = buildSchemaFromFlows(flows);
        const agentName = hostname.replace(/\./g, "_");

        const manifest: AppAgentManifest = {
            emojiChar: "🔄",
            description: `WebFlow actions for ${hostname}`,
            schema: {
                description: `Dynamic actions for ${hostname}`,
                schemaType: "DynamicUserPageActions",
                schemaFile: { content: schema, format: "ts" },
            },
        };

        if (!window.registerTypeAgent) {
            console.error("[WebFlowAgent] registerTypeAgent not available");
            return;
        }

        try {
            console.log(
                `[WebFlowAgent] Registering ${agentName} with ${flows.length} flows`,
            );
            await window.registerTypeAgent(
                agentName,
                manifest,
                this.createAppAgent(),
            );
            registrationStorage.markRegistered(agentName);
            this.registeredHost = hostname;
            console.log(`[WebFlowAgent] Registered ${agentName}`);
        } catch (error) {
            console.error("[WebFlowAgent] Registration failed:", error);
        }
    }

    private createAppAgent(): AppAgent {
        const agent = this;
        return {
            async executeAction(
                action: TypeAgentAction<any>,
            ): Promise<ActionResult | undefined> {
                console.log(
                    `[WebFlowAgent] executeAction: ${action.actionName}`,
                );
                const flow = agent.flowsByName.get(action.actionName);
                if (!flow) {
                    return {
                        entities: [],
                        displayContent: `Unknown action: ${action.actionName}`,
                    };
                }

                try {
                    const params = action.parameters ?? {};
                    const result =
                        (await agent.executeFlow(flow, params)) ?? {};

                    if (result.continuation) {
                        await agent.storeContinuation(
                            flow.name,
                            params,
                            result.continuation.step,
                            result.continuation.data ?? {},
                        );
                        console.log(
                            `[WebFlowAgent] Stored continuation: step=${result.continuation.step}`,
                        );
                    }

                    return {
                        entities: [],
                        displayContent: result.message ?? "Done",
                    };
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error);
                    console.error(
                        `[WebFlowAgent] Flow execution failed:`,
                        error,
                    );
                    return {
                        entities: [],
                        displayContent: `Error: ${msg}`,
                    };
                }
            },
        };
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

function buildSchemaFromFlows(flows: WebFlowDefinitionTransport[]): string {
    const types = flows.map((flow) => {
        const paramEntries = Object.entries(flow.parameters);
        const typeName = flow.name.charAt(0).toUpperCase() + flow.name.slice(1);

        if (paramEntries.length === 0) {
            return `// ${flow.description}\nexport type ${typeName} = {\n    actionName: "${flow.name}";\n};`;
        }

        const paramLines = paramEntries
            .map(([k, v]) => {
                const optional = v.required ? "" : "?";
                const comment =
                    v.valueOptions && v.valueOptions.length > 0
                        ? ` // Valid options: ${v.valueOptions.join(", ")}`
                        : "";
                return `        ${k}${optional}: ${v.type};${comment}`;
            })
            .join("\n");

        return `// ${flow.description}\nexport type ${typeName} = {\n    actionName: "${flow.name}";\n    parameters: {\n${paramLines}\n    };\n};`;
    });

    const unionMembers = flows
        .map((f) => f.name.charAt(0).toUpperCase() + f.name.slice(1))
        .join("\n    | ");

    return (
        types.join("\n\n") +
        `\n\nexport type DynamicUserPageActions =\n    | ${unionMembers};\n`
    );
}
