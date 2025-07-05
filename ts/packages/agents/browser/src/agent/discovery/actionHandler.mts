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
    GetActionsForUrl,
    SaveDiscoveredActions,
    SaveAuthoredAction,
} from "./schema/discoveryActions.mjs";
import { UserIntent } from "./schema/recordedActions.mjs";
import { createSchemaAuthoringAgent } from "./authoringActionHandler.mjs";
import { ActionCategory } from "../storage/types.mjs";

export async function handleSchemaDiscoveryAction(
    action: SchemaDiscoveryActions,
    context: SessionContext<BrowserActionContext>,
) {
    let message = "OK";
    let actionData: any;
    const agentContext = context.agentContext;
    if (!agentContext.browserConnector) {
        throw new Error("No connection to browser session.");
    }

    const browser: BrowserConnector = agentContext.browserConnector;

    // const agent = await createDiscoveryPageTranslator("GPT_4_O_MINI");
    const agent = await createDiscoveryPageTranslator("GPT_4_O");

    switch (action.actionName) {
        case "detectPageActions":
            actionData = await handleFindUserActions(action);
            break;
        case "summarizePage":
            actionData = await handleGetPageSummary(action);
            break;
        case "findPageComponents":
            actionData = await handleGetPageComponents(action);
            break;
        case "getPageType":
            actionData = await handleGetPageType(action);
            break;
        case "getSiteType":
            actionData = await handleGetSiteType(action);
            break;
        case "getIntentFromRecording":
            actionData = await handleGetIntentFromReccording(action);
            break;
        case "registerPageDynamicAgent":
            actionData = await handleRegisterSiteSchema(action);
            break;
        case "startAuthoringSession":
            actionData = await handleRegisterAuthoringAgent(action);
            break;
        case "getActionsForUrl":
            actionData = await handleGetActionsForUrl(action);
            break;
        case "saveDiscoveredActions":
            actionData = await handleSaveDiscoveredActions(action);
            break;
        case "saveAuthoredAction":
            actionData = await handleSaveAuthoredAction(action);
            break;
    }

    async function handleFindUserActions(action: any) {
        const htmlFragments = await browser.getHtmlFragments();
        const screenshot = await browser.getCurrentPageScreenshot();
        let pageSummary = "";

        const summaryResponse = await agent.getPageSummary(
            undefined,
            htmlFragments,
            [screenshot],
        );

        let schemaDescription =
            "A schema that enables interactions with the current page";
        if (summaryResponse.success) {
            pageSummary =
                "Page summary: \n" +
                JSON.stringify(summaryResponse.data, null, 2);
            schemaDescription += (summaryResponse.data as PageDescription)
                .description;
        }

        const timerName = `Analyzing page actions`;
        console.time(timerName);

        const response = await agent.getCandidateUserActions(
            undefined,
            htmlFragments,
            [screenshot],
            pageSummary,
        );

        if (!response.success) {
            console.error("Attempt to get page actions failed");
            console.error(response.message);
            message = "Action could not be completed";
            return;
        }

        console.timeEnd(timerName);

        const selected = response.data as UserActionsList;
        const uniqueItems = new Map(
            selected.actions.map((action) => [action.actionName, action]),
        );

        message =
            "Possible user actions: \n" +
            JSON.stringify(Array.from(uniqueItems.values()), null, 2);

        const actionNames = [...new Set(uniqueItems.keys())];

        const { schema, typeDefinitions } = await getDynamicSchema(actionNames);
        message += `\n =========== \n Discovered actions schema: \n ${schema} `;

        const url = await getBrowserControl(agentContext).getPageUrl();
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
                    await context.removeDynamicAgent(agentName);
                } catch {}

                await context.addDynamicAgent(
                    agentName,
                    manifest,
                    createTempAgentForSchema(browser, agent, context),
                );
            }, 500);
        }

        return {
            schema: Array.from(uniqueItems.values()),
            typeDefinitions: typeDefinitions,
        };
    }

    async function handleRegisterAuthoringAgent(action: any) {
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
                await context.removeDynamicAgent(agentName);
            } catch {}

            await context.addDynamicAgent(
                agentName,
                manifest,
                createSchemaAuthoringAgent(browser, agent, context),
            );
        }, 500);
    }

    async function handleRegisterSiteSchema(action: any) {
        const url = await getBrowserControl(agentContext).getPageUrl();
        
        // Use ActionsStore if available, otherwise fall back to legacy storage
        let detectedActions: Map<string, any>;
        let authoredActions: Map<string, any>;
        
        if (agentContext.actionsStore) {
            // NEW: Direct ActionsStore access
            console.log("Using ActionsStore for schema registration");
            const urlActions = await agentContext.actionsStore.getActionsForUrl(url!);
            
            detectedActions = new Map();
            authoredActions = new Map();
            
            for (const storedAction of urlActions) {
                if (storedAction.author === "discovered" && storedAction.definition.intentSchema) {
                    detectedActions.set(storedAction.name, storedAction.definition.intentSchema);
                } else if (storedAction.author === "user" && storedAction.definition.intentSchema) {
                    authoredActions.set(storedAction.name, storedAction.definition.intentSchema);
                }
            }
        } else {
            // LEGACY: Browser connector access
            console.log("Falling back to legacy storage for schema registration");
            detectedActions = new Map(
                Object.entries(
                    (await browser.getCurrentPageStoredProperty(
                        url!,
                        "detectedActionDefinitions",
                    )) ?? {},
                ),
            );
            authoredActions = new Map(
                Object.entries(
                    (await browser.getCurrentPageStoredProperty(
                        url!,
                        "authoredActionDefinitions",
                    )) ?? {},
                ),
            );
        }
        
        const typeDefinitions: ActionSchemaTypeDefinition[] = [
            ...detectedActions.values(),
            ...authoredActions.values(),
        ];

        if (typeDefinitions.length === 0) {
            console.log("No actions for this schema.");
            return;
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
                await context.removeDynamicAgent(agentName);
            } catch {}

            await context.addDynamicAgent(
                agentName,
                manifest,
                createTempAgentForSchema(browser, agent, context),
            );
        }, 500);

        return { schema: schema, typeDefinitions: typeDefinitions };
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

    async function handleGetPageSummary(action: any) {
        const htmlFragments = await browser.getHtmlFragments();
        const screenshot = await browser.getCurrentPageScreenshot();
        const timerName = `Summarizing page`;
        console.time(timerName);
        const response = await agent.getPageSummary(undefined, htmlFragments, [
            screenshot,
        ]);

        if (!response.success) {
            console.error("Attempt to get page summary failed");
            console.error(response.message);
            message = "Action could not be completed";
            return;
        }

        console.timeEnd(timerName);
        message = "Page summary: \n" + JSON.stringify(response.data, null, 2);
        return response.data;
    }

    async function handleGetPageComponents(action: any) {
        const htmlFragments = await browser.getHtmlFragments();
        const screenshot = await browser.getCurrentPageScreenshot();
        const timerName = `Getting page layout`;
        console.time(timerName);
        const response = await agent.getPageLayout(undefined, htmlFragments, [
            screenshot,
        ]);

        if (!response.success) {
            console.error("Attempt to get page layout failed");
            console.error(response.message);
            message = "Action could not be completed";
            return;
        }

        console.timeEnd(timerName);
        message = "Page layout: \n" + JSON.stringify(response.data, null, 2);

        return response.data;
    }

    async function handleGetPageType(action: any) {
        const htmlFragments = await browser.getHtmlFragments();
        const screenshot = await browser.getCurrentPageScreenshot();

        const timerName = `Getting page type`;
        console.time(timerName);
        const response = await agent.getPageType(undefined, htmlFragments, [
            screenshot,
        ]);

        if (!response.success) {
            console.error("Attempt to get page type failed");
            console.error(response.message);
            message = "Action could not be completed";
            return;
        }

        console.timeEnd(timerName);
        message = "Page type: \n" + JSON.stringify(response.data, null, 2);

        return response.data;
    }

    async function handleGetSiteType(action: any) {
        const htmlFragments = await browser.getHtmlFragments();
        const screenshot = await browser.getCurrentPageScreenshot();

        const timerName = `Getting website category`;
        console.time(timerName);
        const response = await agent.getSiteType(undefined, htmlFragments, [
            screenshot,
        ]);

        if (!response.success) {
            console.error("Attempt to get page website category failed");
            console.error(response.message);
            message = "Action could not be completed";
            return;
        }

        console.timeEnd(timerName);
        message =
            "Website Category: \n" + JSON.stringify(response.data, null, 2);

        return response.data;
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
                fields.set(
                    param.shortName,
                    sc.field(paramType, param.description),
                );
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

    async function handleGetIntentFromReccording(
        action: GetIntentFromRecording,
    ) {
        let recordedSteps = action.parameters.recordedActionSteps;
        if (
            recordedSteps === undefined ||
            recordedSteps === "" ||
            recordedSteps === "[]"
        ) {
            const descriptionResponse =
                await agent.getDetailedStepsFromDescription(
                    action.parameters.recordedActionName,
                    action.parameters.recordedActionDescription,
                    action.parameters.fragments,
                    action.parameters.screenshots,
                );
            if (descriptionResponse.success) {
                console.log(descriptionResponse.data);
                recordedSteps = JSON.stringify(
                    (descriptionResponse.data as any).actions,
                );
            }
        }

        const timerName = `Getting intent schema`;
        console.time(timerName);
        const intentResponse = await agent.getIntentSchemaFromRecording(
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
            message = "Action could not be completed";
            return;
        }

        console.timeEnd(timerName);

        const intentData = intentResponse.data as UserIntent;
        const { actionSchema, typeDefinition } = await getIntentSchemaFromJSON(
            intentData,
            action.parameters.recordedActionDescription,
        );

        message = "Intent schema: \n" + actionSchema;

        const timerName2 = `Getting action schema`;
        console.time(timerName2);
        const stepsResponse = await agent.getActionStepsSchemaFromRecording(
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
            message = "Action could not be completed";
            return {
                intent: intentResponse.data,
            };
        }

        console.timeEnd(timerName2);

        return {
            intent: actionSchema,
            intentJson: intentResponse.data,
            intentTypeDefinition: typeDefinition,
            actions: stepsResponse.data,
        };
    }

    // NEW: ActionsStore integration handlers
    async function handleGetActionsForUrl(action: GetActionsForUrl) {
        if (!agentContext.actionsStore) {
            throw new Error("ActionsStore not available");
        }

        const { url, includeGlobal = true, author } = action.parameters;
        
        try {
            let actions = await agentContext.actionsStore.getActionsForUrl(url);
            
            // Filter by author if specified
            if (author) {
                actions = actions.filter(a => a.author === author);
            }
            
            // Add global actions if requested
            if (includeGlobal && !author) {
                const globalActions = await agentContext.actionsStore.getGlobalActions();
                actions.push(...globalActions);
            }

            console.log(`Retrieved ${actions.length} actions for URL: ${url}`);
            return {
                actions: actions,
                count: actions.length
            };
        } catch (error) {
            console.error("Failed to get actions for URL:", error);
            return {
                actions: [],
                count: 0,
                error: error instanceof Error ? error.message : "Unknown error"
            };
        }
    }

    async function handleSaveDiscoveredActions(action: SaveDiscoveredActions) {
        if (!agentContext.actionsStore) {
            throw new Error("ActionsStore not available");
        }

        const { url, actions, actionDefinitions } = action.parameters;
        
        try {
            const domain = new URL(url).hostname;
            let savedCount = 0;

            for (const actionData of actions) {
                if (!actionData.actionName) continue;

                const storedAction = agentContext.actionsStore.createDefaultAction({
                    name: actionData.actionName,
                    description: `Auto-discovered: ${actionData.actionName}`,
                    category: "utility",
                    author: "discovered",
                    scope: {
                        type: "domain",
                        domain: domain,
                        priority: 60
                    },
                    definition: {
                        detectedSchema: actionData,
                        intentSchema: actionDefinitions?.[actionData.actionName]
                    }
                });

                const result = await agentContext.actionsStore.saveAction(storedAction);
                if (result.success) {
                    savedCount++;
                } else {
                    console.error(`Failed to save discovered action ${actionData.actionName}:`, result.error);
                }
            }

            console.log(`Saved ${savedCount} discovered actions for ${domain}`);
            return {
                saved: savedCount,
                total: actions.length
            };
        } catch (error) {
            console.error("Failed to save discovered actions:", error);
            return {
                saved: 0,
                total: actions.length,
                error: error instanceof Error ? error.message : "Unknown error"
            };
        }
    }

    async function handleSaveAuthoredAction(action: SaveAuthoredAction) {
        if (!agentContext.actionsStore) {
            throw new Error("ActionsStore not available");
        }

        const { url, actionData } = action.parameters;
        
        try {
            const domain = new URL(url).hostname;

            const storedAction = agentContext.actionsStore.createDefaultAction({
                name: actionData.name,
                description: actionData.description || `User action: ${actionData.name}`,
                category: inferCategoryFromAction(actionData) as ActionCategory,
                author: "user",
                scope: {
                    type: "page",
                    domain: domain,
                    priority: 80
                },
                urlPatterns: [{
                    pattern: url,
                    type: "exact",
                    priority: 100,
                    description: `Exact match for ${url}`
                }],
                definition: {
                    ...(actionData.intentSchema && { intentSchema: actionData.intentSchema }),
                    ...(actionData.actionsJson && { actionSteps: actionData.actionsJson }),
                    ...(actionData.intentJson && { intentJson: actionData.intentJson })
                },
                context: {
                    ...(actionData.steps && { recordedSteps: actionData.steps }),
                    ...(actionData.screenshot && { screenshots: actionData.screenshot }),
                    ...(actionData.html && { htmlFragments: actionData.html })
                }
            });

            const result = await agentContext.actionsStore.saveAction(storedAction);
            
            if (result.success) {
                console.log(`Saved authored action: ${actionData.name}`);
                return {
                    success: true,
                    actionId: result.actionId
                };
            } else {
                console.error(`Failed to save authored action ${actionData.name}:`, result.error);
                return {
                    success: false,
                    error: result.error
                };
            }
        } catch (error) {
            console.error("Failed to save authored action:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error"
            };
        }
    }

    // Helper function to infer action category
    function inferCategoryFromAction(actionData: any): ActionCategory {
        const name = actionData.name?.toLowerCase() || '';
        const description = actionData.description?.toLowerCase() || '';
        const steps = actionData.steps || [];

        // Check for form-related actions
        if (name.includes('form') || name.includes('submit') || name.includes('input') ||
            description.includes('form') || description.includes('submit') ||
            steps.some((step: any) => step.type === 'type' || step.type === 'submit')) {
            return 'form';
        }

        // Check for navigation actions
        if (name.includes('navigate') || name.includes('link') || name.includes('click') ||
            description.includes('navigate') || description.includes('link') ||
            steps.some((step: any) => step.type === 'click' && step.target?.includes('a'))) {
            return 'navigation';
        }

        // Check for commerce actions
        if (name.includes('buy') || name.includes('cart') || name.includes('checkout') ||
            name.includes('purchase') || description.includes('buy') ||
            description.includes('cart') || description.includes('checkout')) {
            return 'commerce';
        }

        // Check for search actions
        if (name.includes('search') || name.includes('find') || name.includes('filter') ||
            description.includes('search') || description.includes('find')) {
            return 'search';
        }

        // Default to utility
        return 'utility';
    }

    return {
        displayText: message,
        data: actionData,
    };
}
