// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    SessionContext,
    DisplayContent,
    DisplayAppendMode,
} from "@typeagent/agent-sdk";
import {
    BrowserActionContext,
    getBrowserControl,
    getCurrentPageScreenshot,
} from "../browserActions.mjs";
import { BrowserControl } from "../../common/browserControl.mjs";
import {
    createDiscoveryPageTranslator,
    SchemaDiscoveryAgent,
} from "./translator.mjs";
import {
    ActionSchemaTypeDefinition,
    ActionSchemaObject,
    ActionParamType,
    generateActionSchema,
} from "@typeagent/action-schema";
import { SchemaCreator as sc } from "@typeagent/action-schema";
import {
    SchemaDiscoveryActions,
    CreateWebFlowFromRecording,
    GetWebFlowsForDomain,
    GetAllWebFlows,
    DeleteWebFlow,
    InferActions,
    CreateInferredFlows,
    InferredAction,
    InferActionsResult,
} from "./schema/discoveryActions.mjs";
import registerDebug from "debug";
import { WebFlowDefinition } from "../webFlows/types.js";
import {
    normalizeRecording,
    RecordingData,
} from "../webFlows/recordingNormalizer.mjs";
import {
    generateWebFlowFromTrace,
    ScriptGenerationOptions,
} from "../webFlows/scriptGenerator.mjs";
import { sendWebFlowRefreshToClient } from "../browserActionHandler.mjs";
import { BrowserReasoningAgent } from "../webFlows/reasoning/browserReasoningAgent.mjs";
import { WebFlowBrowserAPIImpl } from "../webFlows/webFlowBrowserApi.mjs";
import { createComponentExtractor } from "../webFlows/componentExtractor.mjs";
import { getWebFlowStore } from "../webFlows/actionHandler.mjs";
import { testGeneratedScript } from "../webFlows/webFlowTestRunner.mjs";

const debug = registerDebug("typeagent:browser:discover:handler");
const debugPerf = registerDebug("typeagent:browser:discover:perf");

// Entity collection infrastructure for discovery actions
export interface EntityInfo {
    name: string;
    type: string[];
    metadata?: Record<string, any>;
}

export interface DiscoveryActionResult {
    displayText: string;
    entities: EntityInfo[];
    data?: any;
    additionalInstructions?: string[];
}

export class EntityCollector {
    private entities: EntityInfo[] = [];

    addEntity(name: string, types: string[], metadata?: any): void {
        const existing = this.entities.find((e) => e.name === name);
        if (existing) {
            existing.type = [...new Set([...existing.type, ...types])];
            existing.metadata = { ...existing.metadata, ...metadata };
        } else {
            this.entities.push({ name, type: types, metadata });
        }
    }

    getEntities(): EntityInfo[] {
        return [...this.entities];
    }

    clear(): void {
        this.entities = [];
    }
}

// Simplified action IO interface for progress reporting
interface ProgressActionIO {
    appendDisplay: (content: DisplayContent, mode?: DisplayAppendMode) => void;
}

// Context interface for discovery action handler functions
interface DiscoveryActionHandlerContext {
    browser: BrowserControl;
    agent: SchemaDiscoveryAgent<SchemaDiscoveryActions>;
    entities: EntityCollector;
    sessionContext: SessionContext<BrowserActionContext>;
    progressCallback?: (message: string) => void;
    actionIO?: ProgressActionIO;
}

// ── Discovery cache ─────────────────────────────────────────────────────────
//
// Shared by auto-discovery (on navigation) and manual discovery (context menu).
// Two-tier lookup with a TTL:
//
//   1. Exact URL match (O(1) map lookup)
//   2. Pattern match — the LLM can return a urlPattern regex indicating that
//      pages with similar URLs share the same available actions. For example,
//      all Amazon product pages (https://www.amazon.com/dp/...) have the same
//      action set regardless of product ID. On a cache miss for the exact URL,
//      we iterate pattern entries and test each regex against the current URL.
//
// When auto-discovery runs on navigation, it populates the cache. When the
// user triggers "Discover page macros", the cache is checked first to avoid
// a redundant LLM call.

interface DiscoveryCacheEntry {
    flows: WebFlowDefinition[];
    mode: "scope" | "content" | "scope-fallback";
    timestamp: number;
    urlPattern?: string | undefined; // Regex matching URLs with the same available actions
}

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const discoveryCache = new Map<string, DiscoveryCacheEntry>();

// Separate index for pattern-based entries, keyed by the original URL that
// produced the pattern. Patterns are tested in insertion order.
const patternEntries: DiscoveryCacheEntry[] = [];

function isExpired(entry: DiscoveryCacheEntry): boolean {
    return Date.now() - entry.timestamp > DISCOVERY_CACHE_TTL_MS;
}

function testUrlPattern(pattern: string, url: string): boolean {
    try {
        return new RegExp(pattern).test(url);
    } catch {
        debug(`Invalid urlPattern regex: ${pattern}`);
        return false;
    }
}

function getCachedDiscovery(url: string): DiscoveryCacheEntry | undefined {
    // 1. Exact URL match
    const exact = discoveryCache.get(url);
    if (exact) {
        if (isExpired(exact)) {
            discoveryCache.delete(url);
        } else {
            return exact;
        }
    }

    // 2. Pattern match — check entries that have a urlPattern regex
    for (let i = patternEntries.length - 1; i >= 0; i--) {
        const entry = patternEntries[i];
        if (isExpired(entry)) {
            patternEntries.splice(i, 1);
            continue;
        }
        if (entry.urlPattern && testUrlPattern(entry.urlPattern, url)) {
            debug(
                `Discovery cache pattern hit: ${entry.urlPattern} matched ${url}`,
            );
            return entry;
        }
    }

    return undefined;
}

function setCachedDiscovery(
    url: string,
    flows: WebFlowDefinition[],
    mode: "scope" | "content" | "scope-fallback",
    urlPattern?: string,
): void {
    const entry: DiscoveryCacheEntry = {
        flows,
        mode,
        timestamp: Date.now(),
        urlPattern,
    };

    discoveryCache.set(url, entry);

    if (urlPattern) {
        patternEntries.push(entry);
    }

    // Evict expired entries periodically
    if (discoveryCache.size > 100) {
        const now = Date.now();
        for (const [key, e] of discoveryCache) {
            if (now - e.timestamp > DISCOVERY_CACHE_TTL_MS) {
                discoveryCache.delete(key);
            }
        }
    }
}

// ── Discovery handlers ──────────────────────────────────────────────────────

async function handleFindUserActions(
    action: any,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const url = await getBrowserControl(
        ctx.sessionContext.agentContext,
    ).getPageUrl();

    // Check cache first — auto-discovery may have already computed this
    if (url) {
        const cached = getCachedDiscovery(url);
        if (cached) {
            debug(
                `Discovery cache hit for ${url}: ${cached.flows.length} flows (mode: ${cached.mode})`,
            );
            return {
                displayText: `Found ${cached.flows.length} applicable actions (cached)`,
                entities: ctx.entities.getEntities(),
                data: { actions: cached.flows, cached: true },
            };
        }
    }

    // Get existing WebFlows for this domain
    const webFlowStore = ctx.sessionContext.agentContext.webFlowStore;
    let candidateFlows: WebFlowDefinition[] = [];
    if (webFlowStore && url) {
        try {
            const domain = new URL(url).hostname;
            candidateFlows =
                await webFlowStore.listForDomainWithDetails(domain);
        } catch {
            // URL parsing failed
        }
    }

    if (candidateFlows.length === 0) {
        return {
            displayText:
                "No actions configured. Record a new action to get started.",
            entities: ctx.entities.getEntities(),
            data: { actions: [] },
        };
    }

    // Build a TypeScript schema from the candidate WebFlows for TypeChat
    const discoverySchema = generateDiscoverySchema(candidateFlows);
    const totalStart = Date.now();

    const htmlStart = Date.now();
    const htmlFragments = await ctx.browser.getHtmlFragments();
    const totalChars = htmlFragments.reduce(
        (sum: number, f: any) => sum + (f.content?.length || 0),
        0,
    );
    debugPerf(
        `getHtmlFragments: ${Date.now() - htmlStart}ms, ${htmlFragments.length} fragments, ${totalChars} chars`,
    );

    const candidateStart = Date.now();
    const response = await ctx.agent.getCandidateUserActions(
        discoverySchema,
        htmlFragments,
    );
    debugPerf(
        `getCandidateUserActions LLM: ${Date.now() - candidateStart}ms, success=${response.success}`,
    );
    debugPerf(`handleFindUserActions total: ${Date.now() - totalStart}ms`);

    if (!response.success) {
        debug("Discovery LLM call failed: %s", response.message);
        return {
            displayText: "Action could not be completed",
            entities: ctx.entities.getEntities(),
        };
    }

    // The LLM returns a CandidateActionList with the subset of flows
    // that actually apply to this page, plus an optional urlPattern.
    const selected = response.data as {
        actions: { actionName: string }[];
        urlPattern?: string;
    };
    const selectedNames = new Set(selected.actions.map((a) => a.actionName));

    // Filter the full WebFlowDefinitions to only those the LLM selected
    const applicableFlows = candidateFlows.filter((f) =>
        selectedNames.has(f.name),
    );

    // Cache the result for this URL (with optional pattern for similar URLs)
    if (url) {
        setCachedDiscovery(
            url,
            applicableFlows,
            "content",
            selected.urlPattern,
        );
        if (selected.urlPattern) {
            debug(`Discovery urlPattern: ${selected.urlPattern}`);
        }
    }

    debug(
        `Discovery: ${candidateFlows.length} candidates → ${applicableFlows.length} applicable to page`,
    );

    return {
        displayText: `Found ${applicableFlows.length} applicable actions`,
        entities: ctx.entities.getEntities(),
        data: { actions: applicableFlows },
    };
}

async function handleAutoDiscoverActions(
    action: any,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const url = action.parameters?.url;
    const domain = action.parameters?.domain;
    const mode = action.parameters?.mode ?? "content";

    const webFlowStore = ctx.sessionContext.agentContext.webFlowStore;
    if (!webFlowStore || !domain) {
        return {
            displayText: "No web flow store available",
            entities: [],
            data: { actions: [], flowCount: 0 },
        };
    }

    // Check cache first
    if (url) {
        const cached = getCachedDiscovery(url);
        if (cached) {
            debug(
                `Auto-discovery cache hit for ${url}: ${cached.flows.length} flows`,
            );
            return {
                displayText: `Found ${cached.flows.length} actions for ${domain} (cached)`,
                entities: [],
                data: {
                    actions: cached.flows,
                    flowCount: cached.flows.length,
                    mode: cached.mode,
                    cached: true,
                },
            };
        }
    }

    // Layer 1: Scope-based discovery — fast domain matching
    const scopedFlows = await webFlowStore.listForDomainWithDetails(domain);

    if (mode === "scope" || scopedFlows.length === 0) {
        debug(
            `Auto-discovery (scope): ${scopedFlows.length} flows for ${domain}`,
        );
        if (url) {
            setCachedDiscovery(url, scopedFlows, "scope");
        }
        return {
            displayText: `Found ${scopedFlows.length} actions for ${domain}`,
            entities: [],
            data: {
                actions: scopedFlows,
                flowCount: scopedFlows.length,
                mode: "scope",
            },
        };
    }

    // Layer 2: Content-based discovery — LLM filters to applicable flows
    const discoverySchema = generateDiscoverySchema(scopedFlows);
    const htmlFragments = await ctx.browser.getHtmlFragments();

    const response = await ctx.agent.getCandidateUserActions(
        discoverySchema,
        htmlFragments,
    );

    if (!response.success) {
        debug("Auto-discovery LLM call failed, falling back to scope results");
        if (url) {
            setCachedDiscovery(url, scopedFlows, "scope-fallback");
        }
        return {
            displayText: `Found ${scopedFlows.length} actions for ${domain}`,
            entities: [],
            data: {
                actions: scopedFlows,
                flowCount: scopedFlows.length,
                mode: "scope-fallback",
            },
        };
    }

    const selected = response.data as {
        actions: { actionName: string }[];
        urlPattern?: string;
    };
    const selectedNames = new Set(selected.actions.map((a) => a.actionName));
    const applicableFlows = scopedFlows.filter((f) =>
        selectedNames.has(f.name),
    );

    // Cache the content-based result (with optional pattern for similar URLs)
    if (url) {
        setCachedDiscovery(
            url,
            applicableFlows,
            "content",
            selected.urlPattern,
        );
        if (selected.urlPattern) {
            debug(`Auto-discovery urlPattern: ${selected.urlPattern}`);
        }
    }

    debug(
        `Auto-discovery (content): ${scopedFlows.length} scoped → ${applicableFlows.length} applicable for ${domain}`,
    );

    return {
        displayText: `Found ${applicableFlows.length} applicable actions for ${domain}`,
        entities: [],
        data: {
            actions: applicableFlows,
            flowCount: applicableFlows.length,
            mode: "content",
        },
    };
}

export function generateDiscoverySchema(flows: WebFlowDefinition[]): string {
    const typeNames: string[] = [];
    const typeDefs: string[] = [];

    for (const flow of flows) {
        const typeName = capitalize(flow.name);
        typeNames.push(typeName);

        const paramFields: string[] = [];
        for (const [name, param] of Object.entries(flow.parameters)) {
            const tsType =
                param.type === "number"
                    ? "number"
                    : param.type === "boolean"
                      ? "boolean"
                      : "string";
            const optional = param.required ? "" : "?";
            const comment = param.description ? ` // ${param.description}` : "";
            paramFields.push(
                `        ${name}${optional}: ${tsType};${comment}`,
            );
        }

        const description = flow.description ? `// ${flow.description}\n` : "";
        const paramsBlock =
            paramFields.length > 0
                ? `    parameters: {\n${paramFields.join("\n")}\n    };`
                : "";

        typeDefs.push(
            `${description}export type ${typeName} = {\n` +
                `    actionName: "${flow.name}";\n` +
                (paramsBlock ? `${paramsBlock}\n` : "") +
                `};`,
        );
    }

    const unionMembers = typeNames.join("\n    | ");
    const union =
        typeNames.length > 0
            ? `export type CandidateActions = \n    | ${unionMembers};`
            : `export type CandidateActions = never;`;

    return (
        typeDefs.join("\n\n") +
        "\n\n" +
        union +
        "\n\n" +
        `export type CandidateActionList = {\n` +
        `    actions: CandidateActions[];\n` +
        `    // If other pages on this site with different URLs would have the same\n` +
        `    // set of available actions (e.g. all product detail pages), provide a\n` +
        `    // regex that matches those URLs. This avoids re-analyzing similar pages.\n` +
        `    // Example: "https://www\\\\.amazon\\\\.com/dp/[A-Z0-9]+" for Amazon product pages.\n` +
        `    // Omit if the actions are specific to this exact URL.\n` +
        `    urlPattern?: string;\n` +
        `};`
    );
}

function capitalize(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1);
}

async function handleGetPageSummary(
    action: any,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const htmlFragments = await ctx.browser.getHtmlFragments();
    let screenshot = "";
    try {
        screenshot = await getCurrentPageScreenshot(ctx.browser);
    } catch (error) {
        console.warn(
            "Screenshot capture failed, continuing without screenshot:",
            (error as Error)?.message,
        );
    }

    // Only include screenshot if it's not empty
    const screenshots = screenshot ? [screenshot] : [];

    const timerName = `Summarizing page`;
    console.time(timerName);
    const response = await ctx.agent.getPageSummary(
        undefined,
        htmlFragments,
        screenshots,
    );

    if (!response.success) {
        console.error("Attempt to get page summary failed");
        console.error(response.message);
        return {
            displayText: "Action could not be completed",
            entities: ctx.entities.getEntities(),
        };
    }

    console.timeEnd(timerName);
    return {
        displayText:
            "Page summary: \n" + JSON.stringify(response.data, null, 2),
        entities: ctx.entities.getEntities(),
        data: response.data,
    };
}

async function handleRegisterSiteSchema(
    action: any,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const url = await getBrowserControl(
        ctx.sessionContext.agentContext,
    ).getPageUrl();

    const webFlowStore = ctx.sessionContext.agentContext.webFlowStore;
    if (!webFlowStore) {
        throw new Error(
            "WebFlowStore not available - please ensure TypeAgent server is running",
        );
    }

    debug("Building schema from WebFlowStore");
    const domain = new URL(url!).hostname;
    const eligibleFlows = await webFlowStore.listForDomain(domain);
    const typeDefinitions: ActionSchemaTypeDefinition[] = [];

    for (const flowName of eligibleFlows) {
        const flow = await webFlowStore.get(flowName);
        if (!flow) continue;

        const paramFields: Map<string, any> = new Map();
        for (const [k, v] of Object.entries(flow.parameters)) {
            let paramType: ActionParamType = sc.string();
            if (v.type === "number") paramType = sc.number();
            if (v.type === "boolean") paramType = sc.number();
            if (v.required) {
                paramFields.set(k, sc.field(paramType, v.description));
            } else {
                paramFields.set(k, sc.optional(paramType, v.description));
            }
        }
        const obj: ActionSchemaObject = sc.obj({
            actionName: sc.string(flow.name),
            parameters: sc.obj(Object.fromEntries(paramFields)),
        } as const);
        const typeDef = sc.type(
            capitalize(flow.name),
            obj,
            flow.description,
            true,
        );
        typeDefinitions.push(typeDef);
    }

    if (typeDefinitions.length === 0) {
        debug("No actions for this schema.");
        return {
            displayText: "No actions available for schema",
            entities: ctx.entities.getEntities(),
        };
    }

    const union = sc.union(
        typeDefinitions.map((definition) => sc.ref(definition)),
    );
    const entry = sc.type("DynamicUserPageActions", union);
    entry.exported = true;
    const actionSchemas = new Map<string, ActionSchemaTypeDefinition>();
    const order = new Map<string, number>();
    const schema = await generateActionSchema(
        { entry, actionSchemas, order },
        { exact: true },
    );

    // Tell the browser-side WebFlowAgent to re-fetch and register
    sendWebFlowRefreshToClient(ctx.sessionContext);

    return {
        displayText: "Schema registered successfully",
        entities: ctx.entities.getEntities(),
        data: { schema: schema, typeDefinitions: typeDefinitions },
    };
}

async function handleCreateWebFlowFromRecording(
    action: CreateWebFlowFromRecording,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const webFlowStore = ctx.sessionContext.agentContext.webFlowStore;
    if (!webFlowStore) {
        throw new Error("WebFlowStore not available");
    }

    const rawSteps = JSON.parse(action.parameters.recordedSteps || "[]");
    const url = action.parameters.startUrl;

    const recordingForNorm: RecordingData = {
        actions: rawSteps,
        startUrl: url,
        description: action.parameters.actionDescription,
    };

    const trace = normalizeRecording(recordingForNorm);
    debug(
        `WebFlow from recording: normalized ${rawSteps.length} raw steps → ${trace.steps.length} trace steps`,
    );

    const pageHtml = action.parameters.fragments
        ?.map((f) => f.content)
        .filter(Boolean);

    const genOptions: ScriptGenerationOptions = {
        suggestedName: action.parameters.actionName,
        description: action.parameters.actionDescription,
    };
    if (pageHtml && pageHtml.length > 0) {
        genOptions.pageHtml = pageHtml;
    }

    const flow = await generateWebFlowFromTrace(trace, genOptions);

    if (!flow) {
        return {
            displayText: "Failed to generate action from recording",
            entities: ctx.entities.getEntities(),
            data: { success: false },
        };
    }

    flow.source = { type: "recording", timestamp: new Date().toISOString() };

    await webFlowStore.save(flow);
    debug(`Saved webFlow from recording: ${flow.name}`);

    sendWebFlowRefreshToClient(ctx.sessionContext);

    // Reload the agent schema so the dispatcher picks up the new grammar patterns
    try {
        await ctx.sessionContext.reloadAgentSchema();
        debug("Reloaded agent schema after WebFlow recording");
    } catch (err) {
        debug("Failed to reload agent schema:", err);
    }

    return {
        displayText: `Created action: ${flow.name}`,
        entities: ctx.entities.getEntities(),
        data: {
            success: true,
            webFlowName: flow.name,
            script: flow.script,
            parameters: flow.parameters,
            description: flow.description,
            grammarPatterns: flow.grammarPatterns,
        },
    };
}

async function handleGetWebFlowsForDomain(
    action: GetWebFlowsForDomain,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const webFlowStore = ctx.sessionContext.agentContext.webFlowStore;
    if (!webFlowStore) {
        throw new Error("WebFlowStore not available");
    }

    const flows = await webFlowStore.listForDomainWithDetails(
        action.parameters.domain,
    );

    return {
        displayText: `Found ${flows.length} actions`,
        entities: ctx.entities.getEntities(),
        data: {
            actions: flows.map((f) => ({
                name: f.name,
                description: f.description,
                parameters: f.parameters,
                script: f.script,
                source: f.source,
                scope: f.scope,
            })),
        },
    };
}

async function handleGetAllWebFlows(
    action: GetAllWebFlows,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const webFlowStore = ctx.sessionContext.agentContext.webFlowStore;
    if (!webFlowStore) {
        throw new Error("WebFlowStore not available");
    }

    const flows = await webFlowStore.listAllWithDetails();

    return {
        displayText: `Found ${flows.length} actions`,
        entities: ctx.entities.getEntities(),
        data: {
            actions: flows.map((f) => ({
                name: f.name,
                description: f.description,
                parameters: f.parameters,
                script: f.script,
                source: f.source,
                scope: f.scope,
            })),
        },
    };
}

async function handleDeleteWebFlow(
    action: DeleteWebFlow,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const webFlowStore = ctx.sessionContext.agentContext.webFlowStore;
    if (!webFlowStore) {
        throw new Error("WebFlowStore not available");
    }

    const deleted = await webFlowStore.delete(action.parameters.name);

    if (deleted) {
        debug(`Deleted webFlow: ${action.parameters.name}`);
        sendWebFlowRefreshToClient(ctx.sessionContext);
    }

    return {
        displayText: deleted
            ? "Action deleted successfully"
            : "Action not found",
        entities: ctx.entities.getEntities(),
        data: {
            success: deleted,
            name: action.parameters.name,
        },
    };
}

// ── Infer Actions ────────────────────────────────────────────────────────────

async function handleInferActions(
    action: InferActions,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const pageUrl = await ctx.browser.getPageUrl();
    const htmlFragments = await ctx.browser.getHtmlFragments();
    const domain = new URL(pageUrl).hostname;

    debug(`Inferring actions for page: ${pageUrl}`);

    const store = await getWebFlowStore(ctx.sessionContext);
    const index = store.getIndex();
    const existingFlows = index.flows
        ? Object.entries(index.flows).map(([name, entry]) => ({
              name,
              description: entry.description || "",
              scope: entry.scope,
          }))
        : [];
    const domainFlows = existingFlows.filter(
        (f) => f.scope.type === "global" || f.scope.domains?.includes(domain),
    );

    const inferredActions = await inferActionsFromHtml(
        htmlFragments,
        pageUrl,
        ctx.agent,
    );

    const existingActions: InferActionsResult["existingActions"] = [];
    const newActions: InferredAction[] = [];

    for (const inferredAction of inferredActions) {
        const normalizedName = inferredAction.name.toLowerCase();
        const matchingFlow = domainFlows.find(
            (f) =>
                f.name.toLowerCase() === normalizedName ||
                f.description
                    .toLowerCase()
                    .includes(
                        inferredAction.description.toLowerCase().slice(0, 30),
                    ),
        );

        if (matchingFlow) {
            existingActions.push({
                name: matchingFlow.name,
                description: matchingFlow.description,
                flowId: matchingFlow.name,
            });
        } else {
            newActions.push(inferredAction);
        }
    }

    let displayText = `I analyzed this page and found ${inferredActions.length} possible actions:\n\n`;

    let displayIndex = 1;
    for (const existingAction of existingActions) {
        displayText += `${displayIndex}. ${existingAction.name} - Already available ✓\n`;
        displayIndex++;
    }
    for (const newAction of newActions) {
        displayText += `${displayIndex}. ${newAction.name} - ${newAction.description} [NEW]\n`;
        displayIndex++;
    }

    if (newActions.length === 0) {
        displayText += `\nAll identified actions already have WebFlows!`;
    } else {
        displayText += `\n\n\nTo create WebFlows, run: \`@browser actions create <numbers>\`\nExamples: \`@browser actions create 1\` or \`@browser actions create 1,2\` or \`@browser actions create all\``;
    }

    ctx.entities.addEntity("inferredActions", ["InferredActions"], {
        existingActions,
        newActions,
        pageUrl,
    });

    return {
        displayText,
        entities: ctx.entities.getEntities(),
        data: {
            existingActions,
            newActions,
            pageUrl,
        } as InferActionsResult,
    };
}

async function inferActionsFromHtml(
    htmlFragments: any[],
    pageUrl: string,
    agent: any,
): Promise<InferredAction[]> {
    try {
        const result = await agent.inferPageActions(pageUrl, htmlFragments);
        if (result.success && result.data?.actions) {
            return result.data.actions as InferredAction[];
        }
    } catch (error) {
        debug("Error inferring actions from HTML:", error);
    }

    return [];
}

/**
 * Reports progress to the user using the best available mechanism.
 * Prefers actionIO.appendDisplay for immediate UI updates, falls back to progressCallback.
 */
function reportProgress(
    ctx: DiscoveryActionHandlerContext,
    message: string,
): void {
    if (ctx.actionIO) {
        ctx.actionIO.appendDisplay(message, "temporary");
    } else if (ctx.progressCallback) {
        ctx.progressCallback(message);
    }
}

async function handleCreateInferredFlows(
    action: CreateInferredFlows,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const { selectedIndices, inferredActions } = action.parameters;

    if (!inferredActions || inferredActions.length === 0) {
        return {
            displayText:
                "No actions to create. Please run infer actions first.",
            entities: ctx.entities.getEntities(),
        };
    }

    const store = await getWebFlowStore(ctx.sessionContext);
    const pageUrl = await ctx.browser.getPageUrl();
    const domain = new URL(pageUrl).hostname;

    const createdFlows: string[] = [];
    const failedFlows: string[] = [];

    const totalActions = selectedIndices.length;
    let processedCount = 0;

    for (const idx of selectedIndices) {
        const inferredAction = inferredActions[idx - 1];
        if (!inferredAction) continue;

        processedCount++;
        const progressMsg = `[${processedCount}/${totalActions}] Processing: ${inferredAction.name}`;
        debug(progressMsg);
        reportProgress(ctx, progressMsg);

        try {
            // Build enriched goal from the inferred action
            const goal = buildGoalFromInferredAction(inferredAction, pageUrl);
            debug(`Goal for ${inferredAction.name}: ${goal.slice(0, 200)}...`);

            // Create browser API with extraction function and reasoning agent with unified tools
            const extractFn = createComponentExtractor(ctx.browser);
            const browserApi = new WebFlowBrowserAPIImpl(
                ctx.browser,
                undefined,
                extractFn,
            );
            const agent = BrowserReasoningAgent.withUnifiedTools(browserApi, {
                onThinking: (text) =>
                    debug(
                        `[${inferredAction.name}] thinking: ${text.slice(0, 100)}...`,
                    ),
                onToolCall: (tool, args) => {
                    debug(`[${inferredAction.name}] tool: ${tool}`);
                    // Report browser tool calls to user for visibility
                    const toolDisplay = formatToolCallForDisplay(tool, args);
                    if (toolDisplay) {
                        reportProgress(ctx, toolDisplay);
                    }
                },
                onText: (text) =>
                    debug(
                        `[${inferredAction.name}] text: ${text.slice(0, 100)}...`,
                    ),
            });

            // Execute the goal using the reasoning agent
            debug(`Executing goal for ${inferredAction.name}...`);
            reportProgress(
                ctx,
                `Running automation for: ${inferredAction.name}...`,
            );
            const trace = await agent.executeGoal({
                goal,
                startUrl: pageUrl,
                maxSteps: 50, // Higher limit for complex multi-field forms
            });

            if (trace.result.success) {
                debug(
                    `Goal succeeded for ${inferredAction.name}, generating WebFlow from trace...`,
                );
                reportProgress(
                    ctx,
                    `Generating WebFlow script for: ${inferredAction.name}...`,
                );

                // Build existing flows context for dedup-aware generation
                const existingFlows = store.getIndex().flows
                    ? Object.entries(store.getIndex().flows).map(([n, e]) => ({
                          name: n,
                          description: e.description,
                          parameters: (e.parameters ?? []).map((p) => p.name),
                      }))
                    : [];

                // Generate WebFlow from the trace
                const generatedFlow = await generateWebFlowFromTrace(
                    trace,
                    {
                        suggestedName: inferredAction.name,
                        description: inferredAction.description,
                    },
                    existingFlows,
                );

                if (generatedFlow) {
                    // Enhance with inferred parameters that may not have been detected
                    for (const param of inferredAction.parameters) {
                        if (!generatedFlow.parameters[param.name]) {
                            generatedFlow.parameters[param.name] = {
                                type: param.type,
                                required: param.required,
                                description: param.description,
                            };
                        }
                    }

                    // Ensure grammar patterns exist
                    if (
                        !generatedFlow.grammarPatterns ||
                        generatedFlow.grammarPatterns.length === 0
                    ) {
                        generatedFlow.grammarPatterns =
                            generateGrammarPatterns(inferredAction);
                    }

                    // Set scope to site-specific
                    generatedFlow.scope = {
                        type: "site",
                        domains: [domain],
                    };

                    // Update source info
                    generatedFlow.source = {
                        type: "discovered",
                        timestamp: new Date().toISOString(),
                        originUrl: pageUrl,
                    };

                    // Test the generated script before saving
                    reportProgress(
                        ctx,
                        `Testing WebFlow script for: ${inferredAction.name}...`,
                    );
                    const testParams: Record<string, unknown> = {};
                    for (const param of inferredAction.parameters) {
                        testParams[param.name] = getSampleValueForParam(param);
                    }
                    const testResult = await testGeneratedScript(
                        generatedFlow.script,
                        browserApi,
                        testParams,
                        { timeout: 60000 },
                    );

                    if (!testResult.success) {
                        debug(
                            `Script test failed for ${inferredAction.name}: ${testResult.error}`,
                        );
                        reportProgress(
                            ctx,
                            `Script test failed for ${inferredAction.name}, saving anyway...`,
                        );
                    } else {
                        debug(`Script test passed for ${inferredAction.name}`);
                    }

                    await store.save(generatedFlow);
                    createdFlows.push(generatedFlow.name);
                    debug(
                        `Created WebFlow from reasoning: ${generatedFlow.name}`,
                    );
                    reportProgress(
                        ctx,
                        `Created WebFlow: ${generatedFlow.name}`,
                    );
                } else {
                    // Generation failed - report failure instead of creating placeholder
                    debug(
                        `WebFlow generation failed for ${inferredAction.name}`,
                    );
                    reportProgress(
                        ctx,
                        `Failed to generate WebFlow script for: ${inferredAction.name}`,
                    );
                    failedFlows.push(inferredAction.name);
                }
            } else {
                // Reasoning failed - report failure with summary instead of creating placeholder
                debug(
                    `Reasoning failed for ${inferredAction.name}: ${trace.result.summary}`,
                );
                reportProgress(
                    ctx,
                    `Automation failed for ${inferredAction.name}: ${trace.result.summary}`,
                );
                failedFlows.push(inferredAction.name);
            }
        } catch (error) {
            const errorMsg =
                error instanceof Error ? error.message : String(error);
            debug(`Error creating WebFlow for ${inferredAction.name}:`, error);
            reportProgress(
                ctx,
                `Error for ${inferredAction.name}: ${errorMsg}`,
            );
            failedFlows.push(inferredAction.name);
        }
    }

    sendWebFlowRefreshToClient(ctx.sessionContext);

    // Reload the agent schema so the dispatcher picks up the new grammar patterns
    try {
        await ctx.sessionContext.reloadAgentSchema();
        debug("Reloaded agent schema after WebFlow creation");
    } catch (err) {
        debug("Failed to reload agent schema:", err);
    }

    let displayText = "";
    if (createdFlows.length > 0) {
        displayText += `Created ${createdFlows.length} WebFlow(s): ${createdFlows.join(", ")}\n`;
    }
    if (failedFlows.length > 0) {
        displayText += `Failed to create ${failedFlows.length} flow(s): ${failedFlows.join(", ")}\n`;
        displayText += `Tip: Try running the automation again or simplify the goal.`;
    }

    return {
        displayText: displayText || "No actions were created.",
        entities: ctx.entities.getEntities(),
        data: {
            created: createdFlows,
            failed: failedFlows,
        },
    };
}

/**
 * Build an enriched goal prompt from an inferred action for the reasoning agent.
 * This creates a detailed prompt that guides the reasoning agent to execute
 * the inferred action on the current page.
 */
function buildGoalFromInferredAction(
    action: InferredAction,
    pageUrl: string,
): string {
    let goal = `Task: ${action.name}

`;
    goal += `Description: ${action.description}

`;
    goal += `Expected outcome: ${action.expectedOutcome}

`;

    if (action.parameters.length > 0) {
        goal += `This task requires the following inputs:
`;
        for (const param of action.parameters) {
            const sampleValue = getSampleValueForParam(param);
            goal += `- ${param.name} (${param.type}): ${param.description}`;
            goal += ` [Use sample value: "${sampleValue}"]
`;
        }
        goal += `
`;
    }

    goal += `Instructions:
`;
    goal += `1. You are on the page: ${pageUrl}
`;
    goal += `2. Find the relevant form or UI elements to complete this task
`;
    goal += `3. Use the sample values provided for each parameter
`;
    goal += `4. Complete the task by filling in forms, clicking buttons, etc.
`;
    goal += `5. Verify the expected outcome is achieved
`;

    return goal;
}

/**
 * Generate a reasonable sample value for a parameter based on its type and name.
 */
function getSampleValueForParam(
    param: InferredAction["parameters"][0],
): string {
    const name = param.name.toLowerCase();
    const type = param.type.toLowerCase();

    // Location-related parameters
    if (
        name.includes("location") ||
        name.includes("address") ||
        name.includes("from") ||
        name.includes("to") ||
        name.includes("destination") ||
        name.includes("pickup") ||
        name.includes("dropoff")
    ) {
        if (
            name.includes("from") ||
            name.includes("pickup") ||
            name.includes("origin")
        ) {
            return "Building A";
        }
        return "Building B";
    }

    // Count/number parameters
    if (
        name.includes("count") ||
        name.includes("quantity") ||
        name.includes("passengers") ||
        name.includes("guests") ||
        name.includes("people")
    ) {
        return "2";
    }

    // Boolean parameters
    if (
        type === "boolean" ||
        name.includes("accessibility") ||
        name.includes("enabled") ||
        name.includes("required")
    ) {
        return "false";
    }

    // Date/time parameters
    if (
        name.includes("date") ||
        name.includes("time") ||
        name.includes("when")
    ) {
        return "tomorrow";
    }

    // Name parameters
    if (name.includes("name") || name.includes("title")) {
        return "Test Item";
    }

    // Email parameters
    if (name.includes("email")) {
        return "test@example.com";
    }

    // Default for strings
    if (type === "string") {
        return `Sample ${param.name}`;
    }

    // Default for numbers
    if (type === "number") {
        return "1";
    }

    return "test value";
}

/**
 * Format a tool call for user-friendly display during automation.
 * Returns empty string for non-browser tools that shouldn't be shown to users.
 */
function formatToolCallForDisplay(tool: string, args: unknown): string {
    // Strip MCP prefix if present (e.g., "mcp__browser-tools__click" -> "click")
    const toolName = tool.replace(/^mcp__browser-tools__/, "");

    // Skip Claude Code SDK internal tools (not browser actions)
    if (!tool.includes("browser-tools") && !tool.startsWith("mcp__")) {
        // This is a Claude SDK tool like ToolSearch, Task, etc. - don't display
        return "";
    }

    const argsObj = args as Record<string, unknown> | undefined;
    switch (toolName) {
        case "extractComponent":
            return `Finding: ${argsObj?.description || "component"}`;
        case "click":
        case "clickAndWait":
            return `Clicking element...`;
        case "enterText":
        case "clearAndType":
            return `Typing: "${String(argsObj?.text || "").slice(0, 30)}..."`;
        case "selectOption":
            return `Selecting: "${argsObj?.value}"`;
        case "navigateTo":
            return `Navigating to page...`;
        case "getPageText":
            return "Reading page content...";
        case "checkPageState":
            return "Verifying page state...";
        case "awaitPageLoad":
            return "Waiting for page to load...";
        case "pressKey":
            return `Pressing key: ${argsObj?.key}`;
        case "queryContent":
            return "Extracting content...";
        default:
            return `${toolName}...`;
    }
}

function generateGrammarPatterns(action: InferredAction): string[] {
    const patterns: string[] = [];
    const words = action.name
        .replace(/([A-Z])/g, " $1")
        .trim()
        .toLowerCase()
        .split(" ");

    patterns.push(words.join(" "));

    if (action.parameters.length > 0) {
        const paramPlaceholders = action.parameters
            .filter((p) => p.required)
            .map((p) => `{${p.name}}`)
            .join(" ");
        if (paramPlaceholders) {
            patterns.push(`${words.join(" ")} ${paramPlaceholders}`);
        }
    }

    return patterns;
}

export async function handleSchemaDiscoveryAction(
    action: SchemaDiscoveryActions,
    context: SessionContext<BrowserActionContext>,
    progressCallback?: (message: string) => void,
    actionIO?: ProgressActionIO,
) {
    if (!context.agentContext.browserControl) {
        throw new Error("No connection to browser session.");
    }

    const browser: BrowserControl = context.agentContext.browserControl;
    const agent = await createDiscoveryPageTranslator("GPT_5_2");

    // Create entity collector and action context
    const entityCollector = new EntityCollector();
    const discoveryContext: DiscoveryActionHandlerContext = {
        browser,
        agent,
        entities: entityCollector,
        sessionContext: context,
        ...(progressCallback && { progressCallback }),
        ...(actionIO && { actionIO }),
    };

    let result: DiscoveryActionResult;

    // autoDiscoverActions is not part of SchemaDiscoveryActions — handle before switch
    if ((action as any).actionName === "autoDiscoverActions") {
        const adResult = await handleAutoDiscoverActions(
            action,
            discoveryContext,
        );
        return {
            displayText: adResult.displayText,
            data: adResult.data,
            entities: adResult.entities,
        };
    }

    switch (action.actionName) {
        case "detectPageActions":
            result = await handleFindUserActions(action, discoveryContext);
            break;
        case "summarizePage":
            result = await handleGetPageSummary(action, discoveryContext);
            break;
        case "registerPageDynamicAgent":
            result = await handleRegisterSiteSchema(action, discoveryContext);
            break;
        case "createWebFlowFromRecording":
            result = await handleCreateWebFlowFromRecording(
                action,
                discoveryContext,
            );
            break;
        case "getWebFlowsForDomain":
            result = await handleGetWebFlowsForDomain(action, discoveryContext);
            break;
        case "getAllWebFlows":
            result = await handleGetAllWebFlows(action, discoveryContext);
            break;
        case "deleteWebFlow":
            result = await handleDeleteWebFlow(action, discoveryContext);
            break;
        case "inferActions":
            result = await handleInferActions(action, discoveryContext);
            break;
        case "createInferredFlows":
            result = await handleCreateInferredFlows(action, discoveryContext);
            break;
        default:
            result = {
                displayText: "OK",
                entities: entityCollector.getEntities(),
            };
    }

    return {
        displayText: result.displayText,
        data: result.data,
        entities: result.entities,
    };
}
