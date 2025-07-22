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
    DeleteAction,
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
        case "deleteAction":
            actionData = await handleDeleteAction(action);
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

        // AUTO-SAVE: Save discovered actions immediately
        if (uniqueItems.size > 0) {
            try {
                const url = await getBrowserControl(agentContext).getPageUrl();

                // Direct save to ActionsStore (no longer using separate handler)
                if (!agentContext.actionsStore) {
                    throw new Error("ActionsStore not available");
                }

                const domain = new URL(url!).hostname;
                let savedCount = 0;
                let skippedCount = 0;

                // Get existing actions for this URL to check for duplicates
                const existingActions =
                    await agentContext.actionsStore.getActionsForUrl(url!);
                const existingActionNames = new Set(
                    existingActions
                        .filter((action) => action.author === "discovered")
                        .map((action) => action.name),
                );

                for (const actionData of Array.from(
                    uniqueItems.values(),
                ) as any) {
                    if (!actionData.actionName) continue;

                    // Check if action with same name already exists for this URL
                    if (existingActionNames.has(actionData.actionName)) {
                        skippedCount++;
                        console.log(
                            `Skipping duplicate discovered action: ${actionData.actionName}`,
                        );
                        continue;
                    }

                    const storedAction =
                        agentContext.actionsStore.createDefaultAction({
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
                                actionDefinition:
                                    typeDefinitions[actionData.actionName],
                            },
                        });

                    const result =
                        await agentContext.actionsStore.saveAction(
                            storedAction,
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

                console.log(
                    `Auto-saved ${savedCount} new discovered actions for ${domain} (skipped ${skippedCount} existing)`,
                );
            } catch (error) {
                console.warn("Failed to auto-save discovered actions:", error);
                // Continue without failing the discovery operation
            }
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

        if (!agentContext.actionsStore) {
            throw new Error(
                "ActionsStore not available - please ensure TypeAgent server is running",
            );
        }

        console.log("Using ActionsStore for schema registration");
        const urlActions = await agentContext.actionsStore.getActionsForUrl(
            url!,
        );

        const detectedActions = new Map<string, any>();
        const authoredActions = new Map<string, any>();

        for (const storedAction of urlActions) {
            if (storedAction.definition.actionDefinition) {
                detectedActions.set(
                    storedAction.name,
                    storedAction.definition.actionDefinition,
                );
            }
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

        // AUTO-SAVE: Save authored action immediately
        let actionId = null;
        if (intentResponse.success && stepsResponse.success) {
            try {
                const url = await getBrowserControl(agentContext).getPageUrl();

                // Direct save to ActionsStore (no longer using separate handler)
                if (!agentContext.actionsStore) {
                    throw new Error("ActionsStore not available");
                }

                const domain = new URL(url).hostname;

                const storedAction =
                    agentContext.actionsStore.createDefaultAction({
                        name: intentData.actionName,
                        description:
                            action.parameters.recordedActionDescription ||
                            `User action: ${intentData.actionName}`,
                        category: inferCategoryFromAction({
                            name: intentData.actionName,
                            description:
                                action.parameters.recordedActionDescription,
                        }) as ActionCategory,
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
                                                          param.type ===
                                                              "string" ||
                                                          param.type ===
                                                              "number" ||
                                                          param.type ===
                                                              "boolean"
                                                              ? param.type
                                                              : "string",
                                                      required:
                                                          param.required ??
                                                          false,
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
                                                        typeof value ===
                                                            "string" ||
                                                        typeof value ===
                                                            "number" ||
                                                        typeof value ===
                                                            "boolean"
                                                            ? typeof value
                                                            : "string",
                                                    required: false,
                                                    defaultValue: value,
                                                }))
                                              : [],
                                    },
                                }),
                            actionsJson: stepsResponse.data,
                            actionDefinition: typeDefinition,
                            description:
                                action.parameters.recordedActionDescription,
                            screenshot: action.parameters.screenshots,
                            steps: JSON.parse(recordedSteps || "[]"),
                        },
                    });

                const result =
                    await agentContext.actionsStore.saveAction(storedAction);

                if (result.success) {
                    actionId = result.actionId;
                    console.log(
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
            intent: actionSchema,
            intentJson: intentResponse.data,
            intentTypeDefinition: typeDefinition,
            actions: stepsResponse.data,
            actionId: actionId, // Include for UI feedback
        };
    }

    async function handleGetActionsForUrl(action: GetActionsForUrl) {
        if (!agentContext.actionsStore) {
            throw new Error("ActionsStore not available");
        }

        const { url, includeGlobal = true, author } = action.parameters;

        try {
            let actions = [];
            if (!url) {
                actions = await agentContext.actionsStore.getAllActions();
            } else {
                actions = await agentContext.actionsStore.getActionsForUrl(url);
            }

            if (author) {
                actions = actions.filter((a) => a.author === author);
            }

            if (includeGlobal && !author) {
                const globalActions =
                    await agentContext.actionsStore.getGlobalActions();
                actions.push(...globalActions);
            }

            console.log(`Retrieved ${actions.length} actions for URL: ${url}`);
            return {
                actions: actions,
                count: actions.length,
            };
        } catch (error) {
            console.error("Failed to get actions for URL:", error);
            return {
                actions: [],
                count: 0,
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }
    }

    async function handleDeleteAction(action: DeleteAction) {
        if (!agentContext.actionsStore) {
            throw new Error("ActionsStore not available");
        }

        const { actionId } = action.parameters;

        try {
            const result =
                await agentContext.actionsStore.deleteAction(actionId);

            if (result.success) {
                console.log(`Deleted action: ${actionId}`);
                return {
                    success: true,
                    actionId: actionId,
                };
            } else {
                console.error(
                    `Failed to delete action ${actionId}:`,
                    result.error,
                );
                return {
                    success: false,
                    error: result.error,
                };
            }
        } catch (error) {
            console.error("Failed to delete action:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }
    }

    // Helper function to infer action category
    function inferCategoryFromAction(actionData: any): ActionCategory {
        const name = actionData.name?.toLowerCase() || "";
        const description = actionData.description?.toLowerCase() || "";
        const steps = actionData.steps || [];

        // Check for form-related actions
        if (
            name.includes("form") ||
            name.includes("submit") ||
            name.includes("input") ||
            description.includes("form") ||
            description.includes("submit") ||
            steps.some(
                (step: any) => step.type === "type" || step.type === "submit",
            )
        ) {
            return "form";
        }

        // Check for navigation actions
        if (
            name.includes("navigate") ||
            name.includes("link") ||
            name.includes("click") ||
            description.includes("navigate") ||
            description.includes("link") ||
            steps.some(
                (step: any) =>
                    step.type === "click" && step.target?.includes("a"),
            )
        ) {
            return "navigation";
        }

        // Check for commerce actions
        if (
            name.includes("buy") ||
            name.includes("cart") ||
            name.includes("checkout") ||
            name.includes("purchase") ||
            description.includes("buy") ||
            description.includes("cart") ||
            description.includes("checkout")
        ) {
            return "commerce";
        }

        // Check for search actions
        if (
            name.includes("search") ||
            name.includes("find") ||
            name.includes("filter") ||
            description.includes("search") ||
            description.includes("find")
        ) {
            return "search";
        }

        // Default to utility
        return "utility";
    }

    return {
        displayText: message,
        data: actionData,
    };
}
