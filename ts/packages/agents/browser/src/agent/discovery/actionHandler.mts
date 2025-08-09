// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentManifest, SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext, getBrowserControl } from "../actionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";
import { createDiscoveryPageTranslator } from "./translator.mjs";
import {
    ActionSchemaTypeDefinition,
    ActionSchemaObject,
    ActionParamType,
    generateActionSchema,
    parseActionSchemaSource,
    generateSchemaTypeDefinition,
} from "action-schema";
import { SchemaCreator as sc } from "action-schema";
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
    browser: BrowserConnector;
    agent: any;
    entities: EntityCollector;
    sessionContext: SessionContext<BrowserActionContext>;
}

async function handleFindUserActions(
    action: any,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const htmlFragments = await ctx.browser.getHtmlFragments();
    const screenshot = await ctx.browser.getCurrentPageScreenshot();
    let pageSummary = "";

    const summaryResponse = await ctx.agent.getPageSummary(
        undefined,
        htmlFragments,
        [screenshot],
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
        [screenshot],
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

    const { schema, typeDefinitions } = await getDynamicSchema(actionNames);
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
            const url = await getBrowserControl(
                ctx.sessionContext.agentContext,
            ).getPageUrl();

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

async function getDynamicSchema(actionNames: string[]) {
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

async function handleGetPageSummary(
    action: any,
    ctx: DiscoveryActionHandlerContext,
): Promise<DiscoveryActionResult> {
    const htmlFragments = await ctx.browser.getHtmlFragments();
    const screenshot = await ctx.browser.getCurrentPageScreenshot();
    const timerName = `Summarizing page`;
    console.time(timerName);
    const response = await ctx.agent.getPageSummary(undefined, htmlFragments, [
        screenshot,
    ]);

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

    const detectedActions = new Map<string, any>();
    const authoredActions = new Map<string, any>();

    for (const storedMacro of urlActions) {
        if (storedMacro.definition.macroDefinition) {
            detectedActions.set(
                storedMacro.name,
                storedMacro.definition.macroDefinition,
            );
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
        try {
            await ctx.sessionContext.removeDynamicAgent(agentName);
        } catch {}

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
        } catch (error) {
            console.error("Failed to register dynamic agent:", error);
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
                action.parameters.screenshots,
            );
        if (descriptionResponse.success) {
            debug(descriptionResponse.data);
            recordedSteps = JSON.stringify(
                (descriptionResponse.data as any).actions,
            );
        }
    }

    const timerName = `Getting intent schema`;
    console.time(timerName);
    const intentResponse = await ctx.agent.getIntentSchemaFromRecording(
        action.parameters.recordedActionName,
        action.parameters.existingActionNames,
        action.parameters.recordedActionDescription,
        recordedSteps,
        action.parameters.fragments,
        action.parameters.screenshots,
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
        action.parameters.screenshots,
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

    // AUTO-SAVE: Save authored action immediately
    let actionId = null;
    if (intentResponse.success && stepsResponse.success) {
        try {
            const url = await getBrowserControl(
                ctx.sessionContext.agentContext,
            ).getPageUrl();

            // Direct save to ActionsStore (no longer using separate handler)
            if (!ctx.sessionContext.agentContext.macrosStore) {
                throw new Error("ActionsStore not available");
            }

            const domain = new URL(url).hostname;

            const storedMacro =
                ctx.sessionContext.agentContext.macrosStore.createDefaultMacro({
                    name: intentData.actionName,
                    description:
                        action.parameters.recordedActionDescription ||
                        `User action: ${intentData.actionName}`,
                    category: "utility",
                    author: "user",
                    scope: {
                        type: "page",
                        domain: domain,
                        priority: 80,
                    },
                    urlPatterns: [
                        {
                            pattern: url,
                            type: "exact",
                            priority: 100,
                            description: `Exact match for ${url}`,
                        },
                    ],
                    definition: {
                        ...(actionSchema && { intentSchema: actionSchema }),
                        ...(stepsResponse.data &&
                            Array.isArray(stepsResponse.data) && {
                                actionSteps: stepsResponse.data,
                            }),
                        ...(intentData.actionName &&
                            intentData.parameters && {
                                intentJson: {
                                    actionName: intentData.actionName,
                                    parameters: Array.isArray(
                                        intentData.parameters,
                                    )
                                        ? intentData.parameters.map(
                                              (param: any) => ({
                                                  shortName:
                                                      param.shortName ||
                                                      param.name ||
                                                      "unknown",
                                                  description:
                                                      param.description ||
                                                      param.name ||
                                                      "Parameter",
                                                  type:
                                                      param.type === "string" ||
                                                      param.type === "number" ||
                                                      param.type === "boolean"
                                                          ? param.type
                                                          : "string",
                                                  required:
                                                      param.required ?? false,
                                                  defaultValue:
                                                      param.defaultValue,
                                              }),
                                          )
                                        : intentData.parameters
                                          ? Object.entries(
                                                intentData.parameters,
                                            ).map(([key, value]) => ({
                                                shortName: key,
                                                description: `Parameter ${key}`,
                                                type:
                                                    typeof value === "string" ||
                                                    typeof value === "number" ||
                                                    typeof value === "boolean"
                                                        ? typeof value
                                                        : "string",
                                                required: false,
                                                defaultValue: value,
                                            }))
                                          : [],
                                },
                            }),
                        macrosJson: stepsResponse.data,
                        macroDefinition: typeDefinition,
                        description:
                            action.parameters.recordedActionDescription,
                        screenshot: action.parameters.screenshots,
                        steps: JSON.parse(recordedSteps || "[]"),
                    },
                });

            const result =
                await ctx.sessionContext.agentContext.macrosStore.saveMacro(
                    storedMacro,
                );

            if (result.success) {
                actionId = result.macroId;
                debug(
                    `Auto-saved authored action: ${action.parameters.recordedActionName}`,
                );
            } else {
                console.warn(
                    `Failed to auto-save authored action: ${result.error}`,
                );
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
    if (!context.agentContext.browserConnector) {
        throw new Error("No connection to browser session.");
    }

    const browser: BrowserConnector = context.agentContext.browserConnector;
    const agent = await createDiscoveryPageTranslator("GPT_4_O");

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
