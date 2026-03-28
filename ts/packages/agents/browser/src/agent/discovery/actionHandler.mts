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
import {
    SchemaDiscoveryActions,
    CreateWebFlowFromRecording,
    GetWebFlowsForDomain,
    GetAllWebFlows,
    DeleteWebFlow,
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
    const url = await getBrowserControl(
        ctx.sessionContext.agentContext,
    ).getPageUrl();

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
    const screenshots = screenshot ? [screenshot] : [];

    let pageSummary = "";
    const summaryResponse = await ctx.agent.getPageSummary(
        undefined,
        htmlFragments,
        screenshots,
    );
    if (summaryResponse.success) {
        pageSummary =
            "Page summary: \n" + JSON.stringify(summaryResponse.data, null, 2);
    }

    const timerName = `Analyzing page actions`;
    console.time(timerName);

    const response = await ctx.agent.getCandidateUserActions(
        discoverySchema,
        htmlFragments,
        screenshots,
        pageSummary,
    );

    console.timeEnd(timerName);

    if (!response.success) {
        debug("Discovery LLM call failed: %s", response.message);
        return {
            displayText: "Action could not be completed",
            entities: ctx.entities.getEntities(),
        };
    }

    // The LLM returns a CandidateActionList with the subset of flows
    // that actually apply to this page.
    const selected = response.data as { actions: { actionName: string }[] };
    const selectedNames = new Set(selected.actions.map((a) => a.actionName));

    // Filter the full WebFlowDefinitions to only those the LLM selected
    const applicableFlows = candidateFlows.filter((f) =>
        selectedNames.has(f.name),
    );

    debug(
        `Discovery: ${candidateFlows.length} candidates → ${applicableFlows.length} applicable to page`,
    );

    return {
        displayText: `Found ${applicableFlows.length} applicable actions`,
        entities: ctx.entities.getEntities(),
        data: { actions: applicableFlows },
    };
}

function generateDiscoverySchema(flows: WebFlowDefinition[]): string {
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
        `export type CandidateActionList = {\n    actions: CandidateActions[];\n};`
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
