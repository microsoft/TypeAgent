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

import { setupPageActions, UIElementSchemas } from "./pageActions.mjs";
import { InstacartActions } from "./schema/userActions.mjs";

export async function handleInstacartAction(
    action: InstacartActions,
    context: SessionContext<BrowserActionContext>,
) {
    let message = "OK";
    let entities: { name: any; type: string[] }[] = [];

    if (!context.agentContext.browserConnector) {
        throw new Error("No connection to browser session.");
    }

    const browser: BrowserConnector = context.agentContext.browserConnector;

    const agent = await createInstacartPageTranslator("GPT_4_O_MINI");

    const uiActions = setupPageActions(browser, agent);

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
                const result = await uiActions.getPageComponent(
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

                await uiActions.followLink(linkSelector);
            });
        }

        searchFor(
            componentName: keyof UIElementSchemas,
            keywords: string,
            callback?: (result: any) => Promise<void>,
        ): this {
            return this.addAction(async () => {
                const result = await uiActions.searchOnWebsite(
                    componentName,
                    keywords,
                );
                this.context[`search:${componentName}`] = result; // Store the result in the context.
                if (callback) await callback(result);
            });
        }

        thenRun(
            callback: (context: Record<string, any>) => Promise<void>,
        ): this {
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
                    context["ProductDetailsHeroTile"]?.addToCartButton
                        .cssSelector,
            )
            .execute();
    }

    async function selectDefaultStoreCart(action: any) {
        await pageActions()
            .findPageComponent("ShoppingCartButton")
            .followLink(
                (context) =>
                    context["ShoppingCartButton"]?.detailsLinkCssSelector,
            )
            .findPageComponent("ShoppingCartStoreSection")
            .followLink(
                (context) =>
                    context["ShoppingCartButton"]?.detailsButtonCssSelector,
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
                (context) =>
                    context["ShoppingCartButton"]?.detailsLinkCssSelector,
            )
            .findPageComponent("ShoppingCartDetails")
            .thenRun(async (context) => {
                const cartDetails = context["ShoppingCartDetails"];
                // console.log(cartDetails);

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

                const friendlyMessage =
                    await agent.getFriendlyPurchaseSummary(results);
                if (friendlyMessage.success) {
                    message = (friendlyMessage.data as PurchaseSummary)
                        .formattedMessage;
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
                    context["ProductDetailsHeroTile"]?.addToListButton
                        ?.cssSelector,
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
        await uiActions.goToHomepage();

        await pageActions()
            .findPageComponent("NearbyStoresList")
            .thenRun(async (context) => {
                const storesList = context["NearbyStoresList"];
                console.log(storesList);

                for (let store of storesList.stores) {
                    entities.push({
                        name: store.name,
                        type: ["store"],
                    });
                }

                // TODO: build friendly message
            })
            .execute();
    }

    async function handleSetPreferredStore(action: any) {
        await pageActions()
            .searchFor("StoreInfo", action.parameters.storeName)
            .followLink(
                (context) =>
                    context["search:StoreInfo"]?.detailsLinkCssSelector,
            )
            .thenRun(async (context) => {
                const targetStore = context["search:StoreInfo"];
                entities.push({
                    name: targetStore?.name,
                    type: ["store"],
                });
                // TODO: persist preferences
            })
            .execute();
    }

    async function handleFindRecipe(action: any) {
        await pageActions()
            .searchFor("RecipeInfo", action.parameters.keyword)
            .followLink(
                (context) =>
                    context["search:RecipeInfo"]?.detailsLinkCssSelector,
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
                (context) =>
                    context["search:RecipeInfo"]?.detailsLinkCssSelector,
            )
            .findPageComponent("RecipeHeroSection")
            .thenRun(async (context) => {
                const targetRecipe = context["RecipeHeroSection"];

                entities.push({
                    name: targetRecipe?.name,
                    type: ["recipe"],
                });

                await browser.clickOn(
                    targetRecipe.addAllIngridientsCssSelector,
                );
                for (let product of targetRecipe.ingredients) {
                    results.addedToCart.push(product);

                    entities.push({
                        name: product.name,
                        type: ["product"],
                    });
                }

                const friendlyMessage =
                    await agent.getFriendlyPurchaseSummary(results);
                if (friendlyMessage.success) {
                    message = (friendlyMessage.data as PurchaseSummary)
                        .formattedMessage;
                }
            })
            .execute();
    }

    async function handleBuyListContents(action: any) {
        await selectStore(action.parameters.storeName);

        await pageActions()
            .findPageComponent("ListsNavigationLink")
            .followLink(
                (context) => context["ListsNavigationLink"]?.linkCssSelector,
            )
            .findPageComponent(
                "ListInfo",
                `List name: ${action.parameters.listName}`,
            )
            .followLink(
                (context) => context["ListInfo"]?.detailsLinkCssSelector,
            )
            .findPageComponent("ListDetailsInfo")
            .thenRun(async (context) => {
                const listDetails = context["ListDetailsInfo"];
                const results = await uiActions.addAllProductsToCart(
                    listDetails?.products,
                    action.parameters.storeName,
                );
                const friendlyMessage =
                    await agent.getFriendlyPurchaseSummary(results);

                if (friendlyMessage.success) {
                    message = (friendlyMessage.data as PurchaseSummary)
                        .formattedMessage;
                }
            })
            .execute();
    }

    async function selectStore(storeName: string) {
        await uiActions.goToHomepage();

        await pageActions()
            .findPageComponent("StoreInfo", `Store name: ${storeName}`)
            .followLink(
                (context) => context["StoreInfo"]?.detailsLinkCssSelector,
            )
            .execute();
    }

    async function handleBuyItAgain(action: any) {
        await selectStore(action.parameters.storeName);

        await pageActions()
            .findPageComponent("BuyItAgainNavigationLink")
            .followLink(
                (context) =>
                    context["BuyItAgainNavigationLink"]?.linkCssSelector,
            )
            .findPageComponent("BuyItAgainHeaderSection")
            .thenRun(async (context) => {
                const headerSection = context["BuyItAgainHeaderSection"];
                const results = await uiActions.addAllProductsToCart(
                    headerSection?.products,
                    action.parameters.storeName,
                );

                const friendlyMessage =
                    await agent.getFriendlyPurchaseSummary(results);
                if (friendlyMessage.success) {
                    message = (friendlyMessage.data as PurchaseSummary)
                        .formattedMessage;
                }
            })
            .execute();
    }

    return {
        displayText: message,
        entities: entities,
    };
}
