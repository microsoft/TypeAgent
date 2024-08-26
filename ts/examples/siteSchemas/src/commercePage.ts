// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import { processRequests } from "typechat/interactive";
import { ShoppingPlan } from "./commerce/schema/pageActions.js";

import { ECommerceSiteAgent } from "./commerce/translator.js";
import { createBrowserConnector } from "./common/connector.js";
import { getModelVals } from "./common/translator.js";
import { ProductDetailsHeroTile, ProductTile, SearchInput } from "./commerce/schema/pageComponents.js";

const agent = createCommerceAgent("GPT_4o");
const browser = await createBrowserConnector(
    "commerce",
    undefined,
    translateShoppingMessage,
);

function createCommerceAgent(
    model: "GPT_35_TURBO" | "GPT_4" | "GPT-v" | "GPT_4o",
) {
    const vals = getModelVals(model);
    const schemaText = fs.readFileSync(
        path.join("src", "commerce", "schema", "pageActions.ts"),
        "utf8",
    );

    const agent = new ECommerceSiteAgent<ShoppingPlan>(
        schemaText,
        "ShoppingPlan",
        vals,
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

async function handleProductSearch(action: any) {
    const htmlFragments = await browser.getHtmlFragments();

    console.time("getting search input section");
    const response = await agent.getPageComponentSchema(
        "SearchInput",
        "",
        htmlFragments,
        undefined,
    );

    if(!response.success){
        console.error("Attempt to get product tilefailed");
        return;
    }

    const selector = response.data as SearchInput;
    console.timeEnd("getting search input section");
    const searchSelector = selector.cssSelector;

    await browser.clickOn(searchSelector);
    await browser.enterTextIn(action.parameters.productName, searchSelector);
    await browser.clickOn(selector.submitButtonCssSelector);
    await new Promise((r) => setTimeout(r, 200));
    await browser.awaitPageLoad();
}

async function handleSelectSearchResult(action: any) {
    const request = `Search result: ${action.selectionCriteria}`;
    const htmlFragments = await browser.getHtmlFragments();

    console.time("getting product tile from search");
    const response = await agent.getPageComponentSchema(
        "ProductTile",
        request,
        htmlFragments,
        undefined,
    );

    if(!response.success){
        console.error("Attempt to get product tilefailed");
        return;
    }

    const selector = response.data as ProductTile;
    console.timeEnd("getting product tile from search");

    await browser.clickOn(selector.detailsLinkSelector);
    await new Promise((r) => setTimeout(r, 200));
    await browser.awaitPageLoad();
}

async function handleAddToCart(action: any) {
    const htmlFragments = await browser.getHtmlFragments();

    console.time("getting product details section");
    const response = await agent.getPageComponentSchema(
        "ProductDetailsHeroTile",
        "",
        htmlFragments,
        undefined,
    );

    if(!response.success){
        console.error("Attempt to get product details section failed");
        return;
    }

    const targetProduct = response.data as ProductDetailsHeroTile;
    console.timeEnd("getting product details section");

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
        screenshot
    );

    console.log(response);
}

processRequests("🛒> ", process.argv[2], async (request: string) => {
    await translateShoppingMessage(request);
});
