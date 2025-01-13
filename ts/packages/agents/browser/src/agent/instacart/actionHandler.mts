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
  NearbyStoresList,
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
      await handleFindProduct(action);
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

  async function getPageComponent<T>(
    componentType: string,
    selectionCondition?: string,
  ): Promise<T | undefined> {
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
      console.error("Attempt to get page component failed");
      console.error(response.message);
      return undefined;
    }

    console.timeEnd(timerName);
    return response.data as T;
  }

  async function handleFindProduct(action: any) {
    await searchForProduct(action.parameters.keyword);
    await selectProductSearchResult(action.parameters.keyword);
  }

  async function searchForProduct(productName: string) {
    const selector = await getPageComponent<SearchInput>("SearchInput");
    if (!selector) {
      return;
    }

    const searchSelector = selector.cssSelector;

    await browser.clickOn(searchSelector);
    await browser.enterTextIn(productName, searchSelector);
    await browser.clickOn(selector.submitButtonCssSelector);
    await browser.awaitPageInteraction();
    await browser.awaitPageLoad();
  }

  async function selectProductSearchResult(productName: string) {
    const request = `Search result: ${productName}`;
    const targetProduct = await getPageComponent<ProductTile>(
      "ProductTile",
      request,
    );

    await followLink(targetProduct?.detailsLinkSelector);
  }

  async function followLink(linkSelector: string | undefined) {
    if (!linkSelector) return;

    await browser.clickOn(linkSelector);
    await browser.awaitPageInteraction();
    await browser.awaitPageLoad();
  }

  async function handleAddToCart(action: any) {
    const targetProduct = await getPageComponent<ProductDetailsHeroTile>(
      "ProductDetailsHeroTile",
    );

    if (targetProduct?.addToCartButton) {
      await browser.clickOn(targetProduct.addToCartButton.cssSelector);
    }
  }

  async function handleAddToList(action: any) {
    const targetProduct = await getPageComponent<ProductDetailsHeroTile>(
      "ProductDetailsHeroTile",
    );

    if (targetProduct?.addToListButton) {
      await browser.clickOn(targetProduct.addToListButton.cssSelector);

      // this launches a popup with the available lists
      const request = `ListName: ${action.listName}`;
      const targetList = await getPageComponent<AllListsInfo>(
        "AllListsInfo",
        request,
      );

      if (targetList?.lists) {
        await browser.clickOn(targetList.lists[0].cssSelector);
        await browser.clickOn(targetList.submitButtonCssSelector);
      }
    }
  }

  async function goToHomepage() {
    const link = await getPageComponent<HomeLink>("HomeLink");
    console.log(link);

    await followLink(link?.linkCssSelector);
  }

  async function handleFindStores(action: any) {
    await goToHomepage();
    const storesList =
      await getPageComponent<NearbyStoresList>("NearbyStoresList");
    console.log(storesList);
    return storesList;
  }

  async function searchForStore(storeName: string) {
    await goToHomepage();
    const selector = await getPageComponent<SearchInput>("SearchInput");

    if (selector?.cssSelector && selector?.submitButtonCssSelector) {
      const searchSelector = selector.cssSelector;

      await browser.clickOn(searchSelector);
      await browser.enterTextIn("store: " + storeName, searchSelector);
      await browser.clickOn(selector.submitButtonCssSelector);
      await browser.awaitPageInteraction();
      await browser.awaitPageLoad();
    }
  }

  async function selectStoreSearchResult(storeName: string) {
    const request = `${storeName}`;
    const targetStore = await getPageComponent<StoreInfo>("StoreInfo", request);

    await followLink(targetStore?.storeLinkCssSelector);
  }

  async function handleSetPreferredStore(action: any) {
    await searchForStore(action.parameters.storeName);
    await selectStoreSearchResult(action.parameters.storeName);

    // TODO: persist preferrences
  }

  async function searchForRecipe(recipeKeywords: string) {
    await goToHomepage();
    const selector = await getPageComponent<SearchInput>("SearchInput");
    if (!selector) {
      return;
    }
    const searchSelector = selector.cssSelector;

    await browser.clickOn(searchSelector);
    await browser.enterTextIn("recipe: " + recipeKeywords, searchSelector);
    await browser.clickOn(selector.submitButtonCssSelector);
    await browser.awaitPageInteraction();
    await browser.awaitPageLoad(5000);
  }

  async function selectRecipeSearchResult(recipeKeywords: string) {
    const request = `${recipeKeywords}`;
    const allRecipes = await getPageComponent<AllRecipeSearchResults>(
      "AllRecipeSearchResults",
      request,
    );

    console.log(allRecipes);
    if (allRecipes && allRecipes.recipes.length > 0) {
      await followLink(allRecipes.recipes[0].recipeLinkCssSelector);
    }
  }

  async function handleFindRecipe(action: any) {
    await searchForRecipe(action.parameters.keyword);
    await selectRecipeSearchResult(action.parameters.keyword);
  }

  async function handleBuyRecipeIngredients(action: any) {
    await searchForRecipe(action.parameters.keywords);
    await selectRecipeSearchResult(action.parameters.keywords);

    const targetRecipe =
      await getPageComponent<RecipeHeroSection>("RecipeHeroSection");

    if (targetRecipe?.addAllIngridientsCssSelector) {
      await browser.clickOn(targetRecipe.addAllIngridientsCssSelector);
    }
  }

  async function handleBuyListContents(action: any) {
    await selectStore(action.parameters.storeName);

    const navigationLink = await getPageComponent<ListsNavigationLink>(
      "ListsNavigationLink",
    );

    if (navigationLink?.linkCssSelector) {
      await followLink(navigationLink?.linkCssSelector);

      const request = `List name: ${action.parameters.listName}`;
      const targetList = await getPageComponent<ListInfo>("ListInfo", request);

      if (targetList?.detailsLinkCssSelector) {
        await followLink(targetList.detailsLinkCssSelector);

        const listDetails =
          await getPageComponent<ListDetailsInfo>("ListDetailsInfo");

        if (listDetails && listDetails.products) {
          for (let product of listDetails.products) {
            if (product.addToCartButtonCssSelector) {
              await browser.clickOn(product.addToCartButtonCssSelector);
            }
          }
        }
      }
    }
  }

  async function selectStore(storeName: string) {
    await goToHomepage();
    const request = `Store name: ${storeName}`;
    const targetStore = await getPageComponent<StoreInfo>("StoreInfo", request);

    console.log(targetStore);
    await followLink(targetStore?.storeLinkCssSelector);
  }

  async function handleBuyItAgain(action: any) {
    await selectStore(action.parameters.storeName);

    const navigationLink = await getPageComponent<BuyItAgainNavigationLink>(
      "BuyItAgainNavigationLink",
    );

    console.log(navigationLink);

    if (navigationLink) {
      await followLink(navigationLink.linkCssSelector);

      const headerSection = await getPageComponent<BuyItAgainHeaderSection>(
        "BuyItAgainHeaderSection",
      );
      console.log(headerSection);

      if (headerSection?.products) {
        if (action.parameters.allItems) {
          for (let product of headerSection.products) {
            if (product.addToCartButtonCssSelector) {
              await browser.clickOn(product.addToCartButtonCssSelector);
              await browser.awaitPageInteraction();
            }
          }
        } else {
          const request = `Product: ${action.productName}`;
          const targetProduct = await getPageComponent<ProductTile>(
            "ProductTile",
            request,
          );
          if (targetProduct && targetProduct.addToCartButtonCssSelector) {
            await browser.clickOn(targetProduct.addToCartButtonCssSelector);
            await browser.awaitPageInteraction();
          }
        }
      }
    }
  }

  return message;
}
