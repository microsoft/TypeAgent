// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import jp from "jsonpath";
import { SessionContext } from "@typeagent/agent-sdk";
import { Crossword, CrosswordClue } from "./schema/pageSchema.mjs";
import { CrosswordPresence } from "./schema/pageFrame.mjs";
import { createCrosswordPageTranslator } from "./translator.mjs";
import { BrowserActionContext, getBrowserControl } from "../actionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";
import { getCachedSchema, setCachedSchema } from "./cachedSchema.mjs";

import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:crossword:schema");
export async function getBoardSchema(
    context: SessionContext<BrowserActionContext>,
): Promise<Crossword | undefined> {
    const agentContext = context.agentContext;
    if (!agentContext.browserConnector) {
        throw new Error("No connection to browser session.");
    }

    const browser: BrowserConnector = agentContext.browserConnector;
    const browserControl = getBrowserControl(agentContext);
    const url = await browserControl.getPageUrl();
    const cachedSchema = await getCachedSchema(context, url);

    if (cachedSchema) {
        debug(
            `Reusing cached schema for ${url}: ${JSON.stringify(cachedSchema)}`,
        );
        return cachedSchema;
    }
    const htmlFragments = await browser.getHtmlFragments();
    debug(`Found ${htmlFragments.length} HTML fragments on the page ${url}.`);
    debug(htmlFragments);
    const agent = await createCrosswordPageTranslator("GPT_4_O_MINI");

    let firstCandidateFragments = [];
    let candidateFragments = [];
    let pagePromises = [];

    for (let i = 0; i < htmlFragments.length; i++) {
        // skip html fragments that are too short to contain crossword
        if (
            !htmlFragments[i].content ||
            htmlFragments[i].content.length < 500
        ) {
            continue;
        }

        firstCandidateFragments.push({
            frameId: htmlFragments[i].frameId,
            content: htmlFragments[i].content,
        });

        pagePromises.push(agent.checkIsCrosswordOnPage([htmlFragments[i]]));
    }

    const pageResults = await Promise.all(pagePromises);

    for (let i = 0; i < pageResults.length; i++) {
        const isPresent = pageResults[i];

        if (isPresent.success) {
            const result = isPresent.data as CrosswordPresence;
            if (result.crossWordPresent) {
                candidateFragments.push({
                    frameId: firstCandidateFragments[i].frameId,
                    content: firstCandidateFragments[i].content,
                });
            }
        }
    }

    /*    
    const filteredFragments = await browser.getFilteredHtmlFragments(
      candidateFragments,
    );
  */
    if (candidateFragments.length === 0) {
        debug(`No crossword fragments found on the page ${url}.`);
        return undefined;
    }

    debug(
        `Found candidate fragments for crossword clues: ${JSON.stringify(
            candidateFragments,
            undefined,
            2,
        )}`,
    );

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
                    debug(`Saving crossword clues found for ${url}`);
                    await setCachedSchema(context, url, data);
                    debug(`Saved crossword clues found for ${url}`);
                    return data;
                }
            }
        }
    }

    debug(`No valid crossword clues found on the page ${url}.`);

    return undefined;
}

export async function handleCrosswordAction(
    action: any,
    context: SessionContext<BrowserActionContext>,
) {
    let message = "OK";
    if (!context.agentContext.browserConnector) {
        throw new Error("No connection to browser session.");
    }

    const browser = context.agentContext.browserConnector;
    const crosswordState = context.agentContext.crossWordState;

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
                await browser.enterTextIn(
                    text.replace(/\s/g, "")?.toUpperCase(),
                );
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
    } else {
        message = await handleCrosswordActionWithoutCache(action, context);
    }

    return message;
}

export async function handleCrosswordActionWithoutCache(
    action: any,
    context: SessionContext<BrowserActionContext>,
) {
    let message = "OK";
    if (!context.agentContext.browserConnector) {
        throw new Error("No connection to browser session.");
    }

    const browser = context.agentContext.browserConnector;
    const htmlFragments = await browser.getHtmlFragments();
    const agent = await createCrosswordPageTranslator("GPT_4_O_MINI");

    const direction = action.parameters.clueDirection;
    const number = action.parameters.clueNumber;

    const response = await agent.getPageComponentSchema(
        "CrosswordClue",
        `clue for ${number} ${direction}`,
        htmlFragments,
        [],
    );

    if (!response.success) {
        console.error(`Attempt to get crossword clue failed`);
        console.error(response.message);
        return message;
    }

    const clueElement = response.data as CrosswordClue;

    const actionName =
        action.actionName ?? action.fullActionName.split(".").at(-1);
    if (actionName === "enterText") {
        const text = action.parameters.value;
        const selector = clueElement.cssSelector;

        if (selector) {
            await browser.clickOn(selector);
            await browser.enterTextIn(text.replace(/\s/g, "")?.toUpperCase());
            message = `OK. Setting the value of ${number} ${direction} to "${text}"`;
        } else {
            message = `${number} ${direction} is not a valid position for this crossword`;
        }
    }
    if (actionName === "getClueValue") {
        if (message === "OK") message = "";
        const selector = clueElement.text;

        if (selector) {
            message = `The clue is: ${selector}`;
        } else {
            message = `${number} ${direction} is not a valid position for this crossword"`;
        }
    }

    return message;
}
