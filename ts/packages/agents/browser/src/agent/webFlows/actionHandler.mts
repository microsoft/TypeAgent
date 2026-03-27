// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext, getBrowserControl } from "../browserActions.mjs";
import { WebFlowStore } from "./store/webFlowStore.mjs";
import { WebFlowDefinition } from "./types.js";
import { WebFlowActions } from "./schema/webFlowActions.mjs";
import { validateWebFlowScript } from "./scriptValidator.mjs";
import { executeWebFlowScript } from "./scriptExecutor.mjs";
import {
    createFrozenBrowserApi,
    ExtractComponentFn,
} from "./webFlowBrowserApi.mjs";
import { WebFlowBrowserAPIImpl } from "./webFlowBrowserApi.mjs";
import { BrowserReasoningAgent } from "./reasoning/browserReasoningAgent.mjs";
import { BrowserReasoningTrace } from "./reasoning/browserReasoningTypes.mjs";
import { generateWebFlowFromTrace } from "./scriptGenerator.mjs";
import { normalizeRecording, RecordingData } from "./recordingNormalizer.mjs";
import { loadSampleFlows } from "./sampleFlowLoader.mjs";
import { sendWebFlowRefreshToClient } from "../browserActionHandler.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:webflows:handler");

let sampleFlowsRegistered = false;

export interface WebFlowActionResult {
    displayText: string;
    data?: unknown;
}

async function getStore(
    context: SessionContext<BrowserActionContext>,
): Promise<WebFlowStore> {
    if (context.agentContext.webFlowStore) {
        return context.agentContext.webFlowStore;
    }
    // Fallback: initialize on-demand if not set up during updateAgentContext
    const store = new WebFlowStore(context.instanceStorage);
    await store.initialize();
    context.agentContext.webFlowStore = store;
    debug("WebFlowStore initialized on-demand");
    return store;
}

export async function ensureSampleFlowsRegistered(
    store: WebFlowStore,
): Promise<void> {
    if (sampleFlowsRegistered) return;
    sampleFlowsRegistered = true;

    try {
        const samples = loadSampleFlows();
        let registered = 0;
        let upgraded = 0;

        for (const sample of samples) {
            const existing = await store.get(sample.name);
            if (!existing) {
                await store.save(sample);
                registered++;
            } else if (existing.source?.type === "discovered") {
                // Discovered flows have placeholder scripts — replace with
                // the real sample script while preserving any domain scope
                // the discovery added.
                const merged: WebFlowDefinition = {
                    ...sample,
                    scope:
                        existing.scope.type === "site"
                            ? existing.scope
                            : sample.scope,
                };
                await store.save(merged);
                upgraded++;
            }
        }

        if (registered > 0 || upgraded > 0) {
            debug(
                `Sample webFlows: ${registered} registered, ${upgraded} upgraded from discovered placeholders`,
            );
        }
    } catch (error) {
        debug("Failed to register sample flows:", error);
    }
}

function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    fallback: T,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
        promise,
        new Promise<T>((resolve) => {
            timer = setTimeout(() => resolve(fallback), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

function createExtractComponentFn(
    context: SessionContext<BrowserActionContext>,
): ExtractComponentFn | undefined {
    return async (componentDef, userRequest) => {
        const { createDiscoveryPageTranslator } = await import(
            "../discovery/translator.mjs"
        );
        const agent = await createDiscoveryPageTranslator("GPT_5_2");
        const browser = getBrowserControl(context.agentContext);
        const htmlFragments = await browser.getHtmlFragments();

        const screenshot = await withTimeout(
            browser.captureScreenshot().catch(() => ""),
            1_000,
            "",
        );
        debug(
            `extractComponent: screenshot ${screenshot ? "captured" : "skipped (timeout or error)"}`,
        );

        const screenshots = screenshot ? [screenshot] : [];
        const response = await agent.getPageComponentSchema(
            componentDef.typeName,
            userRequest,
            htmlFragments,
            screenshots,
        );

        if (!response.success) {
            throw new Error(
                `Failed to extract component ${componentDef.typeName}: ${response.message}`,
            );
        }

        return response.data;
    };
}

async function handleListWebFlows(
    action: WebFlowActions & { actionName: "listWebFlows" },
    context: SessionContext<BrowserActionContext>,
): Promise<WebFlowActionResult> {
    const store = await getStore(context);
    const scope = action.parameters?.scope ?? "all";

    if (scope === "site") {
        const browser = getBrowserControl(context.agentContext);
        const url = await browser.getPageUrl();
        const domain = new URL(url).hostname;
        const names = await store.listForDomain(domain);
        return {
            displayText:
                names.length > 0
                    ? `WebFlows for ${domain}:\n${names.map((n) => `  - ${n}`).join("\n")}`
                    : `No WebFlows found for ${domain}`,
            data: { flows: names, domain },
        };
    }

    const entries = await store.listAll();
    if (scope === "global") {
        const global = entries.filter((e) => e.scope.type === "global");
        return {
            displayText:
                global.length > 0
                    ? `Global WebFlows:\n${global.map((e) => `  - ${e.description}`).join("\n")}`
                    : "No global WebFlows found",
            data: { flows: global },
        };
    }

    return {
        displayText:
            entries.length > 0
                ? `All WebFlows (${entries.length}):\n${entries.map((e) => `  - ${e.description} [${e.scope.type}]`).join("\n")}`
                : "No WebFlows found",
        data: { flows: entries },
    };
}

async function handleDeleteWebFlow(
    action: WebFlowActions & { actionName: "deleteWebFlow" },
    context: SessionContext<BrowserActionContext>,
): Promise<WebFlowActionResult> {
    const store = await getStore(context);
    const { name } = action.parameters;
    const deleted = await store.delete(name);

    if (deleted) {
        debug(`Deleted WebFlow: ${name}`);
        sendWebFlowRefreshToClient(context);
        return {
            displayText: `WebFlow "${name}" deleted`,
            data: { success: true, name },
        };
    }

    return {
        displayText: `WebFlow "${name}" not found`,
        data: { success: false, name },
    };
}

async function handleEditWebFlowScope(
    action: WebFlowActions & { actionName: "editWebFlowScope" },
    context: SessionContext<BrowserActionContext>,
): Promise<WebFlowActionResult> {
    const store = await getStore(context);
    const { name, scopeType, domains } = action.parameters;

    const flow = await store.get(name);
    if (!flow) {
        return {
            displayText: `WebFlow "${name}" not found`,
            data: { success: false },
        };
    }

    flow.scope = {
        type: scopeType,
        ...(scopeType === "site" && domains && { domains }),
    };
    await store.save(flow);

    debug(`Updated scope for WebFlow "${name}" to ${scopeType}`);
    sendWebFlowRefreshToClient(context);

    return {
        displayText: `WebFlow "${name}" scope updated to ${scopeType}${domains ? ` (${domains.join(", ")})` : ""}`,
        data: { success: true, name, scope: flow.scope },
    };
}

async function handleDynamicFlowExecution(
    actionName: string,
    params: Record<string, unknown>,
    context: SessionContext<BrowserActionContext>,
): Promise<WebFlowActionResult> {
    const store = await getStore(context);
    const flow = await store.get(actionName);

    if (!flow) {
        return {
            displayText: `WebFlow "${actionName}" not found`,
            data: { success: false, error: "not_found" },
        };
    }

    const browser = getBrowserControl(context.agentContext);

    // Validate scope against current page
    if (flow.scope.type === "site" && flow.scope.domains?.length) {
        const url = await browser.getPageUrl();
        const currentDomain = new URL(url).hostname;
        const allowed = flow.scope.domains.some((d) =>
            currentDomain.endsWith(d),
        );
        if (!allowed) {
            return {
                displayText: `WebFlow "${actionName}" is scoped to ${flow.scope.domains.join(", ")} but current page is ${currentDomain}`,
                data: { success: false, error: "scope_mismatch" },
            };
        }
    }

    // Validate script
    const validation = validateWebFlowScript(
        flow.script,
        Object.keys(flow.parameters),
    );
    if (!validation.valid) {
        const errors = validation.errors
            .filter((e) => e.severity === "error")
            .map((e) => e.message);
        return {
            displayText: `WebFlow "${actionName}" has validation errors: ${errors.join("; ")}`,
            data: { success: false, error: "validation_failed", errors },
        };
    }

    // Fill in defaults for missing optional params
    const resolvedParams: Record<string, unknown> = {};
    for (const [key, paramDef] of Object.entries(flow.parameters)) {
        if (params[key] !== undefined) {
            resolvedParams[key] = params[key];
        } else if (paramDef.default !== undefined) {
            resolvedParams[key] = paramDef.default;
        } else if (paramDef.required) {
            return {
                displayText: `Missing required parameter "${key}" for WebFlow "${actionName}"`,
                data: { success: false, error: "missing_param", param: key },
            };
        }
    }

    debug(`Executing WebFlow "${actionName}" with params:`, resolvedParams);

    const extractFn = createExtractComponentFn(context);
    const browserApi = createFrozenBrowserApi(browser, flow.scope, extractFn);
    const result = await executeWebFlowScript(
        flow.script,
        browserApi,
        resolvedParams,
    );

    return {
        displayText: result.success
            ? (result.message ?? `WebFlow "${actionName}" completed`)
            : `WebFlow "${actionName}" failed: ${result.error}`,
        data: result,
    };
}

async function handleStartGoalDrivenTask(
    action: WebFlowActions & { actionName: "startGoalDrivenTask" },
    context: SessionContext<BrowserActionContext>,
): Promise<WebFlowActionResult> {
    const browser = getBrowserControl(context.agentContext);
    const { goal, startUrl, maxSteps } = action.parameters;

    const browserApi = new WebFlowBrowserAPIImpl(browser);
    const agent = new BrowserReasoningAgent(browserApi, {
        onThinking: (text) => debug(`[thinking] ${text.slice(0, 100)}...`),
        onToolCall: (tool, args) => debug(`[tool_call] ${tool}`),
        onText: (text) => debug(`[text] ${text.slice(0, 100)}...`),
    });

    debug(`Starting goal-driven task: "${goal}"`);
    const trace = await agent.executeGoal({
        goal,
        ...(startUrl && { startUrl }),
        maxSteps: maxSteps ?? 30,
    });

    // Save trace to instance storage for later script generation
    let traceId: string | undefined;
    if (context.instanceStorage && trace.result.success) {
        try {
            traceId = `trace-${Date.now()}`;
            await context.instanceStorage.write(
                `webflows/traces/${traceId}.json`,
                JSON.stringify(trace, null, 4),
            );
            debug(`Saved trace: ${traceId}`);
        } catch (error) {
            debug("Failed to save trace:", error);
        }
    }

    const stepSummary = trace.steps
        .map(
            (s) =>
                `  ${s.stepNumber}. ${s.action.tool}(${Object.values(s.action.args).join(", ")}) → ${s.result.success ? "ok" : "fail"}`,
        )
        .join("\n");

    return {
        displayText: trace.result.success
            ? `Goal completed in ${trace.steps.length} steps (${(trace.duration / 1000).toFixed(1)}s):\n${stepSummary}\n\nSummary: ${trace.result.summary}${traceId ? `\n\nTrace saved as: ${traceId}` : ""}`
            : `Goal failed after ${trace.steps.length} steps: ${trace.result.summary}`,
        data: { ...trace, traceId },
    };
}

async function handleGenerateWebFlow(
    action: WebFlowActions & { actionName: "generateWebFlow" },
    context: SessionContext<BrowserActionContext>,
): Promise<WebFlowActionResult> {
    const { traceId, name, description } = action.parameters;

    if (!context.instanceStorage) {
        return {
            displayText: "No instance storage available",
            data: { success: false },
        };
    }

    // Load trace from storage
    let trace: BrowserReasoningTrace;
    try {
        const traceJson = await context.instanceStorage.read(
            `webflows/traces/${traceId}.json`,
            "utf8",
        );
        trace = JSON.parse(traceJson);
    } catch {
        return {
            displayText: `Trace "${traceId}" not found`,
            data: { success: false, error: "trace_not_found" },
        };
    }

    debug(
        `Generating WebFlow from trace "${traceId}" (${trace.steps.length} steps)`,
    );

    // Build existing flows context for dedup-aware generation
    const store = await getStore(context);
    const existingFlows = store.getIndex().flows
        ? Object.entries(store.getIndex().flows).map(([n, e]) => ({
              name: n,
              description: e.description,
              parameters: (e.parameters ?? []).map((p) => p.name),
          }))
        : [];

    const flow = await generateWebFlowFromTrace(
        trace,
        {
            ...(name && { suggestedName: name }),
            ...(description && { description }),
        },
        existingFlows,
    );

    if (!flow) {
        return {
            displayText:
                "Failed to generate WebFlow from trace. The LLM could not produce a valid script.",
            data: { success: false, error: "generation_failed" },
        };
    }

    // Save the generated flow (store already fetched above for dedup context)
    await store.save(flow);
    debug(`Saved generated WebFlow: ${flow.name}`);

    sendWebFlowRefreshToClient(context);

    return {
        displayText: `WebFlow "${flow.name}" generated and saved.\n  Parameters: ${Object.keys(flow.parameters).join(", ") || "none"}\n  Scope: ${flow.scope.type}${flow.scope.domains ? ` (${flow.scope.domains.join(", ")})` : ""}\n  Grammar patterns: ${flow.grammarPatterns.length}`,
        data: { success: true, flow },
    };
}

async function handleGenerateWebFlowFromRecording(
    action: WebFlowActions & { actionName: "generateWebFlowFromRecording" },
    context: SessionContext<BrowserActionContext>,
): Promise<WebFlowActionResult> {
    const { description, name } = action.parameters;
    const browser = getBrowserControl(context.agentContext);

    // Get recording data from the macros store or session storage
    // The recording data is typically stored in session storage after recording stops
    if (!context.sessionStorage) {
        return {
            displayText: "No session storage available for recordings",
            data: { success: false },
        };
    }

    let recordingData: RecordingData;
    try {
        const rawJson = await context.sessionStorage.read(
            "recording/latest.json",
            "utf8",
        );
        const raw = JSON.parse(rawJson);
        recordingData = {
            actions: raw.recordedActions ?? raw.actions ?? [],
            pageHtml: raw.recordedActionPageHTML ?? raw.pageHtml,
            screenshots: raw.annotatedScreenshot ?? raw.screenshots,
            startUrl: raw.startUrl ?? (await browser.getPageUrl()),
            description,
        };
    } catch {
        return {
            displayText:
                "No recording data found. Record a user interaction first.",
            data: { success: false, error: "no_recording" },
        };
    }

    if (recordingData.actions.length === 0) {
        return {
            displayText: "Recording is empty — no actions were captured.",
            data: { success: false, error: "empty_recording" },
        };
    }

    // Filter noop recordings (fewer than 2 meaningful actions)
    const meaningfulActions = recordingData.actions.filter(
        (a: any) =>
            a.type !== "scroll" &&
            a.type !== "pageLoad" &&
            a.type !== "navigation",
    );
    if (meaningfulActions.length < 2) {
        return {
            displayText:
                "Recording too short — fewer than 2 meaningful actions captured. Try recording a more complete interaction.",
            data: { success: false, error: "noop_recording" },
        };
    }

    debug(`Normalizing recording: ${recordingData.actions.length} raw actions`);
    const trace = normalizeRecording(recordingData);

    // Save the normalized trace
    let traceId: string | undefined;
    if (context.instanceStorage) {
        try {
            traceId = `recording-${Date.now()}`;
            await context.instanceStorage.write(
                `webflows/traces/${traceId}.json`,
                JSON.stringify(trace, null, 4),
            );
        } catch (error) {
            debug("Failed to save recording trace:", error);
        }
    }

    debug(
        `Generating WebFlow from recording (${trace.steps.length} normalized steps)`,
    );

    // Build existing flows context for dedup-aware generation
    const store = await getStore(context);
    const existingFlows = Object.entries(store.getIndex().flows).map(
        ([n, e]) => ({
            name: n,
            description: e.description,
            parameters: (e.parameters ?? []).map((p) => p.name),
        }),
    );

    const flow = await generateWebFlowFromTrace(
        trace,
        {
            ...(name && { suggestedName: name }),
            description,
        },
        existingFlows,
    );

    if (!flow) {
        return {
            displayText:
                "Failed to generate WebFlow from recording. The LLM could not produce a valid script.",
            data: { success: false, error: "generation_failed", traceId },
        };
    }

    // Override source type to recording
    flow.source = {
        type: "recording",
        timestamp: new Date().toISOString(),
        ...(traceId && { traceId }),
    };

    await store.save(flow);
    debug(`Saved WebFlow from recording: ${flow.name}`);

    sendWebFlowRefreshToClient(context);

    return {
        displayText: `WebFlow "${flow.name}" generated from recording and saved.\n  Parameters: ${Object.keys(flow.parameters).join(", ") || "none"}\n  Scope: ${flow.scope.type}${flow.scope.domains ? ` (${flow.scope.domains.join(", ")})` : ""}\n  Grammar patterns: ${flow.grammarPatterns.length}`,
        data: { success: true, flow, traceId },
    };
}

export async function handleWebFlowAction(
    action: { actionName: string; parameters?: Record<string, unknown> },
    context: SessionContext<BrowserActionContext>,
): Promise<WebFlowActionResult> {
    const store = await getStore(context);
    await ensureSampleFlowsRegistered(store);

    switch (action.actionName) {
        case "listWebFlows":
            return handleListWebFlows(
                action as WebFlowActions & { actionName: "listWebFlows" },
                context,
            );
        case "deleteWebFlow":
            return handleDeleteWebFlow(
                action as WebFlowActions & { actionName: "deleteWebFlow" },
                context,
            );
        case "editWebFlowScope":
            return handleEditWebFlowScope(
                action as WebFlowActions & { actionName: "editWebFlowScope" },
                context,
            );
        case "startGoalDrivenTask":
            return handleStartGoalDrivenTask(
                action as WebFlowActions & {
                    actionName: "startGoalDrivenTask";
                },
                context,
            );
        case "generateWebFlow":
            return handleGenerateWebFlow(
                action as WebFlowActions & {
                    actionName: "generateWebFlow";
                },
                context,
            );
        case "generateWebFlowFromRecording":
            return handleGenerateWebFlowFromRecording(
                action as WebFlowActions & {
                    actionName: "generateWebFlowFromRecording";
                },
                context,
            );
        default:
            return handleDynamicFlowExecution(
                action.actionName,
                action.parameters ?? {},
                context,
            );
    }
}

export function getWebFlowStore(
    context: SessionContext<BrowserActionContext>,
): Promise<WebFlowStore> {
    return getStore(context);
}
