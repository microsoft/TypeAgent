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
import { ActionSchemaCreator as sc } from "action-schema";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { UserActionsList } from "./schema/userActionsPool.mjs";
import { PageDescription } from "./schema/pageSummary.mjs";
import { createTempAgentForSchema } from "./tempAgentActionHandler.mjs";
import { SchemaDiscoveryActions } from "./schema/discoveryActions.mjs";
import { UserIntent } from "./schema/recordedActions.mjs";

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
        case "initializePageSchema":
        case "findUserActions":
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
    }

    async function handleFindUserActions(action: any) {
        const htmlFragments = await browser.getHtmlFragments();
        // const screenshot = await browser.getCurrentPageScreenshot();
        const screenshot = "";
        let pageSummary = "";

        const summaryResponse = await agent.getPageSummary(
            undefined,
            htmlFragments,
            screenshot,
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
            screenshot,
            pageSummary,
        );

        if (!response.success) {
            console.error("Attempt to get page actions failed");
            console.error(response.message);
            message = "Action could not be completed";
            return;
        }

        console.timeEnd(timerName);

        message =
            "Possible user actions: \n" +
            JSON.stringify(response.data, null, 2);

        const selected = response.data as UserActionsList;
        const actionNames = [
            ...new Set(selected.actions.map((action) => action.actionName)),
        ];

        const schema = await getDynamicSchema(actionNames);
        message += `\n =========== \n Discovered actions schema: \n ${schema} `;

        const url = await browser.getPageUrl();
        const hostName = new URL(url!).hostname.replace(/\./g, "_");
        const agentName = `temp_${hostName}`;

        if (action.parameters.registerAgent) {
            const manifest: AppAgentManifest = {
                emojiChar: "🚧",
                description: schemaDescription,
                schema: {
                    description: schemaDescription,
                    schemaType: "DynamicUserPageActions",
                    schemaFile: { content: schema, type: "ts" },
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

        return response.data;
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
            "",
            "UserPageActions",
        );

        let typeDefinitions: ActionSchemaTypeDefinition[] = [];
        actionNames.forEach((name) => {
            if (parsed.actionSchemas.has(name)) {
                typeDefinitions.push(parsed.actionSchemas.get(name)!);
            }
        });

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

        return schema;
    }

    async function handleGetPageSummary(action: any) {
        const htmlFragments = await browser.getHtmlFragments();
        const timerName = `Summarizing page`;
        console.time(timerName);
        const response = await agent.getPageSummary(undefined, htmlFragments);

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
        const timerName = `Getting page layout`;
        console.time(timerName);
        const response = await agent.getPageLayout(undefined, htmlFragments);

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

        const timerName = `Getting page type`;
        console.time(timerName);
        const response = await agent.getPageType(
            undefined,
            htmlFragments,
            undefined,
        );

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

        const timerName = `Getting website category`;
        console.time(timerName);
        const response = await agent.getSiteType(
            undefined,
            htmlFragments,
            undefined,
        );

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

        userIntentJson.parameters.forEach((p) => {
            let t: ActionParamType = sc.string();
            switch (p.type) {
                case "string":
                    t = sc.string();
                    break;
                case "number":
                    t = sc.number();
                    break;
                case "boolean":
                    t = sc.number();
                    break;
            }

            if (p.required && !p.defaultValue) {
                fields.set(p.shortName, sc.field(t, p.description));
            } else {
                fields.set(p.shortName, sc.optional(t, p.description));
            }
        });

        const obj: ActionSchemaObject = sc.obj({
            actionName: sc.string(userIntentJson.actiontName),
            parameters: sc.obj(Object.fromEntries(fields)),
        } as const);

        const schema = sc.type(
            userIntentJson.actiontName,
            obj,
            actionDescription,
            true,
        );

        return await generateSchemaTypeDefinition(schema, { exact: true });
    }

    async function handleGetIntentFromReccording(action: any) {
        const timerName = `Getting intent schema`;
        console.time(timerName);
        const intentResponse = await agent.getIntentSchemaFromRecording(
            action.parameters.recordedActionName,
            action.parameters.recordedActionDescription,
            action.parameters.recordedActionSteps,
            action.parameters.htmlFragments,
            // action.parameters.screenshot,
            "",
        );

        if (!intentResponse.success) {
            console.error("Attempt to process recorded action failed");
            console.error(intentResponse.message);
            message = "Action could not be completed";
            return;
        }

        console.timeEnd(timerName);

        const intentSchema = await getIntentSchemaFromJSON(
            intentResponse.data as UserIntent,
            action.parameters.recordedActionDescription,
        );

        message = "Intent schema: \n" + intentSchema;

        const timerName2 = `Getting action schema`;
        console.time(timerName2);
        const stepsResponse = await agent.getActionStepsSchemaFromRecording(
            action.parameters.recordedActionName,
            action.parameters.recordedActionDescription,
            intentResponse.data,
            action.parameters.recordedActionSteps,
            action.parameters.htmlFragments,
            // action.parameters.screenshot,
            "",
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
            intent: intentSchema,
            intentJson: intentResponse.data,
            actions: stepsResponse.data,
        };
    }

    //

    return {
        displayText: message,
        data: actionData,
    };
}
