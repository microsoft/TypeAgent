// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentManifest, SessionContext } from "@typeagent/agent-sdk";
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
    parseActionSchemaSource,
    generateSchemaTypeDefinition,
} from "@typeagent/action-schema";
import { SchemaCreator as sc } from "@typeagent/action-schema";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { UserActionsList } from "./schema/userActionsPool.mjs";
import { PageDescription } from "./schema/pageSummary.mjs";
import { createTempAgentForSchema } from "./tempAgentActionHandler.mjs";
import {
    GetIntentFromRecording,
    SchemaDiscoveryActions,
    GetMacrosForUrl,
    DeleteMacro,
    GetAllMacros,
} from "./schema/discoveryActions.mjs";
import { UserIntent } from "./schema/recordedActions.mjs";
import { createSchemaAuthoringAgent } from "./authoringActionHandler.mjs";
import registerDebug from "debug";
import { YAMLMacroStoreExtension } from "./yamlMacro/macroStoreExtension.mjs";
import {
    convertParametersToYAML,
    convertStepsToYAML,
    extractParametersFromIntent,
    filterUnusedParameters,
    generateMacroId,
} from "./yamlMacro/macroHelper.mjs";
import { MacroConverter } from "./yamlMacro/converter.mjs";
import { ArtifactsStorage } from "./yamlMacro/artifactsStorage.mjs";
import { MacroToWebFlowConverter } from "../webFlows/macroToWebFlowConverter.mjs";
import { WebFlowStore } from "../webFlows/store/webFlowStore.mjs";
import {
    normalizeRecording,
    RecordingData,
} from "../webFlows/recordingNormalizer.mjs";
import { generateWebFlowFromTrace } from "../webFlows/scriptGenerator.mjs";

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
    const hostName = new URL(url!).hostname.replace(/\./g, "_");
    const agentName = `temp_${hostName}`;

    if (action.parameters?.registerAgent) {
        const manifest: AppAgentManifest = {
            emojiChar: "🚧",
            description: schemaDescription,
            schema: {
                description: schemaDescription,
                schemaType: "DynamicUserPageActions",
                schemaFile: { content: schema, format: "ts" },
            },
        };

        // register agent after request is processed to avoid a deadlock
        setTimeout(async () => {
            try {
                await ctx.sessionContext.removeDynamicAgent(agentName);
            } catch {}

            await ctx.sessionContext.addDynamicAgent(
                agentName,
                manifest,
                createTempAgentForSchema(
                    ctx.browser,
                    ctx.agent,
                    ctx.sessionContext,
                ),
            );
        }, 1000);
    }

    // AUTO-SAVE: Save discovered actions immediately
    if (uniqueItems.size > 0) {
        try {
            debug("[YAML_DEBUG] About to call getPageUrl()...");
            const url = await getBrowserControl(
                ctx.sessionContext.agentContext,
            ).getPageUrl();
            debug(`[YAML_DEBUG] getPageUrl() returned: ${url}`);

            // Direct save to MacroStore (no longer using separate handler)
            if (!ctx.sessionContext.agentContext.macrosStore) {
                throw new Error("MacroStore not available");
            }

            const domain = new URL(url!).hostname;
            let savedCount = 0;
            let skippedCount = 0;

            // Get existing actions for this URL to check for duplicates
            const existingActions =
                await ctx.sessionContext.agentContext.macrosStore.getMacrosForUrl(
                    url!,
                );
            const existingActionNames = new Set(
                existingActions
                    .filter((action: any) => action.author === "discovered")
                    .map((action: any) => action.name),
            );

            for (const actionData of Array.from(uniqueItems.values()) as any) {
                if (!actionData.actionName) continue;

                // Check if action with same name already exists for this URL
                if (existingActionNames.has(actionData.actionName)) {
                    skippedCount++;
                    debug(
                        `Skipping duplicate discovered action: ${actionData.actionName}`,
                    );
                    continue;
                }

                debug(
                    `[YAML_DEBUG] LLM-generated actionData for ${actionData.actionName}:`,
                    JSON.stringify(actionData, null, 2),
                );

                const storedMacro =
                    ctx.sessionContext.agentContext.macrosStore.createDefaultMacro(
                        {
                            name: actionData.actionName,
                            description: `Auto-discovered: ${actionData.actionName}`,
                            category: "utility",
                            author: "discovered",
                            scope: {
                                type: "domain",
                                domain: domain,
                                priority: 60,
                            },
                            definition: {
                                detectedSchema: actionData,
                                ...(typeDefinitions?.[
                                    actionData.actionName
                                ] && {
                                    intentSchema:
                                        typeof typeDefinitions[
                                            actionData.actionName
                                        ] === "string"
                                            ? (typeDefinitions[
                                                  actionData.actionName
                                              ] as unknown as string)
                                            : JSON.stringify(
                                                  typeDefinitions[
                                                      actionData.actionName
                                                  ],
                                              ),
                                }),
                                macroDefinition:
                                    typeDefinitions[actionData.actionName],
                            },
                        },
                    );

                debug(
                    `[YAML_DEBUG] StoredMacro before save for ${actionData.actionName}:`,
                    JSON.stringify(storedMacro, null, 2),
                );

                const result =
                    await ctx.sessionContext.agentContext.macrosStore.saveMacro(
                        storedMacro,
                    );
                if (result.success) {
                    savedCount++;
                } else {
                    console.error(
                        `Failed to save discovered action ${actionData.actionName}:`,
                        result.error,
                    );
                }
            }

            debug(
                `Auto-saved ${savedCount} new discovered actions for ${domain} (skipped ${skippedCount} existing)`,
            );

            // Also convert saved macros to webFlows
            if (
                savedCount > 0 &&
                ctx.sessionContext.agentContext.webFlowStore
            ) {
                try {
                    const converter = new MacroToWebFlowConverter();
                    const allMacros =
                        await ctx.sessionContext.agentContext.macrosStore.getMacrosForUrl(
                            url!,
                        );
                    const newlyDiscovered = allMacros.filter(
                        (m: any) =>
                            m.author === "discovered" &&
                            !existingActionNames.has(m.name),
                    );
                    const flows = converter.convertMany(newlyDiscovered);
                    for (const flow of flows) {
                        await ctx.sessionContext.agentContext.webFlowStore.save(
                            flow,
                        );
                    }
                    debug(
                        `Converted ${flows.length} discovered macros to webFlows`,
                    );
                } catch (webFlowError) {
                    debug(
                        "Failed to convert discovered macros to webFlows:",
                        webFlowError,
                    );
                }
            }
        } catch (error) {
            debug("Failed to auto-save discovered actions:", error);
            // Continue without failing the discovery operation
        }
    }

    return {
        displayText: message,
        entities: ctx.entities.getEntities(),
        data: {
            schema: Array.from(uniqueItems.values()),
            typeDefinitions: typeDefinitions,
        },
    };
}

function capitalize(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1);
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

    // Also include any actionNames not covered by webFlows (fallback to hardcoded)
    const uncoveredNames = actionNames.filter(
        (n) => !schemaActionNames.includes(n),
    );
    if (uncoveredNames.length > 0) {
        try {
            const fallback = await getDynamicSchemaFromFile(uncoveredNames);
            for (const [name, def] of Object.entries(
                fallback.typeDefinitions,
            )) {
                if (!typeDefinitions.has(name)) {
                    typeDefinitions.set(
                        name,
                        def as ActionSchemaTypeDefinition,
                    );
                    schemaActionNames.push(name);
                }
            }
        } catch {
            debug("Fallback to hardcoded schema failed for uncovered names");
        }
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

async function getDynamicSchemaFromFile(actionNames: string[]) {
    const packageRoot = path.join("..", "..", "..");

    const userActionsPoolSchema = await fs.promises.readFile(
        fileURLToPath(
            new URL(
                path.join(
                    packageRoot,
                    "./src/agent/discovery/schema/userActionsPool.mts",
                ),
                import.meta.url,
            ),
        ),
        "utf8",
    );
    const parsed = parseActionSchemaSource(
        userActionsPoolSchema,
        "dynamicUserActions",
        "UserPageActions",
    );

    let typeDefinitions = new Map<string, ActionSchemaTypeDefinition>();
    actionNames.forEach((name) => {
        if (parsed.actionSchemas.has(name)) {
            typeDefinitions.set(name, parsed.actionSchemas.get(name)!);
        }
    });

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

    return { schema, typeDefinitions: Object.fromEntries(typeDefinitions) };
}

async function getDynamicSchema(
    actionNames: string[],
    sessionContext?: SessionContext<BrowserActionContext>,
) {
    // Try dynamic schema from webFlows first
    const webFlowStore = sessionContext?.agentContext?.webFlowStore;
    if (webFlowStore) {
        try {
            const url = await getBrowserControl(
                sessionContext!.agentContext,
            ).getPageUrl();
            const domain = new URL(url!).hostname;
            return await buildDynamicSchemaFromWebFlows(
                webFlowStore,
                domain,
                actionNames,
            );
        } catch (error) {
            debug("Dynamic schema from webFlows failed, falling back:", error);
        }
    }

    // Fallback to hardcoded schema
    return await getDynamicSchemaFromFile(actionNames);
}

async function refreshDynamicAgentSchema(
    ctx: DiscoveryActionHandlerContext,
): Promise<void> {
    try {
        const url = await getBrowserControl(
            ctx.sessionContext.agentContext,
        ).getPageUrl();
        const hostName = new URL(url!).hostname.replace(/\./g, "_");
        const agentName = `temp_${hostName}`;

        // Build schema from all available webFlows + macros for this domain
        const webFlowStore = ctx.sessionContext.agentContext.webFlowStore;
        if (!webFlowStore) return;

        const domain = new URL(url!).hostname;
        const eligibleFlows = await webFlowStore.listForDomain(domain);

        // Also include actions from MacroStore
        const macroNames: string[] = [];
        if (ctx.sessionContext.agentContext.macrosStore) {
            const macros =
                await ctx.sessionContext.agentContext.macrosStore.getMacrosForUrl(
                    url!,
                );
            for (const m of macros) {
                macroNames.push(m.name);
            }
        }

        const allNames = [...new Set([...eligibleFlows, ...macroNames])];
        if (allNames.length === 0) return;

        const { schema } = await getDynamicSchema(allNames, ctx.sessionContext);

        const schemaDescription = `A schema that enables interactions with the ${hostName} page`;
        const manifest: AppAgentManifest = {
            emojiChar: "🚧",
            description: schemaDescription,
            schema: {
                description: schemaDescription,
                schemaType: "DynamicUserPageActions",
                schemaFile: { content: schema, format: "ts" },
            },
        };

        // Re-register after a short delay to avoid deadlock
        setTimeout(async () => {
            try {
                await ctx.sessionContext.removeDynamicAgent(agentName);
            } catch {
                try {
                    await ctx.sessionContext.forceCleanupDynamicAgent(
                        agentName,
                    );
                } catch {
                    // May not exist yet
                }
            }

            try {
                await ctx.sessionContext.addDynamicAgent(
                    agentName,
                    manifest,
                    createTempAgentForSchema(
                        ctx.browser,
                        ctx.agent,
                        ctx.sessionContext,
                    ),
                );
                debug(
                    `Refreshed dynamic agent schema for ${agentName} with ${allNames.length} actions`,
                );
            } catch (error) {
                debug(`Failed to refresh dynamic agent schema:`, error);
            }
        }, 500);
    } catch (error) {
        debug("Failed to refresh dynamic agent schema:", error);
    }
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

async function getIntentSchemaFromJSON(
    userIntentJson: UserIntent,
    actionDescription: string,
) {
    let fields: Map<string, any> = new Map<string, any>();

    userIntentJson.parameters.forEach((param) => {
        let paramType: ActionParamType = sc.string();
        switch (param.type) {
            case "string":
                paramType = sc.string();
                break;
            case "number":
                paramType = sc.number();
                break;
            case "boolean":
                paramType = sc.number();
                break;
        }

        if (param.required && !param.defaultValue) {
            fields.set(param.shortName, sc.field(paramType, param.description));
        } else {
            fields.set(
                param.shortName,
                sc.optional(paramType, param.description),
            );
        }
    });

    const obj: ActionSchemaObject = sc.obj({
        actionName: sc.string(userIntentJson.actionName),
        parameters: sc.obj(Object.fromEntries(fields)),
    } as const);

    const schema = sc.type(
        userIntentJson.actionName,
        obj,
        actionDescription,
        true,
    );

    return {
        actionSchema: generateSchemaTypeDefinition(schema, { exact: true }),
        typeDefinition: schema,
    };
}

async function handleRegisterAuthoringAgent(
    action: any,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const packageRoot = path.join("..", "..", "..");
    const schemaFilePath = fileURLToPath(
        new URL(
            path.join(
                packageRoot,
                "./src/agent/discovery/schema/authoringActions.mts",
            ),
            import.meta.url,
        ),
    );

    const agentName = `actionAuthor`;
    const schemaDescription = `A schema that enables authoring new actions for the web automation plans`;

    const manifest: AppAgentManifest = {
        emojiChar: "🧑‍🔧",
        description: schemaDescription,
        schema: {
            description: schemaDescription,
            schemaType: "PlanAuthoringActions",
            schemaFile: schemaFilePath,
            cached: false,
        },
    };

    // register agent after request is processed to avoid a deadlock
    setTimeout(async () => {
        try {
            await ctx.sessionContext.removeDynamicAgent(agentName);
        } catch {}

        await ctx.sessionContext.addDynamicAgent(
            agentName,
            manifest,
            createSchemaAuthoringAgent(
                ctx.browser,
                ctx.agent,
                ctx.sessionContext,
            ),
        );
    }, 1000);

    return {
        displayText: "OK",
        entities: ctx.entities.getEntities(),
    };
}

async function handleRegisterSiteSchema(
    action: any,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const url = await getBrowserControl(
        ctx.sessionContext.agentContext,
    ).getPageUrl();

    if (!ctx.sessionContext.agentContext.macrosStore) {
        throw new Error(
            "ActionsStore not available - please ensure TypeAgent server is running",
        );
    }

    debug("Using MacroStore for schema registration");
    const urlActions =
        await ctx.sessionContext.agentContext.macrosStore.getMacrosForUrl(url!);

    const detectedActions = new Map<string, ActionSchemaTypeDefinition>();
    const authoredActions = new Map<string, ActionSchemaTypeDefinition>();

    for (const storedMacro of urlActions) {
        if (storedMacro.definition.macroDefinition) {
            detectedActions.set(
                storedMacro.name,
                storedMacro.definition.macroDefinition,
            );
        }

        // Include user-authored actions via their intentJson schema
        if (
            storedMacro.author === "user" &&
            storedMacro.definition.intentJson &&
            !detectedActions.has(storedMacro.name)
        ) {
            try {
                const { typeDefinition } = await getIntentSchemaFromJSON(
                    storedMacro.definition.intentJson as UserIntent,
                    storedMacro.description,
                );
                authoredActions.set(storedMacro.name, typeDefinition);
            } catch (error) {
                debug(
                    `Failed to build schema for authored action "${storedMacro.name}":`,
                    error,
                );
            }
        }
    }

    // Also include webFlows for this domain (sample flows + user-authored webFlows)
    const webFlowStore = ctx.sessionContext.agentContext.webFlowStore;
    if (webFlowStore) {
        const domain = new URL(url!).hostname;
        const eligibleFlows = await webFlowStore.listForDomain(domain);
        for (const flowName of eligibleFlows) {
            if (detectedActions.has(flowName) || authoredActions.has(flowName))
                continue;
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
            authoredActions.set(flowName, typeDef);
        }
    }

    const typeDefinitions: ActionSchemaTypeDefinition[] = [
        ...detectedActions.values(),
        ...authoredActions.values(),
    ];

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

    const hostName = new URL(url!).hostname.replace(/\./g, "_");
    const agentName = `temp_${hostName}`;
    const schemaDescription = `A schema that enables interactions with the ${hostName} page`;

    const manifest: AppAgentManifest = {
        emojiChar: "🚧",
        description: schemaDescription,
        schema: {
            description: schemaDescription,
            schemaType: "DynamicUserPageActions",
            schemaFile: { content: schema, format: "ts" },
        },
    };

    // register agent after request is processed to avoid a deadlock
    setTimeout(async () => {
        let cleanupFailed = false;
        try {
            await ctx.sessionContext.removeDynamicAgent(agentName);
            debug(`Successfully removed existing agent: ${agentName}`);
        } catch {
            // Agent may not exist yet — this is expected on first registration.
            // Track the failure so we can report it if addDynamicAgent also fails.
            cleanupFailed = true;
            try {
                await ctx.sessionContext.forceCleanupDynamicAgent(agentName);
                debug(`Force cleanup successful for: ${agentName}`);
                cleanupFailed = false;
            } catch {
                // Will be logged below only if registration fails
            }
        }

        try {
            await ctx.sessionContext.addDynamicAgent(
                agentName,
                manifest,
                createTempAgentForSchema(
                    ctx.browser,
                    ctx.agent,
                    ctx.sessionContext,
                ),
            );
            debug(`Successfully registered agent: ${agentName}`);
        } catch (error) {
            if (cleanupFailed) {
                console.error(
                    `Failed to register dynamic agent '${agentName}' (prior cleanup also failed):`,
                    error,
                );
            } else {
                console.error(
                    `Failed to register dynamic agent '${agentName}':`,
                    error,
                );
            }
        }
    }, 1000);

    return {
        displayText: "Schema registered successfully",
        entities: ctx.entities.getEntities(),
        data: { schema: schema, typeDefinitions: typeDefinitions },
    };
}

async function handleGetIntentFromReccording(
    action: GetIntentFromRecording,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    // Filter empty screenshots to avoid "Invalid image URL" errors
    const screenshots = action.parameters.screenshots?.filter(
        (s: string) => s && s.trim() !== "",
    );

    let recordedSteps = action.parameters.recordedActionSteps;
    if (
        recordedSteps === undefined ||
        recordedSteps === "" ||
        recordedSteps === "[]"
    ) {
        const descriptionResponse =
            await ctx.agent.getDetailedStepsFromDescription(
                action.parameters.recordedActionName,
                action.parameters.recordedActionDescription,
                action.parameters.fragments,
                screenshots,
            );
        if (descriptionResponse.success) {
            debug(descriptionResponse.data);
            recordedSteps = JSON.stringify(
                (descriptionResponse.data as any).actions,
            );
        }
    }

    let existingActionNames = action.parameters.existingActionNames;
    const url = await getBrowserControl(
        ctx.sessionContext.agentContext,
    ).getPageUrl();

    if (!existingActionNames || existingActionNames.length === 0) {
        const existingActions =
            await ctx.sessionContext.agentContext.macrosStore?.getMacrosForUrl(
                url!,
            );
        if (existingActions) {
            const dedupedActionNames = new Set(
                existingActions.map((action: any) => action.name),
            );
            existingActionNames = [...dedupedActionNames];
        }
    }

    const timerName = `Getting intent schema`;
    console.time(timerName);
    const intentResponse = await ctx.agent.getIntentSchemaFromRecording(
        action.parameters.recordedActionName,
        existingActionNames,
        action.parameters.recordedActionDescription,
        recordedSteps,
        action.parameters.fragments,
        screenshots,
    );

    if (!intentResponse.success) {
        console.error("Attempt to process recorded action failed");
        console.error(intentResponse.message);
        return {
            displayText: "Action could not be completed",
            entities: ctx.entities.getEntities(),
        };
    }

    console.timeEnd(timerName);

    const intentData = intentResponse.data as UserIntent;

    // Ensure action name is unique by adding a number suffix if needed
    if (
        existingActionNames &&
        existingActionNames.includes(intentData.actionName)
    ) {
        const baseName = intentData.actionName;
        let suffix = 2;
        let uniqueName = `${baseName}${suffix}`;

        while (existingActionNames.includes(uniqueName)) {
            suffix++;
            uniqueName = `${baseName}${suffix}`;
        }

        debug(
            `LLM returned duplicate action name "${baseName}", using "${uniqueName}" instead`,
        );
        intentData.actionName = uniqueName;
    }

    const { actionSchema, typeDefinition } = await getIntentSchemaFromJSON(
        intentData,
        action.parameters.recordedActionDescription,
    );

    let message = "Intent schema: \n" + actionSchema;

    const timerName2 = `Getting action schema`;
    console.time(timerName2);
    const stepsResponse = await ctx.agent.getActionStepsSchemaFromRecording(
        intentData.actionName,
        action.parameters.recordedActionDescription,
        intentData,
        recordedSteps,
        action.parameters.fragments,
        screenshots,
    );

    if (!stepsResponse.success) {
        console.error("Attempt to process recorded action failed");
        console.error(stepsResponse.message);
        return {
            displayText: "Action could not be completed",
            entities: ctx.entities.getEntities(),
            data: {
                intent: intentResponse.data,
            },
        };
    }

    console.timeEnd(timerName2);

    // AUTO-SAVE: Save authored action immediately using YAML format
    let actionId = null;
    if (intentResponse.success && stepsResponse.success) {
        try {
            debug(
                "JSON RESPONSE: Intent :\n",
                JSON.stringify(intentResponse.data),
            );
            debug(
                "JSON RESPONSE: STEPS :\n",
                JSON.stringify(stepsResponse.data),
            );

            // Direct save to ActionsStore (no longer using separate handler)
            if (!ctx.sessionContext.agentContext.macrosStore) {
                throw new Error("ActionsStore not available");
            }

            const domain = new URL(url).hostname;

            // Get macros base path - use actionsStore directory for artifacts
            const macrosBasePath = "actionsStore/macros";

            // Create YAML extension with sessionStorage for proper path handling
            const yamlExt = new YAMLMacroStoreExtension(
                ctx.sessionContext.agentContext.macrosStore,
                macrosBasePath,
                ctx.sessionContext.sessionStorage,
            );

            // Convert steps to YAML format first (needed for parameter filtering)
            // stepsResponse.data is a macrosJson object with a steps property
            const stepsArray = stepsResponse.data?.steps || [];

            // Validate: Ensure all steps have actionName (LLM sometimes omits this)
            for (let i = 0; i < stepsArray.length; i++) {
                const step = stepsArray[i];
                if (!step.actionName || typeof step.actionName !== "string") {
                    console.error(
                        `Invalid step at index ${i}:`,
                        JSON.stringify(step, null, 2),
                    );
                    throw new Error(
                        `LLM returned invalid step without actionName at index ${i}. ` +
                            `Description: "${step.description || "none"}". ` +
                            `This indicates a problem with the LLM prompt or response parsing.`,
                    );
                }
            }

            // Extract parameters first so we can pass them to convertStepsToYAML
            const parsedParams = extractParametersFromIntent(intentData);

            // Convert steps to YAML, passing parameters so values can be replaced with parameter names
            const yamlSteps = Array.isArray(stepsArray)
                ? convertStepsToYAML(stepsArray, parsedParams)
                : [];

            // Filter to only parameters actually used in steps
            const filteredParams = filterUnusedParameters(
                parsedParams,
                yamlSteps,
            );
            const yamlParameters = convertParametersToYAML(filteredParams);

            // Create full YAML macro from recording
            const { yamlMacro } = await yamlExt.createYAMLFromRecording({
                name: intentData.actionName,
                description:
                    action.parameters.recordedActionDescription ||
                    `User action: ${intentData.actionName}`,
                author: "user",
                category: "utility",
                domain,
                url,
                parameters: yamlParameters,
                steps: yamlSteps,
                ...(screenshots &&
                    screenshots.length > 0 && {
                        screenshots: screenshots,
                    }),
                recordedSteps: JSON.parse(recordedSteps || "[]"),
            });

            // Convert YAML to StoredMacro format
            const artifactsStorage = new ArtifactsStorage(
                macrosBasePath,
                ctx.sessionContext.sessionStorage,
            );
            const converter = new MacroConverter(artifactsStorage);
            const macroId = generateMacroId();
            const storedMacro = await converter.convertYAMLToJSON(
                yamlMacro,
                macroId,
            );

            // Save using standard saveMacro method
            const result =
                await ctx.sessionContext.agentContext.macrosStore.saveMacro(
                    storedMacro,
                );

            if (result.success) {
                actionId = result.macroId;
                debug(
                    `Auto-saved authored action: ${action.parameters.recordedActionName} (ID: ${actionId})`,
                );

                // Save as webFlow using the reasoning pipeline for robust scripts
                if (ctx.sessionContext.agentContext.webFlowStore) {
                    try {
                        const rawSteps = JSON.parse(recordedSteps || "[]");
                        debug(
                            `WebFlow generation: ${rawSteps.length} raw recorded steps`,
                        );
                        const recordingForNorm: RecordingData = {
                            actions: rawSteps,
                            startUrl: url,
                            description:
                                action.parameters.recordedActionDescription ||
                                `User action: ${intentData.actionName}`,
                        };

                        const trace = normalizeRecording(recordingForNorm);
                        debug(
                            `WebFlow generation: normalized to ${trace.steps.length} trace steps`,
                        );

                        let flow = await generateWebFlowFromTrace(trace, {
                            suggestedName: intentData.actionName,
                            description:
                                action.parameters.recordedActionDescription,
                        });
                        debug(
                            `WebFlow generation: LLM result = ${flow ? "success" : "null"}`,
                        );

                        // Fallback to MacroToWebFlowConverter if LLM generation fails
                        if (!flow) {
                            debug(
                                "LLM script generation failed, falling back to MacroToWebFlowConverter",
                            );
                            const savedMacro =
                                await ctx.sessionContext.agentContext.macrosStore.getMacro(
                                    macroId,
                                );
                            if (savedMacro) {
                                const converter = new MacroToWebFlowConverter();
                                flow = converter.convert(savedMacro);
                            }
                        }

                        if (flow) {
                            flow.source = {
                                type: "recording",
                                timestamp: new Date().toISOString(),
                            };
                            await ctx.sessionContext.agentContext.webFlowStore.save(
                                flow,
                            );
                            debug(`Saved as webFlow: ${flow.name}`);

                            // Auto-refresh the temp agent schema so the action is immediately available
                            await refreshDynamicAgentSchema(ctx);
                        }
                    } catch (webFlowError) {
                        debug("Failed to save as webFlow:", webFlowError);
                    }
                }
            }
        } catch (error) {
            console.warn("Failed to auto-save authored action:", error);
            // Continue without failing the intent creation
        }
    }

    return {
        displayText: message,
        entities: ctx.entities.getEntities(),
        data: {
            intent: actionSchema,
            intentJson: intentResponse.data,
            intentTypeDefinition: typeDefinition,
            actions: stepsResponse.data,
            macroId: actionId, // Include for UI feedback
        },
    };
}

async function handleGetAllMacros(
    action: GetAllMacros,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    return handleGetMacrosForUrl(
        {
            actionName: "getMacrosForUrl",
            parameters: {
                url: "",
                includeGlobal: true,
            },
        } as GetMacrosForUrl,
        ctx,
    );
}

async function handleGetMacrosForUrl(
    action: GetMacrosForUrl,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    if (!ctx.sessionContext.agentContext.macrosStore) {
        throw new Error("MacroStore not available");
    }

    const { url, includeGlobal = true, author } = action.parameters;

    try {
        let actions = [];
        if (!url) {
            actions =
                await ctx.sessionContext.agentContext.macrosStore.getAllMacros();
        } else {
            actions =
                await ctx.sessionContext.agentContext.macrosStore.getMacrosForUrl(
                    url,
                );
        }

        if (author) {
            actions = actions.filter((a: any) => a.author === author);
        }

        if (actions.length > 0) {
            const uniqueItems = new Map(
                actions.map((action) => [action.name, action]),
            );
            actions = Array.from(uniqueItems.values());
        }

        if (includeGlobal && !author) {
            const globalMacros =
                await ctx.sessionContext.agentContext.macrosStore.getGlobalMacros();
            actions.push(...globalMacros);
        }

        debug(`Retrieved ${actions.length} macros for URL: ${url}`);
        return {
            displayText: `Found ${actions.length} macros`,
            entities: ctx.entities.getEntities(),
            data: {
                actions: actions,
                count: actions.length,
            },
        };
    } catch (error) {
        console.error("Failed to get macros for URL:", error);
        return {
            displayText: "Failed to retrieve macros",
            entities: ctx.entities.getEntities(),
            data: {
                actions: [],
                count: 0,
                error: error instanceof Error ? error.message : "Unknown error",
            },
        };
    }
}

async function handleDeleteMacro(
    action: DeleteMacro,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    if (!ctx.sessionContext.agentContext.macrosStore) {
        throw new Error("MacroStore not available");
    }

    const { macroId } = action.parameters;

    try {
        const result =
            await ctx.sessionContext.agentContext.macrosStore.deleteMacro(
                macroId,
            );

        if (result.success) {
            debug(`Deleted macro: ${macroId}`);
            return {
                displayText: "Macro deleted successfully",
                entities: ctx.entities.getEntities(),
                data: {
                    success: true,
                    macroId: macroId,
                },
            };
        } else {
            console.error(`Failed to delete macro ${macroId}:`, result.error);
            return {
                displayText: "Failed to delete macro",
                entities: ctx.entities.getEntities(),
                data: {
                    success: false,
                    error: result.error,
                },
            };
        }
    } catch (error) {
        console.error("Failed to delete macro:", error);
        return {
            displayText: "Failed to delete macro",
            entities: ctx.entities.getEntities(),
            data: {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            },
        };
    }
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
        case "getIntentFromRecording":
            result = await handleGetIntentFromReccording(
                action,
                discoveryContext,
            );
            break;
        case "registerPageDynamicAgent":
            result = await handleRegisterSiteSchema(action, discoveryContext);
            break;
        case "startAuthoringSession":
            result = await handleRegisterAuthoringAgent(
                action,
                discoveryContext,
            );
            break;
        case "getMacrosForUrl":
            result = await handleGetMacrosForUrl(action, discoveryContext);
            break;
        case "getAllMacros":
            result = await handleGetAllMacros(action, discoveryContext);
            break;
        case "deleteMacro":
            result = await handleDeleteMacro(action, discoveryContext);
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
