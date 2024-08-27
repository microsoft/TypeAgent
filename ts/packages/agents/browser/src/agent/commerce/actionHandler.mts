// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DispatcherAgentContext } from "dispatcher-agent";

import { BrowserActionContext } from "../browserActionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";

import { ShoppingPlan } from "./schema/pageAction.mjs";

import { CommercePageType, ECommerceSiteAgent } from "./translator.mjs";
import { LandingPage } from "./schema/landingPage.mjs";
import { createCommercePageTranslator, HtmlFragments } from "./translator.mjs";

import { SearchPage } from "./schema/searchResultsPage.mjs";
import { ProductDetailsPage } from "./schema/productDetailsPage.mjs";

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

async function getCurrentPageSchema<T extends object>(
  pageType: string,
  agent: ECommerceSiteAgent<ShoppingPlan>,
  browser: BrowserConnector,
) {
  const htmlFragments = await browser.getHtmlFragments();
  const currentPage = await getPageSchema(pageType, htmlFragments, agent);
  return currentPage as T;
}

export async function handleCommercedAction(
  action: any,
  context: DispatcherAgentContext<BrowserActionContext>,
) {
  let message = "OK";
  if (!context.context.browserConnector) {
    throw new Error("No connection to browser session.");
  }

  const browser: BrowserConnector = context.context.browserConnector;

  const agent = await createCommercePageTranslator("GPT_4o");

  for (let pageAction of action.steps) {
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

  async function handleProductSearch(action: any) {
    const pageInfo = await getCurrentPageSchema<LandingPage>(
      "landingPage",
      agent,
      browser,
    );
    if (!pageInfo) {
      console.error("Page state is missing");
      return;
    }

    const searchSelector = pageInfo.searchBox.cssSelector;

    await browser.clickOn(searchSelector);
    await browser.enterTextIn(action.parameters.productName, searchSelector);
    await browser.clickOn(pageInfo.searchBox.submitButtonCssSelector);
    await new Promise((r) => setTimeout(r, 200));
    await browser.awaitPageLoad();
  }

  async function handleSelectSearchResult(action: any) {
    // get current page state
    const pageInfo = await getCurrentPageSchema<SearchPage>(
      "searchResults",
      agent,
      browser,
    );

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
    const pageInfo = await getCurrentPageSchema<ProductDetailsPage>(
      "productDetails",
      agent,
      browser,
    );

    if (!pageInfo) {
      console.error("Page state is missing");
      return;
    }

    const targetProduct = pageInfo.productInfo;
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

  return message;
}
