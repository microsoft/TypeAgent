// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";
import { createInstacartPageTranslator } from "./translator.mjs";
import {
  ProductDetailsHeroTile,
  ProductTile,
  SearchInput,
} from "./schema/pageComponents.mjs";

export async function handleInstacartAction(
  action: any,
  context: ActionContext<BrowserActionContext>,
) {
  let message = "OK";
  if (!context.sessionContext.agentContext.browserConnector) {
    throw new Error("No connection to browser session.");
  }

  const browser: BrowserConnector =
    context.sessionContext.agentContext.browserConnector;

  const agent = await createInstacartPageTranslator("GPT_4_O_MINI");

  switch (action.actionName) {
    case "searchForProductAction":
      await searchForProduct(action.parameters.keyword);
      break;
    case "selectSearchResult":
      await selectSearchResult(action.parameters.productName);
      break;
    case "addToCartAction":
      await handleAddToCart(action);
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
      console.error(response.message);
      return;
    }

    console.timeEnd(timerName);
    return response.data;
  }

  async function searchForProduct(productName: string) {
    const selector = (await getComponentFromPage("SearchInput")) as SearchInput;
    const searchSelector = selector.cssSelector;

    await browser.clickOn(searchSelector);
    await browser.enterTextIn(productName, searchSelector);
    await browser.clickOn(selector.submitButtonCssSelector);
    await new Promise((r) => setTimeout(r, 400));
    await browser.awaitPageLoad();
  }

  async function selectSearchResult(productName: string) {
    const request = `Search result: ${productName}`;
    const targetProduct = (await getComponentFromPage(
      "ProductTile",
      request,
    )) as ProductTile;

    await browser.clickOn(targetProduct.detailsLinkSelector);
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

  return message;
}
