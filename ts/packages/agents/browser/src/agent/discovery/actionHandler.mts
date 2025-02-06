// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, AppAgentManifest } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";
import { createDiscoveryPageTranslator } from "./translator.mjs";
import {
  ActionSchemaTypeDefinition,
  generateActionSchema,
  parseActionSchemaSource,
} from "action-schema";
import { ActionSchemaCreator as sc } from "action-schema";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { UserActionsList } from "./schema/userActionsPool.mjs";
import { PageDescription } from "./schema/pageSummary.mjs";
import { createTempAgentForSchema } from "./tempAgentActionHandler.mjs";

export async function handleSchemaDiscoveryAction(
  action: any,
  context: ActionContext<BrowserActionContext>,
) {
  let message = "OK";
  if (!context.sessionContext.agentContext.browserConnector) {
    throw new Error("No connection to browser session.");
  }

  const browser: BrowserConnector =
    context.sessionContext.agentContext.browserConnector;

  const agent = await createDiscoveryPageTranslator("GPT_4_O_MINI");

  switch (action.actionName) {
    case "findUserActions":
      await handleFindUserActions(action);
      break;
    case "summarizePage":
      await handleGetPageSummary(action);
      break;
    case "findPageComponents":
      await handleGetPageComponents(action);
      break;
    case "getPageType":
      await handleGetPageType(action);
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
        "Page summary: \n" + JSON.stringify(summaryResponse.data, null, 2);
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
      "Possible user actions: \n" + JSON.stringify(response.data, null, 2);

    const selected = response.data as UserActionsList;
    const actionNames = [
      ...new Set(selected.actions.map((action) => action.actionName)),
    ];

    const schema = await getDynamicSchema(actionNames);
    message += `\n =========== \n Discovered actions schema: \n ${schema} `;

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
        await context.sessionContext.addDynamicAgent(
          "tempPageSchema",
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

    const timerName = `Getting page layout`;
    console.time(timerName);
    const response = await agent.getPageType(
      undefined,
      htmlFragments,
      undefined,
    );

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

  return message;
}
