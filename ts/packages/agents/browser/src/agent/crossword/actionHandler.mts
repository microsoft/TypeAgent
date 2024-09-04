// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import jp from "jsonpath";
import { ActionContext, SessionContext } from "@typeagent/agent-sdk";
import { Crossword } from "./schema/pageSchema.mjs";
import { CrosswordPresence } from "./schema/pageFrame.mjs";
import { createCrosswordPageTranslator } from "./translator.mjs";
import { BrowserActionContext } from "../actionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";

export async function getBoardSchema(
  context: SessionContext<BrowserActionContext>,
) {
  if (!context.agentContext.browserConnector) {
    throw new Error("No connection to browser session.");
  }

  const browser: BrowserConnector = context.agentContext.browserConnector;
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
          agent.getCluesTextWithSelectors([candidateFragments[i]]),
          // agent.getCluesTextThenSelectors([candidateFragments[i]]),
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
  context: ActionContext<BrowserActionContext>,
) {
  let message = "OK";
  if (!context.sessionContext.agentContext.browserConnector) {
    throw new Error("No connection to browser session.");
  }

  const browser = context.sessionContext.agentContext.browserConnector;
  const crosswordState = context.sessionContext.agentContext.crossWordState;

  if (crosswordState) {
    const actionName =
      action.actionName ?? action.fullActionName.split(".").at(-1);
    if (actionName === "enterText") {
      const direction = action.parameters.clueDirection;
      const number = action.parameters.clueNumber;
      const text = action.parameters.value;
      const selector = jp.value(
        crosswordState,
        `$.${direction}[?(@.number==${number})].cssSelector`,
      );

      if (selector) {
        await browser.clickOn(selector);
        await browser.enterTextIn(text);
        message = `OK. Setting the value of ${number} ${direction} to "${text}"`;
      } else {
        message = `${number} ${direction} is not a valid position for this crossword`;
      }
    }
    if (actionName === "getClueValue") {
      if (message === "OK") message = "";
      const direction = action.parameters.clueDirection;
      const number = action.parameters.clueNumber;
      const selector = jp.value(
        crosswordState,
        `$.${direction}[?(@.number==${number})].text`,
      );

      if (selector) {
        message = `The clue is: ${selector}`;
      } else {
        message = `${number} ${direction} is not a valid position for this crossword"`;
      }
    }
  }

  return message;
}
