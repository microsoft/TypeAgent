// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import { processRequests } from "typechat/interactive";
import { ShoppingPlan } from "./commerce/schema/pageActions.js";

import { ECommerceSiteAgent } from "./commerce/translator.js";
import { createBrowserConnector } from "./common/connector.js";
// import { getModelVals } from "./common/translator.js";
import {
    ProductDetailsHeroTile,
    ProductTile,
    SearchInput,
} from "./commerce/schema/pageComponents.js";
import findConfig from "find-config";
import assert from "assert";
import dotenv from "dotenv";

// const agent = createCommerceAgent("GPT_4o");

const agent = createCommerceAgent("GPT_4_O_MINI");
const browser = await createBrowserConnector(
    "commerce",
    undefined,
    translateShoppingMessage,
);

function createCommerceAgent(
    model: "GPT_35_TURBO" | "GPT_4" | "GPT_v" | "GPT_4_O" | "GPT_4_O_MINI",
) {
    // const vals = getModelVals(model);
    const dotEnvPath = findConfig(".env");
    assert(dotEnvPath, ".env file not found!");
    dotenv.config({ path: dotEnvPath });

    const schemaText = fs.readFileSync(
        path.join("src", "commerce", "schema", "pageActions.ts"),
        "utf8",
    );

    const agent = new ECommerceSiteAgent<ShoppingPlan>(
        schemaText,
        "ShoppingPlan",
        model,
    );
    return agent;
}

async function translateShoppingMessage(request: string) {
    let message = "OK";

    const response = await agent.translator.translate(request);
    if (!response.success) {
        console.log(response.message);
        return message;
    }

    const pageActions = response.data;
    console.log(JSON.stringify(pageActions, undefined, 2));

    for (let pageAction of pageActions.steps) {
        switch (pageAction.actionName) {
            case "searchForProductAction":
                await handleProductSearch(pageAction);
                break;
            case "selectSearchResult":
                await handleSelectSearchResult(pageAction);
                break;
            case "addToCartAction":
                await handleAddToCart(pageAction);
                break;
            case "answerPageQuestion":
                await handlePageChat(pageAction);
                break;
        }
    }

    return message;
}

async function getComponentFromPage(
    componentType: string,
    selectionCondition?: string,
) {
    const htmlFragments = await browser.getHtmlFragments();
    const timerName = `getting search ${componentType} section`;

    console.time(timerName);
    const response = await agent.getPageComponentSchema(
        componentType,
        selectionCondition,
        htmlFragments,
        undefined,
    );

    if (!response.success) {
        console.error("Attempt to get product tilefailed");
        return;
    }

    console.timeEnd(timerName);
    return response.data;
}

async function handleProductSearch(action: any) {
    const selector = (await getComponentFromPage("SearchInput")) as SearchInput;
    const searchSelector = selector.cssSelector;

    await browser.clickOn(searchSelector);
    await browser.enterTextIn(action.parameters.productName, searchSelector);
    await browser.clickOn(selector.submitButtonCssSelector);
    await new Promise((r) => setTimeout(r, 200));
    await browser.awaitPageLoad();
}

async function handleSelectSearchResult(action: any) {
    const request = `Search result: ${action.selectionCriteria}`;
    const selector = (await getComponentFromPage(
        "ProductTile",
        request,
    )) as ProductTile;
    await browser.clickOn(selector.detailsLinkSelector);
    await new Promise((r) => setTimeout(r, 200));
    await browser.awaitPageLoad();
}

async function handleAddToCart(action: any) {
    const targetProduct = (await getComponentFromPage(
        "ProductDetailsHeroTile",
    )) as ProductDetailsHeroTile;

    if (targetProduct.addToCartButton) {
        await browser.clickOn(targetProduct.addToCartButton.cssSelector);
    }
}

async function handlePageChat(action: any) {
    const htmlFragments = await browser.getHtmlFragments();
    const screenshot = await browser.getCurrentPageScreenshot();

    const response = await agent.getPageChatResponse(
        action.question,
        htmlFragments,
        screenshot,
    );

    console.log(response);
}

processRequests("🛒> ", process.argv[2], async (request: string) => {
    await translateShoppingMessage(request);
});
