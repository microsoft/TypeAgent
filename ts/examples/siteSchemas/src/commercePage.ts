// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import { processRequests } from "typechat/interactive";
import { ShoppingPlan } from "./commerce/schema/pageActions.js";

import { CommercePageType, ECommerceSiteAgent } from "./commerce/translator.js";
import { LandingPage } from "./commerce/schema/landingPage.js";
import { createBrowserConnector } from "./common/connector.js";
import { HtmlFragments, getModelVals } from "./common/translator.js";
import { SearchPage } from "./commerce/schema/searchResultsPage.js";
import { ProductDetailsPage } from "./commerce/schema/productDetailsPage.js";

// initialize commerce state
const agent = createCommerceAgent("GPT_4o");
const browser = await createBrowserConnector(
    "commerce",
    undefined,
    translateShoppingMessage,
);
const url = await browser.getPageUrl();
const htmlFragments = await browser.getHtmlFragments();
const pageState = await getPageSchema(url!, htmlFragments, agent);

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

async function getPageSchema(
    pageType: string,
    htmlFragments: HtmlFragments[],
    agent: ECommerceSiteAgent<ShoppingPlan>,
) {
    let response;
    switch (pageType) {
        case "searchResults":
            response = await agent.getPageData(
                CommercePageType.SearchResults,
                htmlFragments,
            );
            break;
        case "productDetails":
            response = await agent.getPageData(
                CommercePageType.ProductDetails,
                htmlFragments,
            );
            break;
        default:
            response = await agent.getPageData(
                CommercePageType.Landing,
                htmlFragments,
            );
            break;
    }

    if (!response.success) {
        console.log(response.message);
        return undefined;
    }

    return response.data;
}

async function getCurrentPageSchema<T extends object>(pageType: string) {
    const htmlFragments = await browser.getHtmlFragments();
    const currentPage = await getPageSchema(pageType, htmlFragments, agent);
    return currentPage as T;
}

async function translateShoppingMessage(request: string) {
    let message = "OK";
    if (!pageState) {
        console.log("Page state is missing");
        return message;
    }

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
        }
    }

    return message;
}

async function handleProductSearch(action: any) {
    const pageInfo = await getCurrentPageSchema<LandingPage>("landingPage");
    if (!pageState) {
        console.log("Page state is missing");
        return;
    }

    //const pageInfo = pageState as LandingPage;
    const searchSelector = pageInfo.searchBox.cssSelector;

    await browser.clickOn(searchSelector);
    await browser.enterTextIn(action.parameters.productName, searchSelector);
    await browser.clickOn(pageInfo.searchBox.submitButtonCssSelector);
    await new Promise((r) => setTimeout(r, 200));
    await browser.awaitPageLoad();
}

async function handleSelectSearchResult(action: any) {
    // get current page state
    const pageInfo = await getCurrentPageSchema<SearchPage>("searchResults");

    if (!pageInfo) {
        console.error("Page state is missing");
        return;
    }

    const targetProduct = pageInfo.productTiles[action.parameters.position];
    await browser.clickOn(targetProduct.detailsLinkSelector);
    await new Promise((r) => setTimeout(r, 200));
    await browser.awaitPageLoad();
}

async function handleAddToCart(action: any) {
    // get current page state
    const pageInfo =
        await getCurrentPageSchema<ProductDetailsPage>("productDetails");

    if (!pageInfo) {
        console.error("Page state is missing");
        return;
    }

    const targetProduct = pageInfo.productInfo;
    if (targetProduct.addToCartButton) {
        await browser.clickOn(targetProduct.addToCartButton.cssSelector);
    }
}

if (pageState) {
    processRequests("🛒> ", process.argv[2], async (request: string) => {
        await translateShoppingMessage(request);
    });
}
