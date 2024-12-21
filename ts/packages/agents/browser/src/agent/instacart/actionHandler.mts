// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";
import { createInstacartPageTranslator } from "./translator.mjs";
import {
  AllListsInfo,
  HomeLink,
  ProductDetailsHeroTile,
  ProductTile,
  SearchInput,
  StoreInfo,
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
    case "addToListAction":
      await handleAddToList(action);
    case "findNearbyStoreAction":
      await handleFindStores(action);
      break;
    case "setPreferredStoreAction":
      await handleSetPreferredStore(action);
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

  async function handleAddToList(action: any) {
    const targetProduct = (await getComponentFromPage(
      "ProductDetailsHeroTile",
    )) as ProductDetailsHeroTile;

    if (targetProduct.addToListButton) {
      await browser.clickOn(targetProduct.addToListButton.cssSelector);

      // this launches a popup with the available lists
      const request = `ListName: ${action.listName}`;
      const targetList = (await getComponentFromPage(
        "AllListsInfo",
        request,
      )) as AllListsInfo;

      if (targetList) {
        // se
        await browser.clickOn(targetList.lists[0].cssSelector);
        await browser.clickOn(targetList.submitButtonCssSelector);
      }
    }
  }

  async function goToHomepage() {
    const link = (await getComponentFromPage("HomeLink")) as HomeLink;

    if (link.linkCssSelector) {
      await browser.clickOn(link.linkCssSelector);
    }
  }

  async function handleFindStores(action: any) {
    await goToHomepage();

    const stores = (await getComponentFromPage("StoreInfo")) as StoreInfo[];

    console.log(stores);

    return stores;
  }

  async function searchForStore(storeName: string) {
    const selector = (await getComponentFromPage("SearchInput")) as SearchInput;
    const searchSelector = selector.cssSelector;

    await browser.clickOn(searchSelector);
    await browser.enterTextIn("store: " + storeName, searchSelector);
    await browser.clickOn(selector.submitButtonCssSelector);
    await new Promise((r) => setTimeout(r, 400));
    await browser.awaitPageLoad();
  }

  async function selectStoreSearchResult(storeName: string) {
    const request = `Search result: ${storeName}`;
    const targetStore = (await getComponentFromPage(
      "StoreInfo",
      request,
    )) as StoreInfo;

    await browser.clickOn(targetStore.storeLinkCssSelector);
    await new Promise((r) => setTimeout(r, 200));
    await browser.awaitPageLoad();
  }

  async function handleSetPreferredStore(action: any) {
    await searchForStore(action.parameters.storeName);
    await selectStoreSearchResult(action.parameters.storeName);

    // TODO: persist preferrences
  }

  return message;
}
