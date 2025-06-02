// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgentManifest, SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
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
} from "./schema/discoveryActions.mjs";
import { UserIntent } from "./schema/recordedActions.mjs";
import { createSchemaAuthoringAgent } from "./authoringActionHandler.mjs";

export async function handleSchemaDiscoveryAction(
    action: SchemaDiscoveryActions,
    context: SessionContext<BrowserActionContext>,
) {
    let message = "OK";
    let actionData: any;
    if (!context.agentContext.browserConnector) {
        throw new Error("No connection to browser session.");
    }

    const browser: BrowserConnector = context.agentContext.browserConnector;

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

        const url = await browser.getPageUrl();
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
        const url = await browser.getPageUrl();
        const detectedActions = new Map(
            Object.entries(
                (await browser.getCurrentPageStoredProperty(
                    url!,
                    "detectedActionDefinitions",
                )) ?? {},
            ),
        );
        const authoredActions = new Map(
            Object.entries(
                (await browser.getCurrentPageStoredProperty(
                    url!,
                    "authoredActionDefinitions",
                )) ?? {},
            ),
        );
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

    return {
        displayText: message,
        data: actionData,
    };
}
