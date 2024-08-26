// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import { processRequests } from "typechat/interactive";
import { BoardActions } from "./crossword/schema/actionSchema.js";
import { CrosswordAgent } from "./crossword/translator.js";
import jp from "jsonpath";
import { evaluateJsonProgram } from "typechat/ts";
import {
    CluesTextAndSelectorsList,
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
    dotenv.config({ path: dotEnvPath});
    
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
        return cachedSchema.body as CluesTextAndSelectorsList;
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
                await browser.setCurrentPageSchema(url, cluesResponse.data);
                return cluesResponse.data as CluesTextAndSelectorsList;
            }
        }
    }
    return undefined;
}

type Program = {
    "@steps": FunctionCall[];
};

type FunctionCall = {
    "@func": string;
    "@args"?: Expression[];
};

type Expression = JsonValue | FunctionCall | ResultReference;

type JsonValue =
    | string
    | number
    | boolean
    | null
    | { [x: string]: Expression }
    | Expression[];

type ResultReference = {
    "@ref": number;
};

function createUpdateCrosswordProgram(
    text: string,
    clueNumber: number,
    direction: "across" | "down",
): Program {
    return {
        "@steps": [
            {
                "@func": "getJsonObjectValue",
                "@args": [
                    `$.${direction}[?(@.number==${clueNumber})].cssSelector`,
                ],
            },
            {
                "@func": "clickOnElement",
                "@args": [{ "@ref": 0 }],
            },
            {
                "@func": "enterTextOnPage",
                "@args": [text],
            },
        ],
    };
}

function createGetClueTextProgram(
    clueNumber: number,
    direction: "across" | "down",
): Program {
    return {
        "@steps": [
            {
                "@func": "getJsonObjectValue",
                "@args": [`$.${direction}[?(@.number==${clueNumber})].text`],
            },
        ],
    };
}

async function handleCall(func: string, args: any[]): Promise<unknown> {
    switch (func) {
        case "getJsonObjectValue":
            const result = jp.query(boardState, args[0])[0];
            return result;
        case "clickOnElement":
            return await browser.clickOn(args[0]);
        case "enterTextOnPage":
            return await browser.enterTextIn(args[0]);
    }
    return NaN;
}

async function translateCrosswordMessage(request: string) {
    let message = "OK";
    if (!boardState) {
        console.log("Board state is missing");
        return message;
    }

    const response = await agent.updateBoardFromCluesList(boardState, request);
    if (!response.success) {
        message = response.message;
        return message;
    }
    const boardActions = response.data;
    console.log(JSON.stringify(boardActions, undefined, 2));

    for (let action of boardActions.actions) {
        const actionName = action.actionName;
        if (actionName === "enterText") {
            browser.sendActionToBrowserAgent(action);
        }
    }

    return message;
}

async function handleCrosswordAction(action: any) {
    let message = "OK";
    if (boardState) {
        const actionName =
            action.actionName ?? action.fullActionName.split(".").at(-1);
        if (actionName === "enterText") {
            const program = createUpdateCrosswordProgram(
                action.parameters.value,
                action.parameters.clueNumber,
                action.parameters.clueDirection,
            );
            const result = await evaluateJsonProgram(program, handleCall);
            console.log(result);
        }
        if (actionName === "getClueValue") {
            if (message === "OK") message = "";
            const program = createGetClueTextProgram(
                action.parameters.clueNumber,
                action.parameters.clueDirection,
            );
            const result = await evaluateJsonProgram(program, handleCall);
            console.log(result);
        }
    }

    return message;
}

if (boardState) {
    processRequests("🏁> ", process.argv[2], async (request: string) => {
        await translateCrosswordMessage(request);
    });
}
