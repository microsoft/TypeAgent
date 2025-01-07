// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";
import { createInstacartPageTranslator } from "./translator.mjs";
import {
  AllListsInfo,
  AllRecipeSearchResults,
  BuyItAgainHeaderSection,
  BuyItAgainNavigationLink,
  HomeLink,
  ListDetailsInfo,
  ListInfo,
  ListsNavigationLink,
  ProductDetailsHeroTile,
  ProductTile,
  RecipeHeroSection,
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
    case "searchForRecipeAction":
      await handleFindRecipe(action);
      break;
    case "buyAllInRecipeAction":
      await handleBuyRecipeIngredients(action);
      break;
    case "buyAllInListAction":
      await handleBuyListContents(action);
      break;
    case "setPreferredStoreAction":
      await handleSetPreferredStore(action);
      break;
    case "buyItAgainAction":
      await handleBuyItAgain(action);
      break;
  }

  async function getComponentFromPage(
    componentType: string,
    selectionCondition?: string,
  ) {
    const htmlFragments = await browser.getHtmlFragments(true);
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
    await browser.awaitPageInteraction();
    await browser.awaitPageLoad();
  }

  async function selectSearchResult(productName: string) {
    const request = `Search result: ${productName}`;
    const targetProduct = (await getComponentFromPage(
      "ProductTile",
      request,
    )) as ProductTile;

    await browser.clickOn(targetProduct.detailsLinkSelector);
    await browser.awaitPageInteraction();
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
    console.log(link);

    if (link.linkCssSelector) {
      await browser.clickOn(link.linkCssSelector);
      await browser.awaitPageInteraction();
      await browser.awaitPageLoad(5000);
    }
  }

  async function handleFindStores(action: any) {
    await goToHomepage();
    const stores = (await getComponentFromPage("StoreInfo")) as StoreInfo[];
    console.log(stores);
    return stores;
  }

  async function searchForStore(storeName: string) {
    await goToHomepage();
    const selector = (await getComponentFromPage("SearchInput")) as SearchInput;
    const searchSelector = selector.cssSelector;

    await browser.clickOn(searchSelector);
    await browser.enterTextIn("store: " + storeName, searchSelector);
    await browser.clickOn(selector.submitButtonCssSelector);
    await browser.awaitPageInteraction();
    await browser.awaitPageLoad();
  }

  async function selectStoreSearchResult(storeName: string) {
    const request = `${storeName}`;
    const targetStore = (await getComponentFromPage(
      "StoreInfo",
      request,
    )) as StoreInfo;

    await browser.clickOn(targetStore.storeLinkCssSelector);
    await browser.awaitPageInteraction();
    await browser.awaitPageLoad(5000);
  }

  async function handleSetPreferredStore(action: any) {
    await searchForStore(action.parameters.storeName);
    await selectStoreSearchResult(action.parameters.storeName);

    // TODO: persist preferrences
  }

  async function searchForRecipe(recipeKeywords: string) {
    // await goToHomepage();
    const selector = (await getComponentFromPage("SearchInput")) as SearchInput;
    const searchSelector = selector.cssSelector;

    await browser.clickOn(searchSelector);
    await browser.enterTextIn("recipe: " + recipeKeywords, searchSelector);
    await browser.clickOn(selector.submitButtonCssSelector);
    await browser.awaitPageInteraction();
    await browser.awaitPageLoad(5000);
  }

  async function selectRecipeSearchResult(recipeKeywords: string) {
    const request = `${recipeKeywords}`;
    const allRecipes = (await getComponentFromPage(
      "AllRecipeSearchResults",
      request,
    )) as AllRecipeSearchResults;

    console.log(allRecipes);
    if (allRecipes.recipes.length > 0) {
      await browser.clickOn(allRecipes.recipes[0].recipeLinkCssSelector);
      await browser.awaitPageInteraction();
      console.log(
        "Clicked on search result: " +
          allRecipes.recipes[0].recipeLinkCssSelector,
      );
      await browser.awaitPageLoad();
    }
  }

  async function handleFindRecipe(action: any) {
    await searchForRecipe(action.parameters.keyword);
    await selectRecipeSearchResult(action.parameters.keyword);
  }

  async function handleBuyRecipeIngredients(action: any) {
    await searchForRecipe(action.parameters.keywords);
    await selectRecipeSearchResult(action.parameters.keywords);

    const targetRecipe = (await getComponentFromPage(
      "RecipeHeroSection",
    )) as RecipeHeroSection;

    if (targetRecipe && targetRecipe.addAllIngridientsCssSelector) {
      await browser.clickOn(targetRecipe.addAllIngridientsCssSelector);
    }
  }

  async function handleBuyListContents(action: any) {
    const navigationLink = (await getComponentFromPage(
      "ListsNavigationLink",
    )) as ListsNavigationLink;

    if (navigationLink) {
      await browser.clickOn(navigationLink.linkCssSelector);
      await browser.awaitPageLoad();

      const request = `List name: ${action.listName}`;
      const targetList = (await getComponentFromPage(
        "ListInfo",
        request,
      )) as ListInfo;

      if (targetList && targetList.detailsLinkCssSelector) {
        await browser.clickOn(targetList.detailsLinkCssSelector);
        await browser.awaitPageLoad();

        const listDetails = (await getComponentFromPage(
          "ListDetailsInfo",
        )) as ListDetailsInfo;

        if (listDetails && listDetails.products) {
          for (let product of listDetails.products) {
            if (product.addToCartButton) {
              await browser.clickOn(product.addToCartButton.cssSelector);
            }
          }
        }
      }
    }
  }

  async function handleBuyItAgain(action: any) {
    await searchForStore(action.parameters.storeName);
    await selectStoreSearchResult(action.parameters.storeName);

    const navigationLink = (await getComponentFromPage(
      "BuyItAgainNavigationLink",
    )) as BuyItAgainNavigationLink;

    if (navigationLink) {
      await browser.clickOn(navigationLink.linkCssSelector);
      await browser.awaitPageLoad();

      const headerSection = (await getComponentFromPage(
        "BuyItAgainHeaderSection",
      )) as BuyItAgainHeaderSection;

      if (headerSection && headerSection.products) {
        if (action.parameters.allItems) {
          for (let product of headerSection.products) {
            if (product.addToCartButton) {
              await browser.clickOn(product.addToCartButton.cssSelector);
            }
          }
        } else {
          const request = `Product: ${action.productName}`;
          const targetProduct = (await getComponentFromPage(
            "ProductTile",
            request,
          )) as ProductTile;
          if (targetProduct && targetProduct.addToCartButton) {
            await browser.clickOn(targetProduct.addToCartButton.cssSelector);
          }
        }
      }
    }
  }

  return message;
}
