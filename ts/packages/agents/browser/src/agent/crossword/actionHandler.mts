// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import jp from "jsonpath";
import { DispatcherAgentContext } from "@typeagent/agent-sdk";
import { Crossword } from "./schema/pageSchema.mjs";
import { CrosswordPresence } from "./schema/pageFrame.mjs";
import { createCrosswordPageTranslator } from "./translator.mjs";
import { BrowserActionContext } from "../browserActionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";

export async function getBoardSchema(
  context: DispatcherAgentContext<BrowserActionContext>,
) {
  if (!context.context.browserConnector) {
    throw new Error("No connection to browser session.");
  }

  const browser: BrowserConnector = context.context.browserConnector;
  const url = await browser.getPageUrl();
  const cachedSchema = await browser.getCurrentPageSchema(url);
  if (cachedSchema) {
    return cachedSchema as Crossword;
  } else {
    const htmlFragments = await browser.getHtmlFragments();
    const agent = await createCrosswordPageTranslator("GPT_4_O");

    let candidateFragments = [];
    let pagePromises = [];

    for (let i = 0; i < htmlFragments.length; i++) {
      // skip html fragments that are too short to contain crossword
      if (
        htmlFragments[i].content.length < 500 ||
        !htmlFragments[i].text ||
        htmlFragments[i].text.length < 200
      ) {
        continue;
      }

      pagePromises.push(agent.checkIsCrosswordOnPage([htmlFragments[i]]));
    }

    const pageResults = await Promise.all(pagePromises);

    for (let i = 0; i < pageResults.length; i++) {
      const isPresent = pageResults[i];

      if (isPresent.success) {
        const result = isPresent.data as CrosswordPresence;
        if (result.crossWordPresent) {
          candidateFragments.push({
            frameId: htmlFragments[i].frameId,
            content: htmlFragments[i].content,
          });
        }
      }
    }

    /*
    const filteredFragments = await getFilteredHtmlFragments(
      candidateFragments,
      context,
    );
*/

    if (candidateFragments.length > 0) {
      let cluePromises = [];
      for (let i = 0; i < candidateFragments.length; i++) {
        cluePromises.push(
          // agent.getCluesTextWithSelectors([candidateFragments[i]]),
          agent.getCluesTextThenSelectors([candidateFragments[i]]),
        );
      }

      const clueResults = await Promise.all(cluePromises);

      for (let i = 0; i < clueResults.length; i++) {
        const cluesResponse = clueResults[i];

        if (cluesResponse && cluesResponse.success) {
          if (cluesResponse.data) {
            const data = cluesResponse.data as Crossword;
            if (data.across.length > 3 && data.down.length > 3) {
              // save schema to cache
              await browser.setCurrentPageSchema(url!, data);
              return data;
            }
          }
        }
      }

      console.log("Page schema not initialized");
    }
  }
  return undefined;
}

export async function handleCrosswordAction(
  action: any,
  context: DispatcherAgentContext<BrowserActionContext>,
) {
  let message = "OK";
  if (!context.context.browserConnector) {
    throw new Error("No connection to browser session.");
  }

  const browser: BrowserConnector = context.context.browserConnector;

  if (context.context.crossWordState) {
    const actionName =
      action.actionName ?? action.fullActionName.split(".").at(-1);
    if (actionName === "enterText") {
      const selector = jp.value(
        context.context.crossWordState,
        `$.${action.parameters.clueDirection}[?(@.number==${action.parameters.clueNumber})].cssSelector`,
      );

      if (!selector) {
        message = `${action.parameters.clueNumber} ${action.parameters.clueDirection} is not a valid position for this crossword`;
      } else {
        await browser.clickOn(selector);
        await browser.enterTextIn(action.parameters.value);
        message = `OK. Setting the value of ${action.parameters.clueNumber} ${action.parameters.clueDirection} to "${action.parameters.value}"`;
      }
    }
    if (actionName === "getClueValue") {
      if (message === "OK") message = "";
      const selector = jp.value(
        context.context.crossWordState,
        `$.${action.parameters.clueDirection}[?(@.number==${action.parameters.clueNumber})].text`,
      );

      if (!selector) {
        message = `${action.parameters.clueNumber} ${action.parameters.clueDirection} is not a valid position for this crossword"`;
      } else {
        message = `The clue is: ${selector}`;
      }
    }
  }

  return message;
}
