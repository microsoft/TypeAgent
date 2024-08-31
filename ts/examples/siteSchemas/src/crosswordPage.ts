// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import { processRequests } from "typechat/interactive";
import { BoardActions } from "./crossword/schema/actionSchema.js";
import { CrosswordAgent } from "./crossword/translator.js";
import jp from "jsonpath";
import {
    Crossword,
    CrosswordPresence,
} from "./crossword/schema/bootstrapSchema.js";
import { createBrowserConnector } from "./common/connector.js";
import { HtmlFragments } from "./common/translator.js";
import findConfig from "find-config";
import assert from "assert";
import dotenv from "dotenv";

// initialize commerce state
const agent = createCrosswordAgent("GPT_4_O");
const browser = await createBrowserConnector(
    "crossword",
    handleCrosswordAction,
    translateCrosswordMessage,
);

const url = await browser.getPageUrl();
const htmlFragments = await browser.getHtmlFragments();
const boardState = await getBoardSchema(url!, htmlFragments, agent);

function createCrosswordAgent(
    model: "GPT_35_TURBO" | "GPT_4" | "GPT_v" | "GPT_4_O",
) {
    const dotEnvPath = findConfig(".env");
    assert(dotEnvPath, ".env file not found!");
    dotenv.config({ path: dotEnvPath });

    const schemaText = fs.readFileSync(
        path.join("src", "crossword", "schema", "actionSchema.ts"),
        "utf8",
    );

    const agent = new CrosswordAgent<BoardActions>(
        schemaText,
        "BoardActions",
        model,
    );
    return agent;
}

async function getBoardSchema(
    url: string,
    htmlFragments: HtmlFragments[],
    agent: CrosswordAgent<BoardActions>,
) {
    const cachedSchema: any = await browser.getCurrentPageSchema();
    if (cachedSchema) {
        return cachedSchema as Crossword;
    } else {
        // check which fragment has a crossword
        let candidateFragments = [];
        let pagePromises = [];
        for (let i = 0; i < htmlFragments.length; i++) {
            pagePromises.push(agent.checkIsCrosswordOnPage([htmlFragments[i]]));
        }

        const results = await Promise.all(pagePromises);

        for (let i = 0; i < results.length; i++) {
            const isPresent = results[i];

            if (isPresent.success) {
                const result = isPresent.data as CrosswordPresence;
                if (result.crossWordPresent) {
                    candidateFragments.push({
                        frameId: htmlFragments[i].frameId,
                        content: htmlFragments[i].content,
                        cssSelectorAcross: result.cluesRoootAcrossCSSSelector,
                        cssSelectorDown: result.cluesRoootDownCSSSelector,
                    });
                }
            }
        }

        const filteredFragments =
            await browser.getFilteredHtmlFragments(candidateFragments);

        //TODO: get updated HTML, filtered based on CSS selector
        if (filteredFragments.length > 0) {
            const cluesResponse =
                await agent.getCluesTextWithSelectors(filteredFragments);

            if (cluesResponse.success) {
                // TEMP: Do not write to cache while we experiment with different schemas and parsing approaches
                // await browser.setCurrentPageSchema(url, cluesResponse.data);
                return cluesResponse.data as Crossword;
            }
        }
    }
    return undefined;
}

async function translateCrosswordMessage(request: string) {
    let message = "OK";

    const response = await agent.translator.translate(request);
    if (!response.success) {
        console.log(response.message);
        return message;
    }

    const pageAction = response.data;
    console.log(JSON.stringify(pageAction, undefined, 2));

    message = await handleCrosswordAction(pageAction);

    return message;
}

export async function handleCrosswordAction(action: any) {
    let message = "OK";

    if (!boardState) {
        console.log("Board state is missing");
        return message;
    }

    if (action.actionName === "enterText") {
        const direction = action.parameters.clueDirection;
        const number = action.parameters.clueNumber;
        const text = action.parameters.value;
        const selector = jp.value(
            boardState,
            `$.${direction}[?(@.number==${number})].cssSelector`,
        );

        if (!selector) {
            message = `${number} ${direction} is not a valid position for this crossword`;
        } else {
            await browser.clickOn(selector);
            await browser.enterTextIn(text);
            message = `OK. Setting the value of ${number} ${direction} to "${text}"`;
        }
    }
    if (action.actionName === "getClueValue") {
        if (message === "OK") message = "";
        const direction = action.parameters.clueDirection;
        const number = action.parameters.clueNumber;
        const selector = jp.value(
            boardState,
            `$.${direction}[?(@.number==${number})].text`,
        );

        if (!selector) {
            message = `${number} ${direction} is not a valid position for this crossword"`;
        } else {
            message = `The clue is: ${selector}`;
        }
    }

    return message;
}

if (boardState) {
    processRequests("🏁> ", process.argv[2], async (request: string) => {
        await translateCrosswordMessage(request);
    });
}
