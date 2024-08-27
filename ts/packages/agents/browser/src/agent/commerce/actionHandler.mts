// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DispatcherAgentContext } from "dispatcher-agent";

import { BrowserActionContext } from "../browserActionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";
import { createCommercePageTranslator } from "./translator.mjs";
import {
  ProductDetailsHeroTile,
  ProductTile,
  SearchInput,
} from "./schema/pageComponents.mjs";

export async function handleCommerceAction(
  action: any,
  context: DispatcherAgentContext<BrowserActionContext>,
) {
  let message = "OK";
  if (!context.context.browserConnector) {
    throw new Error("No connection to browser session.");
  }

  const browser: BrowserConnector = context.context.browserConnector;

  const agent = await createCommercePageTranslator("GPT_4_O");

  switch (action.actionName) {
    case "searchForProductAction":
      await handleProductSearch(action);
      break;
    case "selectSearchResult":
      await handleSelectSearchResult(action);
      break;
    case "addToCartAction":
      await handleAddToCart(action);
      break;
    case "answerPageQuestion":
      await handlePageChat(action);
      break;
  }

  async function getComponentFromPage(
    componentType: string,
    selectionCondition?: string,
  ) {
    const htmlFragments = await browser.getHtmlFragments();
    const timerName = `getting ${componentType} section`;

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

  return message;
}
