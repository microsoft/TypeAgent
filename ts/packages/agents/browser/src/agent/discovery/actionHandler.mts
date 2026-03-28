// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import {
    BrowserActionContext,
    getBrowserControl,
    getCurrentPageScreenshot,
} from "../browserActions.mjs";
import { BrowserControl } from "../../common/browserControl.mjs";
import { createDiscoveryPageTranslator } from "./translator.mjs";
import {
    ActionSchemaTypeDefinition,
    ActionSchemaObject,
    ActionParamType,
    generateActionSchema,
} from "@typeagent/action-schema";
import { SchemaCreator as sc } from "@typeagent/action-schema";
import { UserActionsList } from "./schema/userActionsPool.mjs";
import { PageDescription } from "./schema/pageSummary.mjs";
import {
    SchemaDiscoveryActions,
    CreateWebFlowFromRecording,
    GetWebFlowsForDomain,
    GetAllWebFlows,
    DeleteWebFlow,
} from "./schema/discoveryActions.mjs";
import registerDebug from "debug";
import { WebFlowStore } from "../webFlows/store/webFlowStore.mjs";
import { WebFlowDefinition, WebFlowParameter } from "../webFlows/types.js";
import {
    normalizeRecording,
    RecordingData,
} from "../webFlows/recordingNormalizer.mjs";
import {
    generateWebFlowFromTrace,
    ScriptGenerationOptions,
} from "../webFlows/scriptGenerator.mjs";
import { ensureSampleFlowsRegistered } from "../webFlows/actionHandler.mjs";
import { sendWebFlowRefreshToClient } from "../browserActionHandler.mjs";
import { addAllowDynamicAgentDomains } from "../webTypeAgent.mjs";

const debug = registerDebug("typeagent:browser:discover:handler");

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

// Context interface for discovery action handler functions
interface DiscoveryActionHandlerContext {
    browser: BrowserControl;
    agent: any;
    entities: EntityCollector;
    sessionContext: SessionContext<BrowserActionContext>;
}

async function handleFindUserActions(
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
    let pageSummary = "";

    // Only include screenshot if it's not empty
    const screenshots = screenshot ? [screenshot] : [];

    const summaryResponse = await ctx.agent.getPageSummary(
        undefined,
        htmlFragments,
        screenshots,
    );

    let schemaDescription =
        "A schema that enables interactions with the current page";
    if (summaryResponse.success) {
        pageSummary =
            "Page summary: \n" + JSON.stringify(summaryResponse.data, null, 2);
        schemaDescription += (summaryResponse.data as PageDescription)
            .description;
    }

    const timerName = `Analyzing page actions`;
    console.time(timerName);

    const response = await ctx.agent.getCandidateUserActions(
        undefined,
        htmlFragments,
        screenshots,
        pageSummary,
    );

    if (!response.success) {
        console.error("Attempt to get page actions failed");
        console.error(response.message);
        return {
            displayText: "Action could not be completed",
            entities: ctx.entities.getEntities(),
        };
    }

    console.timeEnd(timerName);

    const selected = response.data as UserActionsList;
    const uniqueItems = new Map(
        selected.actions.map((action) => [action.actionName, action]),
    );

    let message =
        "Possible user actions: \n" +
        JSON.stringify(Array.from(uniqueItems.values()), null, 2);

    const actionNames = [...new Set(uniqueItems.keys())];

    const { schema, typeDefinitions } = await getDynamicSchema(
        actionNames,
        ctx.sessionContext,
    );
    message += `\n =========== \n Discovered actions schema: \n ${schema} `;

    const url = await getBrowserControl(
        ctx.sessionContext.agentContext,
    ).getPageUrl();

    // AUTO-SAVE: Save discovered actions directly to WebFlowStore
    if (uniqueItems.size > 0 && ctx.sessionContext.agentContext.webFlowStore) {
        try {
            const webFlowStore = ctx.sessionContext.agentContext.webFlowStore;
            await ensureSampleFlowsRegistered(webFlowStore);
            const domain = new URL(url!).hostname;
            let savedCount = 0;
            let skippedCount = 0;

            const existingFlowNames = new Set(
                await webFlowStore.listForDomain(domain),
            );

            for (const actionData of Array.from(uniqueItems.values()) as any) {
                if (!actionData.actionName) continue;

                if (existingFlowNames.has(actionData.actionName)) {
                    skippedCount++;
                    continue;
                }

                // Build a WebFlowDefinition directly from the discovered action
                const paramEntries = Object.entries(
                    actionData.parameters || {},
                );
                const parameters: Record<string, WebFlowParameter> = {};
                for (const [k, v] of paramEntries) {
                    const param = v as any;
                    parameters[k] = {
                        type: (param.type || "string") as
                            | "string"
                            | "number"
                            | "boolean",
                        required: param.required !== false,
                        description: param.description || k,
                    };
                }

                const flow: WebFlowDefinition = {
                    name: actionData.actionName,
                    description:
                        actionData.description ||
                        `Auto-discovered: ${actionData.actionName}`,
                    version: 1,
                    parameters,
                    script: generateDiscoveredActionScript(
                        actionData.actionName,
                        parameters,
                    ),
                    grammarPatterns: generateGrammarPatterns(
                        actionData.actionName,
                        parameters,
                    ),
                    scope: { type: "site", domains: [domain] },
                    source: {
                        type: "discovered",
                        timestamp: new Date().toISOString(),
                    },
                };

                await webFlowStore.save(flow);
                savedCount++;
            }

            debug(
                `Auto-saved ${savedCount} discovered actions to WebFlowStore for ${domain} (skipped ${skippedCount} existing)`,
            );
        } catch (error) {
            debug("Failed to auto-save discovered actions:", error);
        }
    }

    // Auto-approve this domain for webAgent registration so the
    // WebFlowAgent can register a temp_ agent without a user prompt.
    if (url) {
        try {
            const hostname = new URL(url).hostname;
            await addAllowDynamicAgentDomains(hostname, ctx.sessionContext);
        } catch {
            // Invalid URL — skip
        }
    }

    // Tell the browser-side WebFlowAgent to re-fetch flows and update schema
    sendWebFlowRefreshToClient(ctx.sessionContext);

    // Return the site-scoped actions actually applicable to this page
    // (not the raw LLM output which may include irrelevant pool actions).
    let siteActions: WebFlowDefinition[] = [];
    if (url && ctx.sessionContext.agentContext.webFlowStore) {
        try {
            const domain = new URL(url).hostname;
            siteActions =
                await ctx.sessionContext.agentContext.webFlowStore.listForDomainWithDetails(
                    domain,
                );
            // Exclude global actions — only return site-scoped and user-recorded
            siteActions = siteActions.filter((f) => f.scope.type !== "global");
        } catch {
            // URL parsing failed
        }
    }

    return {
        displayText: message,
        entities: ctx.entities.getEntities(),
        data: {
            schema: Array.from(uniqueItems.values()),
            typeDefinitions: typeDefinitions,
            actions: siteActions,
        },
    };
}

function capitalize(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function generateGrammarPatterns(
    actionName: string,
    parameters: Record<string, WebFlowParameter>,
): string[] {
    // Convert camelCase action name to words: "searchForProduct" -> ["search", "for", "product"]
    const words = actionName
        .replace(/([A-Z])/g, " $1")
        .trim()
        .toLowerCase()
        .split(/\s+/);

    const paramEntries = Object.entries(parameters);
    const requiredParams = paramEntries.filter(([, p]) => p.required);

    if (requiredParams.length === 0) {
        return [words.join(" ")];
    }

    const patterns: string[] = [];
    // Build a base phrase from the action name words
    const basePhrase = words.join(" ");

    // For single-parameter actions, append the param as a wildcard/number
    if (requiredParams.length === 1) {
        const [paramName, paramDef] = requiredParams[0];
        const paramToken =
            paramDef.type === "number"
                ? `$(${paramName}:number)`
                : `$(${paramName}:wildcard)`;
        patterns.push(`${basePhrase} ${paramToken}`);

        // Add a shorter variant if action name already implies direction
        if (words.length > 2) {
            const shortPhrase = words.slice(0, 2).join(" ");
            patterns.push(`${shortPhrase} ${paramToken}`);
        }
    } else {
        // Multi-parameter: just use the base phrase with first required param
        const [paramName, paramDef] = requiredParams[0];
        const paramToken =
            paramDef.type === "number"
                ? `$(${paramName}:number)`
                : `$(${paramName}:wildcard)`;
        patterns.push(`${basePhrase} ${paramToken}`);
    }

    return patterns;
}

function generateDiscoveredActionScript(
    actionName: string,
    parameters: Record<
        string,
        { type: string; required: boolean; description: string }
    >,
): string {
    const paramChecks = Object.entries(parameters)
        .filter(([, p]) => p.required)
        .map(
            ([name]) =>
                `    if (!params.${name}) throw new Error("Missing required parameter: ${name}");`,
        )
        .join("\n");

    return `async function execute(browser, params) {
${paramChecks}
    // Discovered action: ${actionName}
    // This is a placeholder script. The action was detected on the page
    // but no recording was made. Record this action to generate a real script.
    return { success: false, message: "Action '${actionName}' needs to be recorded to generate executable script" };
}`;
}

async function buildDynamicSchemaFromWebFlows(
    store: WebFlowStore,
    currentDomain: string,
    actionNames: string[],
): Promise<{
    schema: string;
    actionNames: string[];
    typeDefinitions: Record<string, ActionSchemaTypeDefinition>;
}> {
    const eligibleNames = await store.listForDomain(currentDomain);
    // Include all eligible webFlows (detected + user-authored), not just LLM-detected
    const relevantNames = [
        ...new Set([
            ...actionNames.filter((n) => eligibleNames.includes(n)),
            ...eligibleNames,
        ]),
    ];

    const schemaActionNames: string[] = [];
    const typeDefinitions = new Map<string, ActionSchemaTypeDefinition>();

    for (const name of relevantNames) {
        const flow = await store.get(name);
        if (!flow) continue;

        schemaActionNames.push(flow.name);

        const paramEntries = Object.entries(flow.parameters);
        const typeName = capitalize(flow.name);

        const paramFields: Map<string, any> = new Map<string, any>();
        for (const [k, v] of paramEntries) {
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

        const typeDef = sc.type(typeName, obj, flow.description, true);
        typeDefinitions.set(flow.name, typeDef);
    }

    // Generate unified schema
    const union = sc.union(
        Array.from(typeDefinitions.values()).map((definition) =>
            sc.ref(definition),
        ),
    );
    const entry = sc.type("DynamicUserPageActions", union);
    entry.exported = true;
    const actionSchemas = new Map<string, ActionSchemaTypeDefinition>();
    const order = new Map<string, number>();
    const schema = await generateActionSchema(
        { entry, actionSchemas, order },
        { exact: true },
    );

    return {
        schema,
        actionNames: schemaActionNames,
        typeDefinitions: Object.fromEntries(typeDefinitions),
    };
}

async function getDynamicSchema(
    actionNames: string[],
    sessionContext: SessionContext<BrowserActionContext>,
) {
    const webFlowStore = sessionContext.agentContext.webFlowStore;
    if (!webFlowStore) {
        throw new Error(
            "WebFlowStore not available — cannot build dynamic schema",
        );
    }

    const url = await getBrowserControl(
        sessionContext.agentContext,
    ).getPageUrl();
    const domain = new URL(url!).hostname;
    return await buildDynamicSchemaFromWebFlows(
        webFlowStore,
        domain,
        actionNames,
    );
}

function refreshDynamicAgentSchema(ctx: DiscoveryActionHandlerContext): void {
    sendWebFlowRefreshToClient(ctx.sessionContext);
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

    await refreshDynamicAgentSchema(ctx);

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
        await refreshDynamicAgentSchema(ctx);
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

export async function handleSchemaDiscoveryAction(
    action: SchemaDiscoveryActions,
    context: SessionContext<BrowserActionContext>,
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
    };

    let result: DiscoveryActionResult;

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
