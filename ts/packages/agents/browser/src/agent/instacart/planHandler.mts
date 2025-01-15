// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";
import { createInstacartPageTranslator } from "./translator.mjs";
import {
  PurchaseResults,
  PurchaseSummary,
} from "../commerce/schema/shoppingResults.mjs";
import {
  AllListsInfo,
  RecipeInfo,
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
  ShoppingCartButton,
  ShoppingCartStoreSection,
  ShoppingCartDetails,
} from "./schema/pageComponents.mjs";

export async function handleInstacartAction(
  action: any,
  context: ActionContext<BrowserActionContext>,
) {
  let message = "OK";
  let entities: { name: any; type: string[] }[] = [];

  if (!context.sessionContext.agentContext.browserConnector) {
    throw new Error("No connection to browser session.");
  }

  const browser: BrowserConnector =
    context.sessionContext.agentContext.browserConnector;

  const agent = await createInstacartPageTranslator("GPT_4_O_MINI");

  class PlanBuilder {
    private actions: (() => Promise<void>)[] = [];
    private context: Record<string, any> = {}; // Shared context for storing results.

    async execute(): Promise<void> {
      for (const action of this.actions) {
        await action();
      }
    }

    private addAction(actionFn: () => Promise<void>): this {
      this.actions.push(actionFn);
      return this;
    }

    findPageComponent(
      componentName: keyof UIElementSchemas,
      selectionCondition?: string,
      callback?: (result: any) => Promise<void>,
    ): this {
      return this.addAction(async () => {
        const result = await getPageComponent(
          componentName,
          selectionCondition,
        );
        this.context[componentName] = result; // Store the result in the context.
        if (callback) await callback(result);
      });
    }

    followLink(
      linkSelectorOrCallback:
        | string
        | ((context: Record<string, any>) => string),
    ): this {
      return this.addAction(async () => {
        const linkSelector =
          typeof linkSelectorOrCallback === "function"
            ? linkSelectorOrCallback(this.context)
            : linkSelectorOrCallback;

        await followLink(linkSelector);
      });
    }

    searchFor(
      componentName: keyof UIElementSchemas,
      keywords: string,
      callback?: (result: any) => Promise<void>,
    ): this {
      return this.addAction(async () => {
        const result = await searchOnWebsite(componentName, keywords);
        this.context[`search:${componentName}`] = result; // Store the result in the context.
        if (callback) await callback(result);
      });
    }

    thenRun(callback: (context: Record<string, any>) => Promise<void>): this {
      return this.addAction(async () => {
        await callback(this.context);
      });
    }
  }

  switch (action.actionName) {
    case "searchForProductAction":
      await handleFindProduct(action);
      break;
    case "addToCartAction":
      await handleAddToCart(action);
      break;
    case "getShoppingCartAction":
      await handleGetCart(action);
      break;
    case "addToListAction":
      await handleAddToList(action);
      break;
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

  type UIElementSchemas = {
    AllListsInfo: AllListsInfo;
    RecipeInfo: RecipeInfo;
    BuyItAgainHeaderSection: BuyItAgainHeaderSection;
    BuyItAgainNavigationLink: BuyItAgainNavigationLink;
    HomeLink: HomeLink;
    ListDetailsInfo: ListDetailsInfo;
    ListInfo: ListInfo;
    ListsNavigationLink: ListsNavigationLink;
    NearbyStoresList: NearbyStoresList;
    ProductDetailsHeroTile: ProductDetailsHeroTile;
    ProductTile: ProductTile;
    RecipeHeroSection: RecipeHeroSection;
    SearchInput: SearchInput;
    StoreInfo: StoreInfo;
    ShoppingCartButton: ShoppingCartButton;
    ShoppingCartStoreSection: ShoppingCartStoreSection;
    ShoppingCartDetails: ShoppingCartDetails;
  };

  async function getPageComponent<T extends keyof UIElementSchemas>(
    componentType: T,
    selectionCondition?: string,
  ): Promise<UIElementSchemas[T] | undefined> {
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
    return response.data as UIElementSchemas[T];
  }

  async function followLink(linkSelector: string | undefined) {
    if (!linkSelector) return;

    await browser.clickOn(linkSelector);
    await browser.awaitPageInteraction();
    await browser.awaitPageLoad();
  }

  async function goToHomepage() {
    const link = await getPageComponent("HomeLink");
    await followLink(link?.linkCssSelector);
  }

  async function searchOnWebsite<T extends keyof UIElementSchemas>(
    componentType: T,
    keywords: string,
  ): Promise<UIElementSchemas[T] | undefined> {
    if (componentType == "StoreInfo" || componentType == "RecipeInfo") {
      await goToHomepage();
    }

    const selector = await getPageComponent("SearchInput");
    if (!selector) {
      return;
    }

    const searchSelector = selector.cssSelector;

    await browser.clickOn(searchSelector);

    let queryPrefix = "";
    switch (componentType) {
      case "StoreInfo": {
        queryPrefix = "stores: ";
        break;
      }
      case "RecipeInfo": {
        queryPrefix = "recipes: ";
        break;
      }
    }

    await browser.enterTextIn(queryPrefix + keywords, searchSelector);
    await browser.clickOn(selector.submitButtonCssSelector);
    await browser.awaitPageInteraction();
    await browser.awaitPageLoad();

    const request = `Search result: ${keywords}`;
    const result = await getPageComponent(componentType, request);

    return result as UIElementSchemas[T];
  }

  async function addAllProductsToCart(products: ProductTile[]) {
    let results: PurchaseResults = {
      addedToCart: [],
      unavailable: [],
      storeName: action.parameters.storeName,
      deliveryInformation: "",
    };

    for (let product of products) {
      if (product.availability == "Out of stock") {
        results.unavailable.push(product);
      } else {
        if (product.addToCartButtonCssSelector) {
          await browser.clickOn(product.addToCartButtonCssSelector);
          await browser.awaitPageInteraction();
          results.addedToCart.push(product);
        } else {
          results.unavailable.push(product);
        }
      }
    }

    return results;
  }

  function pageActions() {
    return new PlanBuilder();
  }

  async function handleFindProduct(action: any) {
    await pageActions()
      .searchFor("ProductTile", action.parameters.keyword)
      .followLink(
        (context) => context["search:ProductTile"]?.detailsLinkSelector,
      )
      .thenRun(async (context) => {
        const product = context["search:ProductTile"];
        if (product.name) {
          entities.push({
            name: product.name,
            type: ["product"],
          });
        }
      })
      .execute();
  }

  async function handleAddToCart(action: any) {
    await pageActions()
      .findPageComponent("ProductDetailsHeroTile")
      .followLink(
        (context) =>
          context["ProductDetailsHeroTile"]?.addToCartButton.cssSelector,
      )
      .execute();
  }

  async function selectDefaultStoreCart(action: any) {
    await pageActions()
      .findPageComponent("ShoppingCartButton")
      .followLink(
        (context) => context["ShoppingCartButton"]?.detailsLinkCssSelector,
      )
      .findPageComponent("ShoppingCartStoreSection")
      .followLink(
        (context) => context["ShoppingCartButton"]?.detailsButtonCssSelector,
      )
      .execute();
  }

  async function selectStoreCart(action: any) {
    let results: PurchaseResults = {
      addedToCart: [],
      unavailable: [],
      storeName: action.parameters.storeName,
      deliveryInformation: "",
    };

    await pageActions()
      .findPageComponent("ShoppingCartButton")
      .followLink(
        (context) => context["ShoppingCartButton"]?.detailsLinkCssSelector,
      )
      .findPageComponent("ShoppingCartDetails")
      .thenRun(async (context) => {
        const cartDetails = context["ShoppingCartDetails"];
        console.log(cartDetails);

        entities.push({
          name: cartDetails.storeName,
          type: ["store", "shoppingCart"],
        });

        for (let product of cartDetails.productsInCart) {
          results.addedToCart.push(product);

          if (product.name) {
            entities.push({
              name: product.name,
              type: ["product"],
            });
          }
        }

        const friendlyMessage = await agent.getFriendlyPurchaseSummary(results);
        if (friendlyMessage.success) {
          message = (friendlyMessage.data as PurchaseSummary).formattedMessage;
        }
      })
      .execute();
  }

  async function handleGetCart(action: any) {
    if (action.parameters.storeName) {
      await selectStore(action.parameters.storeName);
    } else {
      await selectDefaultStoreCart(action);
    }

    await selectStoreCart(action);
  }

  async function handleAddToList(action: any) {
    await pageActions()
      .findPageComponent("ProductDetailsHeroTile")
      .followLink(
        (context) =>
          context["ProductDetailsHeroTile"]?.addToListButton?.cssSelector,
      )
      .findPageComponent(
        "AllListsInfo",
        `ListName: ${action.parameters.listName}`,
      )
      .thenRun(async (context) => {
        const targetList = context["AllListsInfo"];
        if (targetList?.lists) {
          await browser.clickOn(targetList.lists[0].cssSelector);
          await browser.clickOn(targetList.submitButtonCssSelector);
        }
      })
      .execute();
  }

  async function handleFindStores(action: any) {
    await goToHomepage();
    const storesList = await getPageComponent("NearbyStoresList");
    console.log(storesList);
    return storesList;
  }

  async function handleSetPreferredStore(action: any) {
    const targetStore = await searchOnWebsite(
      "StoreInfo",
      action.parameters.storeName,
    );
    await followLink(targetStore?.detailsLinkCssSelector);

    entities.push({
      name: targetStore?.name,
      type: ["store"],
    });

    // TODO: persist preferrences
  }

  async function handleFindRecipe(action: any) {
    await pageActions()
      .searchFor("RecipeInfo", action.parameters.keyword)
      .followLink(
        (context) => context["search:RecipeInfo"]?.detailsLinkCssSelector,
      )
      .execute();
  }

  async function handleBuyRecipeIngredients(action: any) {
    let results: PurchaseResults = {
      addedToCart: [],
      unavailable: [],
      storeName: action.parameters.storeName,
      deliveryInformation: "",
    };

    await pageActions()
      .searchFor("RecipeInfo", action.parameters.recipeName)
      .followLink(
        (context) => context["search:RecipeInfo"]?.detailsLinkCssSelector,
      )
      .findPageComponent("RecipeHeroSection")
      .thenRun(async (context) => {
        const targetRecipe = context["RecipeHeroSection"];

        entities.push({
          name: targetRecipe?.name,
          type: ["recipe"],
        });

        await browser.clickOn(targetRecipe.addAllIngridientsCssSelector);
        for (let product of targetRecipe.ingredients) {
          results.addedToCart.push(product);

          entities.push({
            name: product.name,
            type: ["product"],
          });
        }

        const friendlyMessage = await agent.getFriendlyPurchaseSummary(results);
        if (friendlyMessage.success) {
          message = (friendlyMessage.data as PurchaseSummary).formattedMessage;
        }
      })
      .execute();
  }

  async function handleBuyListContents(action: any) {
    await selectStore(action.parameters.storeName);

    await pageActions()
      .findPageComponent("ListsNavigationLink")
      .followLink((context) => context["ListsNavigationLink"]?.linkCssSelector)
      .findPageComponent("ListInfo", `List name: ${action.parameters.listName}`)
      .followLink((context) => context["ListInfo"]?.detailsLinkCssSelector)
      .findPageComponent("ListDetailsInfo")
      .thenRun(async (context) => {
        const listDetails = context["ListDetailsInfo"];
        const results = await addAllProductsToCart(listDetails?.products);
        const friendlyMessage = await agent.getFriendlyPurchaseSummary(results);

        if (friendlyMessage.success) {
          message = (friendlyMessage.data as PurchaseSummary).formattedMessage;
        }
      })
      .execute();
  }

  async function selectStore(storeName: string) {
    await goToHomepage();

    await pageActions()
      .findPageComponent("StoreInfo", `Store name: ${storeName}`)
      .followLink((context) => context["StoreInfo"]?.detailsLinkCssSelector)
      .execute();
  }

  async function handleBuyItAgain(action: any) {
    await selectStore(action.parameters.storeName);

    await pageActions()
      .findPageComponent("BuyItAgainNavigationLink")
      .followLink(
        (context) => context["BuyItAgainNavigationLink"]?.linkCssSelector,
      )
      .findPageComponent("BuyItAgainHeaderSection")
      .thenRun(async (context) => {
        const headerSection = context["BuyItAgainHeaderSection"];
        const results = await addAllProductsToCart(headerSection?.products);
        const friendlyMessage = await agent.getFriendlyPurchaseSummary(results);

        if (friendlyMessage.success) {
          message = (friendlyMessage.data as PurchaseSummary).formattedMessage;
        }
      })
      .execute();
  }

  return {
    displayText: message,
    entities: entities,
  };
}
