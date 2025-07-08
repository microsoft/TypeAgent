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

// actionHandler types for entity extraction and structured responses
export interface EntityInfo {
    name: string;
    type: string[];
    metadata?: Record<string, any>;
}

export interface ActionResult {
    displayText: string;
    entities: EntityInfo[];
}

export class EntityCollector {
    private entities: EntityInfo[] = [];

    addEntity(name: string, types: string[], metadata?: any): void {
        // Simple deduplication by name
        const existing = this.entities.find((e) => e.name === name);
        if (existing) {
            // Merge types and metadata
            existing.type = [...new Set([...existing.type, ...types])];
            existing.metadata = { ...existing.metadata, ...metadata };
        } else {
            this.entities.push({ name, type: types, metadata });
        }
    }

    getEntities(): EntityInfo[] {
        return [...this.entities];
    }

    clear(): void {
        this.entities = [];
    }
}

// Context interface for action handler functions
interface ActionHandlerContext {
    browser: BrowserConnector;
    agent: any;
    ui: ReturnType<typeof setupPageActions>;
    entities: EntityCollector;
}

export async function handleInstacartAction(
    action: any,
    context: SessionContext<BrowserActionContext>,
): Promise<ActionResult> {
    if (!context.agentContext.browserConnector) {
        throw new Error("No connection to browser session.");
    }

    const browser: BrowserConnector = context.agentContext.browserConnector;
    const agent = await createInstacartPageTranslator("GPT_4_O_MINI");
    const ui = setupPageActions(browser, agent);

    // Create entity collector and action context
    const entityCollector = new EntityCollector();
    const actionContext: ActionHandlerContext = {
        browser,
        agent,
        ui,
        entities: entityCollector,
    };

    let message = "OK";

    switch (action.actionName) {
        case "searchForProduct":
            message = await handleFindProduct(action, actionContext);
            break;
        case "addToCart":
            message = await handleAddToCart(action, actionContext);
            break;
        case "getShoppingCart":
            message = await handleGetCart(action, actionContext);
            break;
        case "addToList":
            message = await handleAddToList(action, actionContext);
            break;
        case "findNearbyStore":
            message = await handleFindStores(action, actionContext);
            break;
        case "searchForRecipe":
            message = await handleFindRecipe(action, actionContext);
            break;
        case "buyAllInRecipe":
            message = await handleBuyRecipeIngredients(action, actionContext);
            break;
        case "buyAllInList":
            message = await handleBuyListContents(action, actionContext);
            break;
        case "setPreferredStore":
            message = await handleSetPreferredStore(action, actionContext);
            break;
        case "buyItAgain":
            message = await handleBuyItAgain(action, actionContext);
            break;
    }

    return {
        displayText: message,
        entities: entityCollector.getEntities(),
    };
}

async function handleFindProduct(
    action: any,
    ctx: ActionHandlerContext,
): Promise<string> {
    const targetProduct = await ctx.ui.searchOnWebsite(
        "ProductTile",
        action.parameters.keyword,
    );

    // Add entity tracking
    if (targetProduct?.name) {
        ctx.entities.addEntity(targetProduct.name, ["product"], {
            source: "search",
            keyword: action.parameters.keyword,
            price: targetProduct.price,
            brand: targetProduct.brand,
            availability: targetProduct.availability,
        });
    }

    await ctx.ui.followLink(targetProduct?.detailsLinkSelector);
    return `Found and navigated to ${targetProduct?.name || "product"}`;
}

async function handleAddToCart(
    action: any,
    ctx: ActionHandlerContext,
): Promise<string> {
    const targetProduct = await ctx.ui.getPageComponent(
        "ProductDetailsHeroTile",
    );

    // Add entity tracking
    if (targetProduct?.productName) {
        ctx.entities.addEntity(targetProduct.productName, ["product"], {
            source: "product_page",
            price: targetProduct.price,
            rating: targetProduct.rating,
            storeName: targetProduct.storeName,
            physicalLocation: targetProduct.physicalLocationInStore,
        });
    }

    if (targetProduct?.addToCartButton) {
        await ctx.browser.clickOn(targetProduct.addToCartButton.cssSelector);
        return `Added ${targetProduct.productName || "product"} to cart`;
    }

    return "Could not add product to cart";
}

// Add default cart support function
async function selectDefaultStoreCart(
    ctx: ActionHandlerContext,
): Promise<void> {
    const cartButton = await ctx.ui.getPageComponent("ShoppingCartButton");
    await ctx.ui.followLink(cartButton?.detailsLinkCssSelector);
}

async function selectStoreCart(
    action: any,
    ctx: ActionHandlerContext,
): Promise<void> {
    const cartButton = await ctx.ui.getPageComponent("ShoppingCartButton");
    await ctx.ui.followLink(cartButton?.detailsLinkCssSelector);
}

async function handleGetCart(
    action: any,
    ctx: ActionHandlerContext,
): Promise<string> {
    // Support both storeName and default cart (matches planHandler)
    if (action.parameters.storeName) {
        await selectStore(action.parameters.storeName, ctx);
    } else {
        await selectDefaultStoreCart(ctx);
    }

    await selectStoreCart(action, ctx);

    const cartDetails = await ctx.ui.getPageComponent("ShoppingCartDetails");

    if (cartDetails) {
        // Add store entity
        ctx.entities.addEntity(
            cartDetails.storeName,
            ["store", "shoppingCart"],
            {
                totalAmount: cartDetails.totalAmount,
                deliveryInfo: cartDetails.deliveryInformation,
            },
        );

        // Add product entities
        if (cartDetails.productsInCart) {
            for (let product of cartDetails.productsInCart) {
                ctx.entities.addEntity(product.name, ["product"], {
                    source: "cart",
                    price: product.price,
                    quantity: product.quantity,
                    store: cartDetails.storeName,
                });
            }
        }

        const results: PurchaseResults = {
            addedToCart: cartDetails.productsInCart || [],
            unavailable: [],
            storeName: cartDetails.storeName,
            deliveryInformation: cartDetails.deliveryInformation,
        };

        const friendlyMessage =
            await ctx.agent.getFriendlyPurchaseSummary(results);
        if (friendlyMessage.success) {
            return (friendlyMessage.data as PurchaseSummary).formattedMessage;
        }
    }

    return "Retrieved cart contents";
}

async function handleAddToList(
    action: any,
    ctx: ActionHandlerContext,
): Promise<string> {
    const targetProduct = await ctx.ui.getPageComponent(
        "ProductDetailsHeroTile",
    );

    // Add product entity
    if (targetProduct?.productName) {
        ctx.entities.addEntity(targetProduct.productName, ["product"], {
            source: "product_page",
            price: targetProduct.price,
            targetList: action.parameters.listName,
        });
    }

    if (targetProduct?.addToListButton) {
        await ctx.browser.clickOn(targetProduct.addToListButton.cssSelector);

        const request = `ListName: ${action.parameters.listName}`;
        const targetList = await ctx.ui.getPageComponent(
            "AllListsInfo",
            request,
        );

        if (targetList?.lists) {
            // Add list entity
            ctx.entities.addEntity(action.parameters.listName, ["list"], {
                source: "selection",
            });

            await ctx.browser.clickOn(targetList.lists[0].cssSelector);
            await ctx.browser.clickOn(targetList.submitButtonCssSelector);

            return `Added ${targetProduct.productName || "product"} to ${action.parameters.listName}`;
        }
    }

    return "Could not add product to list";
}

async function goToHomepage(ctx: ActionHandlerContext): Promise<void> {
    const link = await ctx.ui.getPageComponent("HomeLink");
    await ctx.ui.followLink(link?.linkCssSelector);
}

async function handleFindStores(
    action: any,
    ctx: ActionHandlerContext,
): Promise<string> {
    await goToHomepage(ctx);
    const storesList = await ctx.ui.getPageComponent("NearbyStoresList");

    // Add store entities
    if (storesList?.stores) {
        for (let store of storesList.stores) {
            ctx.entities.addEntity(store.name, ["store"], {
                source: "nearby_search",
                subtitle: store.subtitle,
            });
        }
        return `Found ${storesList.stores.length} nearby stores`;
    }

    return "No nearby stores found";
}

async function handleSetPreferredStore(
    action: any,
    ctx: ActionHandlerContext,
): Promise<string> {
    const targetStore = await ctx.ui.searchOnWebsite(
        "StoreInfo",
        action.parameters.storeName,
    );

    // Add store entity
    if (targetStore?.name) {
        ctx.entities.addEntity(targetStore.name, ["store"], {
            source: "preference_selection",
            subtitle: targetStore.subtitle,
        });
    }

    await ctx.ui.followLink(targetStore?.detailsLinkCssSelector);
    return `Set preferred store to ${targetStore?.name || action.parameters.storeName}`;
}

async function handleFindRecipe(
    action: any,
    ctx: ActionHandlerContext,
): Promise<string> {
    const recipe = await ctx.ui.searchOnWebsite(
        "RecipeInfo",
        action.parameters.keyword,
    );

    // Add recipe entity
    if (recipe?.name) {
        ctx.entities.addEntity(recipe.name, ["recipe"], {
            source: "search",
            keyword: action.parameters.keyword,
            subtitle: recipe.subtitle,
        });
    }

    if (recipe && recipe.detailsLinkCssSelector) {
        await ctx.ui.followLink(recipe.detailsLinkCssSelector);
        return `Found and navigated to recipe: ${recipe.name}`;
    }

    return `Recipe not found for: ${action.parameters.keyword}`;
}

async function handleBuyRecipeIngredients(
    action: any,
    ctx: ActionHandlerContext,
): Promise<string> {
    let results: PurchaseResults = {
        addedToCart: [],
        unavailable: [],
        storeName: action.parameters.storeName,
        deliveryInformation: "",
    };

    const recipe = await ctx.ui.searchOnWebsite(
        "RecipeInfo",
        action.parameters.recipeName,
    );

    // Add recipe entity from search
    if (recipe?.name) {
        ctx.entities.addEntity(recipe.name, ["recipe"], {
            source: "search",
            subtitle: recipe.subtitle,
        });
    }

    if (recipe && recipe.detailsLinkCssSelector) {
        await ctx.ui.followLink(recipe.detailsLinkCssSelector);

        const targetRecipe = await ctx.ui.getPageComponent("RecipeHeroSection");

        // Add detailed recipe entity
        if (targetRecipe?.recipeName) {
            ctx.entities.addEntity(targetRecipe.recipeName, ["recipe"], {
                source: "details",
                summary: targetRecipe.summary,
                ingredientCount: targetRecipe.ingredients?.length || 0,
            });
        }

        if (targetRecipe?.addAllIngridientsCssSelector) {
            await ctx.browser.clickOn(
                targetRecipe.addAllIngridientsCssSelector,
            );

            // Add ingredient entities
            for (let product of targetRecipe.ingredients) {
                results.addedToCart.push(product);

                ctx.entities.addEntity(product.name, ["product"], {
                    source: "recipe_ingredient",
                    parentRecipe: targetRecipe.recipeName,
                    price: product.price,
                    brand: product.brand,
                });
            }

            const friendlyMessage =
                await ctx.agent.getFriendlyPurchaseSummary(results);
            if (friendlyMessage.success) {
                return (friendlyMessage.data as PurchaseSummary)
                    .formattedMessage;
            }
        }
    }

    return "Added recipe ingredients to cart";
}

async function handleBuyListContents(
    action: any,
    ctx: ActionHandlerContext,
): Promise<string> {
    let results: PurchaseResults = {
        addedToCart: [],
        unavailable: [],
        storeName: action.parameters.storeName,
        deliveryInformation: "",
    };

    await selectStore(action.parameters.storeName, ctx);

    const navigationLink = await ctx.ui.getPageComponent("ListsNavigationLink");

    if (navigationLink?.linkCssSelector) {
        await ctx.ui.followLink(navigationLink?.linkCssSelector);

        const request = `List name: ${action.parameters.listName}`;
        const targetList = await ctx.ui.getPageComponent("ListInfo", request);

        // Add list entity
        if (targetList?.name) {
            ctx.entities.addEntity(targetList.name, ["list"], {
                source: "selection",
            });
        }

        if (targetList?.detailsLinkCssSelector) {
            await ctx.ui.followLink(targetList.detailsLinkCssSelector);
            const listDetails =
                await ctx.ui.getPageComponent("ListDetailsInfo");

            if (listDetails && listDetails.products) {
                results = await ctx.ui.addAllProductsToCart(
                    listDetails.products,
                    action.parameters.storeName,
                );

                // Add product entities
                results.addedToCart.forEach((product) => {
                    ctx.entities.addEntity(product.name, ["product"], {
                        source: "list_item",
                        parentList: listDetails.name,
                        store: action.parameters.storeName,
                        price: product.price,
                    });
                });

                results.unavailable.forEach((product) => {
                    ctx.entities.addEntity(product.name, ["product"], {
                        source: "list_item",
                        parentList: listDetails.name,
                        store: action.parameters.storeName,
                        status: "unavailable",
                    });
                });
            }

            const friendlyMessage =
                await ctx.agent.getFriendlyPurchaseSummary(results);
            if (friendlyMessage.success) {
                return (friendlyMessage.data as PurchaseSummary)
                    .formattedMessage;
            }
        }
    }

    return `Processed items from ${action.parameters.listName}`;
}

async function selectStore(
    storeName: string,
    ctx: ActionHandlerContext,
): Promise<void> {
    await goToHomepage(ctx);
    const request = `Store name: ${storeName}`;
    const targetStore = await ctx.ui.getPageComponent("StoreInfo", request);

    // Add store entity
    if (targetStore?.name) {
        ctx.entities.addEntity(targetStore.name, ["store"], {
            source: "selection",
            subtitle: targetStore.subtitle,
        });
    }

    await ctx.ui.followLink(targetStore?.detailsLinkCssSelector);
}

async function handleBuyItAgain(
    action: any,
    ctx: ActionHandlerContext,
): Promise<string> {
    let results: PurchaseResults = {
        addedToCart: [],
        unavailable: [],
        storeName: action.parameters.storeName,
        deliveryInformation: "",
    };

    await selectStore(action.parameters.storeName, ctx);

    const navigationLink = await ctx.ui.getPageComponent(
        "BuyItAgainNavigationLink",
    );

    if (navigationLink) {
        await ctx.ui.followLink(navigationLink.linkCssSelector);

        const headerSection = await ctx.ui.getPageComponent(
            "BuyItAgainHeaderSection",
        );

        if (headerSection?.products) {
            if (action.parameters.allItems) {
                results = await ctx.ui.addAllProductsToCart(
                    headerSection?.products,
                    action.parameters.storeName,
                );

                // Add product entities
                results.addedToCart.forEach((product) => {
                    ctx.entities.addEntity(product.name, ["product"], {
                        source: "buy_it_again",
                        store: action.parameters.storeName,
                        price: product.price,
                        previousPurchase: true,
                    });
                });

                results.unavailable.forEach((product) => {
                    ctx.entities.addEntity(product.name, ["product"], {
                        source: "buy_it_again",
                        store: action.parameters.storeName,
                        status: "unavailable",
                        previousPurchase: true,
                    });
                });
            } else if (action.parameters.productName) {
                const request = `Product: ${action.parameters.productName}`;
                const targetProduct = await ctx.ui.getPageComponent(
                    "ProductTile",
                    request,
                );
                if (targetProduct && targetProduct.addToCartButtonCssSelector) {
                    await ctx.browser.clickOn(
                        targetProduct.addToCartButtonCssSelector,
                    );
                    await ctx.browser.awaitPageInteraction();

                    results.addedToCart.push(targetProduct);
                    ctx.entities.addEntity(targetProduct.name, ["product"], {
                        source: "buy_it_again",
                        store: action.parameters.storeName,
                        price: targetProduct.price,
                        previousPurchase: true,
                        userSelected: true,
                    });
                }
            }
        }

        const friendlyMessage =
            await ctx.agent.getFriendlyPurchaseSummary(results);
        if (friendlyMessage.success) {
            return (friendlyMessage.data as PurchaseSummary).formattedMessage;
        }
    }

    return "Added items from Buy It Again";
}
