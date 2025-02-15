// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";
import { createInstacartPageTranslator } from "./translator.mjs";

import {
    PurchaseResults,
    PurchaseSummary,
} from "../commerce/schema/shoppingResults.mjs";
import { setupPageActions } from "./pageActions.mjs";

export async function handleInstacartAction(
    action: any,
    context: SessionContext<BrowserActionContext>,
) {
    let message = "OK";
    if (!context.agentContext.browserConnector) {
        throw new Error("No connection to browser session.");
    }

    const browser: BrowserConnector = context.agentContext.browserConnector;

    const agent = await createInstacartPageTranslator("GPT_4_O_MINI");

    const ui = setupPageActions(browser, agent);

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

    async function handleFindProduct(action: any) {
        const targetProduct = await ui.searchOnWebsite(
            "ProductTile",
            action.parameters.keyword,
        );
        await ui.followLink(targetProduct?.detailsLinkSelector);
    }

    async function handleAddToCart(action: any) {
        const targetProduct = await ui.getPageComponent(
            "ProductDetailsHeroTile",
        );

        if (targetProduct?.addToCartButton) {
            await browser.clickOn(targetProduct.addToCartButton.cssSelector);
        }
    }

    async function selectStoreCart(action: any) {
        const cartButton = await ui.getPageComponent("ShoppingCartButton");
        console.log(cartButton);

        await ui.followLink(cartButton?.detailsLinkCssSelector);

        const cartDetails = await ui.getPageComponent("ShoppingCartDetails");
        console.log(cartDetails);
    }

    async function handleGetCart(action: any) {
        await selectStore(action.parameters.storeName);
        await selectStoreCart(action);
    }

    async function handleAddToList(action: any) {
        const targetProduct = await ui.getPageComponent(
            "ProductDetailsHeroTile",
        );

        if (targetProduct?.addToListButton) {
            await browser.clickOn(targetProduct.addToListButton.cssSelector);

            // this launches a popup with the available lists
            const request = `ListName: ${action.listName}`;
            const targetList = await ui.getPageComponent(
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
        const link = await ui.getPageComponent("HomeLink");
        console.log(link);

        await ui.followLink(link?.linkCssSelector);
    }

    async function handleFindStores(action: any) {
        await goToHomepage();
        const storesList = await ui.getPageComponent("NearbyStoresList");
        console.log(storesList);
        return storesList;
    }

    async function handleSetPreferredStore(action: any) {
        const targetStore = await ui.searchOnWebsite(
            "StoreInfo",
            action.parameters.storeName,
        );
        await ui.followLink(targetStore?.detailsLinkCssSelector);

        // TODO: persist preferences
    }

    async function handleFindRecipe(action: any) {
        const recipe = await ui.searchOnWebsite(
            "RecipeInfo",
            action.parameters.keyword,
        );

        if (recipe && recipe.detailsLinkCssSelector) {
            await ui.followLink(recipe.detailsLinkCssSelector);
        }
    }

    async function handleBuyRecipeIngredients(action: any) {
        let results: PurchaseResults = {
            addedToCart: [],
            unavailable: [],
            storeName: action.parameters.storeName,
            deliveryInformation: "",
        };

        const recipe = await ui.searchOnWebsite(
            "RecipeInfo",
            action.parameters.recipeName,
        );

        if (recipe && recipe.detailsLinkCssSelector) {
            await ui.followLink(recipe.detailsLinkCssSelector);

            const targetRecipe = await ui.getPageComponent("RecipeHeroSection");

            if (targetRecipe?.addAllIngridientsCssSelector) {
                await browser.clickOn(
                    targetRecipe.addAllIngridientsCssSelector,
                );

                for (let product of targetRecipe.ingredients) {
                    results.addedToCart.push(product);
                }

                const friendlyMessage =
                    await agent.getFriendlyPurchaseSummary(results);
                if (friendlyMessage.success) {
                    message = (friendlyMessage.data as PurchaseSummary)
                        .formattedMessage;
                }
            }
        }
    }

    async function handleBuyListContents(action: any) {
        let results: PurchaseResults = {
            addedToCart: [],
            unavailable: [],
            storeName: action.parameters.storeName,
            deliveryInformation: "",
        };

        await selectStore(action.parameters.storeName);

        const navigationLink = await ui.getPageComponent("ListsNavigationLink");
        console.log(navigationLink);

        if (navigationLink?.linkCssSelector) {
            await ui.followLink(navigationLink?.linkCssSelector);

            const request = `List name: ${action.parameters.listName}`;
            const targetList = await ui.getPageComponent("ListInfo", request);

            if (targetList?.detailsLinkCssSelector) {
                await ui.followLink(targetList.detailsLinkCssSelector);
                const listDetails =
                    await ui.getPageComponent("ListDetailsInfo");

                if (listDetails && listDetails.products) {
                    results = await ui.addAllProductsToCart(
                        listDetails.products,
                        action.parameters.storeName,
                    );
                }

                const friendlyMessage =
                    await agent.getFriendlyPurchaseSummary(results);
                if (friendlyMessage.success) {
                    message = (friendlyMessage.data as PurchaseSummary)
                        .formattedMessage;
                }
            }
        }
    }

    async function selectStore(storeName: string) {
        await goToHomepage();
        const request = `Store name: ${storeName}`;
        const targetStore = await ui.getPageComponent("StoreInfo", request);

        console.log(targetStore);
        await ui.followLink(targetStore?.detailsLinkCssSelector);
    }

    async function handleBuyItAgain(action: any) {
        let results: PurchaseResults = {
            addedToCart: [],
            unavailable: [],
            storeName: action.parameters.storeName,
            deliveryInformation: "",
        };

        await selectStore(action.parameters.storeName);

        const navigationLink = await ui.getPageComponent(
            "BuyItAgainNavigationLink",
        );

        console.log(navigationLink);

        if (navigationLink) {
            await ui.followLink(navigationLink.linkCssSelector);

            const headerSection = await ui.getPageComponent(
                "BuyItAgainHeaderSection",
            );
            console.log(headerSection);

            if (headerSection?.products) {
                if (action.parameters.allItems) {
                    results = await ui.addAllProductsToCart(
                        headerSection?.products,
                        action.parameters.storeName,
                    );
                } else {
                    const request = `Product: ${action.productName}`;
                    const targetProduct = await ui.getPageComponent(
                        "ProductTile",
                        request,
                    );
                    if (
                        targetProduct &&
                        targetProduct.addToCartButtonCssSelector
                    ) {
                        await browser.clickOn(
                            targetProduct.addToCartButtonCssSelector,
                        );
                        await browser.awaitPageInteraction();
                    }
                }
            }

            const friendlyMessage =
                await agent.getFriendlyPurchaseSummary(results);

            if (friendlyMessage.success) {
                message = (friendlyMessage.data as PurchaseSummary)
                    .formattedMessage;
            }
        }
    }

    return message;
}
