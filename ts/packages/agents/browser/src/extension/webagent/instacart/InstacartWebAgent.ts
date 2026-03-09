// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionResult,
    AppAgent,
    AppAgentManifest,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import { WebAgent, WebAgentContext } from "../WebAgentContext";
import { extractComponent, PageComponentDefinition } from "../webAgentRpc";
import {
    ContinuationState,
    continuationStorage,
} from "../../contentScript/webAgentStorage";
import { platformAdapter } from "../../contentScript/platformAdapter";
import {
    SearchInput,
    ProductTile,
    ShoppingCartButton,
    ShoppingCartDetails,
    StoreInfo,
    NearbyStoresList,
    NavigationLink,
    SearchInputType,
    ProductTileType,
    ShoppingCartButtonType,
    ShoppingCartDetailsType,
    StoreInfoType,
    NearbyStoresListType,
    NavigationLinkType,
} from "../common/pageComponents";

declare global {
    interface Window {
        registerTypeAgent?: (
            name: string,
            manifest: AppAgentManifest,
            agent: AppAgent,
        ) => Promise<void>;
    }
}

const INSTACART_URL_PATTERNS = [/instacart\.com/];

const INSTACART_SCHEMA_TS = `
export type InstacartActions =
    | SearchForProduct
    | AddToCart
    | RemoveFromCart
    | GetShoppingCart
    | AddToList
    | BuyAllInList
    | SearchForRecipe
    | BuyAllInRecipe
    | SaveRecipe
    | SetPreferredStore
    | FindNearbyStore
    | BuyItAgain;

export type SearchForProduct = {
    actionName: "searchForProduct";
    parameters: {
        keyword: string;
        storeName?: string;
    };
};

export type AddToCart = {
    actionName: "addToCart";
    parameters: {
        productName: string;
    };
};

export type RemoveFromCart = {
    actionName: "removeFromCart";
    parameters: {
        productName: string;
    };
};

export type GetShoppingCart = {
    actionName: "getShoppingCart";
    parameters: {
        storeName?: string;
    };
};

export type AddToList = {
    actionName: "addToList";
    parameters: {
        listName: string;
        productName: string;
    };
};

export type BuyAllInList = {
    actionName: "buyAllInList";
    parameters: {
        listName: string;
        storeName?: string;
    };
};

export type SearchForRecipe = {
    actionName: "searchForRecipe";
    parameters: {
        keyword: string;
    };
};

export type BuyAllInRecipe = {
    actionName: "buyAllInRecipe";
    parameters: {
        recipeName: string;
        storeName?: string;
    };
};

export type SaveRecipe = {
    actionName: "saveRecipe";
    parameters: {
        recipeName: string;
    };
};

export type SetPreferredStore = {
    actionName: "setPreferredStore";
    parameters: {
        storeName: string;
    };
};

export type FindNearbyStore = {
    actionName: "findNearbyStore";
};

export type BuyItAgain = {
    actionName: "buyItAgain";
    parameters: {
        storeName: string;
        allItems?: boolean;
        productName?: string;
    };
};
`;

type InstacartActions =
    | SearchForProduct
    | AddToCart
    | RemoveFromCart
    | GetShoppingCart
    | AddToList
    | BuyAllInList
    | SearchForRecipe
    | BuyAllInRecipe
    | SaveRecipe
    | SetPreferredStore
    | FindNearbyStore
    | BuyItAgain;

type SearchForProduct = {
    actionName: "searchForProduct";
    parameters: { keyword: string; storeName?: string };
};
type AddToCart = {
    actionName: "addToCart";
    parameters: { productName: string };
};
type RemoveFromCart = {
    actionName: "removeFromCart";
    parameters: { productName: string };
};
type GetShoppingCart = {
    actionName: "getShoppingCart";
    parameters: { storeName?: string };
};
type AddToList = {
    actionName: "addToList";
    parameters: { listName: string; productName: string };
};
type BuyAllInList = {
    actionName: "buyAllInList";
    parameters: { listName: string; storeName?: string };
};
type SearchForRecipe = {
    actionName: "searchForRecipe";
    parameters: { keyword: string };
};
type BuyAllInRecipe = {
    actionName: "buyAllInRecipe";
    parameters: { recipeName: string; storeName?: string };
};
type SaveRecipe = {
    actionName: "saveRecipe";
    parameters: { recipeName: string };
};
type SetPreferredStore = {
    actionName: "setPreferredStore";
    parameters: { storeName: string };
};
type FindNearbyStore = {
    actionName: "findNearbyStore";
};
type BuyItAgain = {
    actionName: "buyItAgain";
    parameters: { storeName: string; allItems?: boolean; productName?: string };
};

// Site-specific component definitions (not in common)
const HomeLink: PageComponentDefinition = {
    typeName: "HomeLink",
    schema: `{ linkSelector: string; }`,
};

const ListsNavigationLink: PageComponentDefinition = {
    typeName: "ListsNavigationLink",
    schema: `{ linkSelector: string; }`,
};

const ListInfo: PageComponentDefinition = {
    typeName: "ListInfo",
    schema: `{
    name: string;
    detailsLinkSelector: string;
}`,
};

const ListDetailsInfo: PageComponentDefinition = {
    typeName: "ListDetailsInfo",
    schema: `{
    name: string;
    storeName?: string;
    products?: {
        name: string;
        price: string;
        availability?: string;
        addToCartButtonSelector?: string;
    }[];
}`,
};

const RecipeInfo: PageComponentDefinition = {
    typeName: "RecipeInfo",
    schema: `{
    name: string;
    subtitle: string;
    detailsLinkSelector: string;
}`,
};

const RecipeHeroSection: PageComponentDefinition = {
    typeName: "RecipeHeroSection",
    schema: `{
    recipeName: string;
    summary: string;
    addAllIngredientsSelector: string;
    saveButtonSelector: string;
    ingredients: {
        name: string;
        price: string;
        addToCartButtonSelector?: string;
    }[];
    relatedIngredients: {
        name: string;
        price: string;
        addToCartButtonSelector?: string;
    }[];
}`,
};

const BuyItAgainNavigationLink: PageComponentDefinition = {
    typeName: "BuyItAgainNavigationLink",
    schema: `{ linkSelector: string; }`,
};

const BuyItAgainHeaderSection: PageComponentDefinition = {
    typeName: "BuyItAgainHeaderSection",
    schema: `{
    allItemsSelector: string;
    pastOrdersSelector: string;
    products?: {
        name: string;
        price: string;
        availability?: string;
        addToCartButtonSelector?: string;
    }[];
}`,
};

// Type interfaces for site-specific components
interface HomeLinkType {
    linkSelector: string;
}

interface ListsNavigationLinkType {
    linkSelector: string;
}

interface ListInfoType {
    name: string;
    detailsLinkSelector: string;
}

interface ListDetailsInfoType {
    name: string;
    storeName?: string;
    products?: {
        name: string;
        price: string;
        availability?: string;
        addToCartButtonSelector?: string;
    }[];
}

interface RecipeInfoType {
    name: string;
    subtitle: string;
    detailsLinkSelector: string;
}

interface RecipeHeroSectionType {
    recipeName: string;
    summary: string;
    addAllIngredientsSelector: string;
    saveButtonSelector: string;
    ingredients: {
        name: string;
        price: string;
        addToCartButtonSelector?: string;
    }[];
    relatedIngredients: {
        name: string;
        price: string;
        addToCartButtonSelector?: string;
    }[];
}

interface BuyItAgainNavigationLinkType {
    linkSelector: string;
}

interface BuyItAgainHeaderSectionType {
    allItemsSelector: string;
    pastOrdersSelector: string;
    products?: {
        name: string;
        price: string;
        availability?: string;
        addToCartButtonSelector?: string;
    }[];
}

// Local interface for purchase results
interface PurchaseProductInfo {
    name: string;
    price: string;
    availability?: string;
    addToCartButtonSelector?: string;
}

// Continuation types
type InstacartContinuationStep =
    | "searchForProduct_onResults"
    | "buyAllInList_onHome"
    | "buyAllInList_inStore"
    | "buyAllInList_onListsPage"
    | "buyAllInList_onListDetails"
    | "buyAllInRecipe_onResults"
    | "buyAllInRecipe_onRecipePage"
    | "setPreferredStore_onHome"
    | "buyItAgain_inStore"
    | "buyItAgain_onBuyItAgainPage";

interface InstacartContinuationData {
    keyword?: string;
    storeName?: string;
    listName?: string;
    recipeName?: string;
    allItems?: boolean;
    productName?: string;
    [key: string]: unknown;
}

interface PurchaseResults {
    addedToCart: PurchaseProductInfo[];
    unavailable: PurchaseProductInfo[];
    storeName: string;
    deliveryInformation: string;
}

export class InstacartWebAgent implements WebAgent {
    name = "instacart";
    urlPatterns = INSTACART_URL_PATTERNS;

    private context: WebAgentContext | null = null;
    private registered = false;

    async initialize(context: WebAgentContext): Promise<void> {
        console.log("[InstacartWebAgent] initialize() called");
        this.context = context;
        const url = context.getCurrentUrl();
        console.log(`[InstacartWebAgent] URL: ${url}`);

        const notificationId = `instacart-${Date.now()}`;
        await context.notify(
            "Loading the Instacart agent for grocery shopping...",
            notificationId,
        );

        await this.registerWithTypeAgent();

        await context.notify(
            "Instacart agent ready. Try searching for products, viewing your cart, or buying items from your lists.",
            notificationId,
        );

        console.log("[InstacartWebAgent] Initialization complete");
    }

    private async registerWithTypeAgent(): Promise<void> {
        if (this.registered) {
            console.log(
                "[InstacartWebAgent] Already registered with TypeAgent",
            );
            return;
        }

        if (!window.registerTypeAgent) {
            console.error(
                "[InstacartWebAgent] registerTypeAgent not available",
            );
            return;
        }

        this.registered = true;

        const agent = this.createAppAgent();
        const manifest: AppAgentManifest = {
            emojiChar: "🛒",
            description:
                "Instacart agent for grocery shopping. Can search products, manage shopping lists, find recipes, and add items to cart.",
            schema: {
                description:
                    "Actions for grocery shopping on Instacart including product search, list management, recipes, and cart operations.",
                schemaType: "InstacartActions",
                schemaFile: { content: INSTACART_SCHEMA_TS, format: "ts" },
            },
        };

        try {
            console.log("[InstacartWebAgent] Registering with TypeAgent...");
            await window.registerTypeAgent("instacart", manifest, agent);
            console.log(
                "[InstacartWebAgent] Successfully registered with TypeAgent",
            );
        } catch (error) {
            this.registered = false;
            console.error(
                "[InstacartWebAgent] Failed to register with TypeAgent:",
                error,
            );
        }
    }

    private createAppAgent(): AppAgent {
        const webAgent = this;
        return {
            async executeAction(
                action: TypeAgentAction<InstacartActions>,
            ): Promise<ActionResult | undefined> {
                console.log(
                    `[InstacartWebAgent] executeAction: ${action.actionName}`,
                );
                try {
                    const result = await webAgent.handleAction(action);
                    console.log(
                        "[InstacartWebAgent] executeAction completed successfully",
                    );
                    return {
                        entities: result.entities || [],
                        displayContent: result.message,
                    };
                } catch (error) {
                    console.error(
                        "[InstacartWebAgent] executeAction error:",
                        error,
                    );
                    throw error;
                }
            },
        };
    }

    private async handleAction(
        action: TypeAgentAction<InstacartActions>,
    ): Promise<{ message: string; entities?: any[] }> {
        switch (action.actionName) {
            case "searchForProduct":
                return this.executeSearchForProduct(
                    action.parameters.keyword,
                    action.parameters.storeName,
                );
            case "addToCart":
                return this.executeAddToCart(action.parameters.productName);
            case "removeFromCart":
                return this.executeRemoveFromCart(
                    action.parameters.productName,
                );
            case "getShoppingCart":
                return this.executeGetShoppingCart(action.parameters.storeName);
            case "addToList":
                return this.executeAddToList(
                    action.parameters.listName,
                    action.parameters.productName,
                );
            case "buyAllInList":
                return this.executeBuyAllInList(
                    action.parameters.listName,
                    action.parameters.storeName,
                );
            case "searchForRecipe":
                return this.executeSearchForRecipe(action.parameters.keyword);
            case "buyAllInRecipe":
                return this.executeBuyAllInRecipe(
                    action.parameters.recipeName,
                    action.parameters.storeName,
                );
            case "saveRecipe":
                return this.executeSaveRecipe(action.parameters.recipeName);
            case "setPreferredStore":
                return this.executeSetPreferredStore(
                    action.parameters.storeName,
                );
            case "findNearbyStore":
                return this.executeFindNearbyStore();
            case "buyItAgain":
                return this.executeBuyItAgain(
                    action.parameters.storeName,
                    action.parameters.allItems,
                    action.parameters.productName,
                );
            default:
                return { message: "Unknown action" };
        }
    }

    // Helper methods
    private async storeContinuation(
        step: InstacartContinuationStep,
        data: InstacartContinuationData,
    ): Promise<void> {
        const tabId = await platformAdapter.getTabId();
        if (!tabId) {
            console.warn(
                "[InstacartWebAgent] Could not get tabId for continuation",
            );
            return;
        }
        continuationStorage.set(tabId, {
            type: "instacart",
            step,
            data,
            url: window.location.href,
        });
        console.log(`[InstacartWebAgent] Stored continuation: ${step}`);
    }

    private async searchOnWebsite(
        keywords: string,
        prefix: string = "",
    ): Promise<boolean> {
        if (!this.context) return false;

        console.log(`[InstacartWebAgent] Searching for: ${prefix}${keywords}`);
        const searchInput =
            await extractComponent<SearchInputType>(SearchInput);

        if (!searchInput?.cssSelector) {
            console.error("[InstacartWebAgent] Search input not found");
            return false;
        }

        await this.context.ui.clickOn(searchInput.cssSelector);
        await this.context.ui.enterTextIn(
            searchInput.cssSelector,
            prefix + keywords,
        );
        await this.context.ui.clickOn(searchInput.submitButtonCssSelector);

        return true;
    }

    private async goToHomepage(): Promise<boolean> {
        if (!this.context) return false;

        const homeLink = await extractComponent<HomeLinkType>(HomeLink);
        if (!homeLink?.linkSelector) {
            console.error("[InstacartWebAgent] Home link not found");
            return false;
        }

        await this.context.ui.clickOn(homeLink.linkSelector);
        return true;
    }

    private async addAllProductsToCart(
        products: PurchaseProductInfo[],
        storeName: string,
    ): Promise<PurchaseResults> {
        const results: PurchaseResults = {
            addedToCart: [],
            unavailable: [],
            storeName,
            deliveryInformation: "",
        };

        for (const product of products) {
            if (product.availability === "Out of stock") {
                results.unavailable.push(product);
            } else if (product.addToCartButtonSelector) {
                try {
                    await this.context!.ui.clickOn(
                        product.addToCartButtonSelector,
                    );
                    await new Promise((r) => setTimeout(r, 150));
                    results.addedToCart.push(product);
                } catch (e) {
                    results.unavailable.push(product);
                }
            } else {
                results.unavailable.push(product);
            }
        }

        return results;
    }

    // ===== Simple Actions =====

    private async executeSearchForProduct(
        keyword: string,
        storeName?: string,
    ): Promise<{ message: string; entities?: any[] }> {
        if (!this.context) throw new Error("Context not available");

        const searched = await this.searchOnWebsite(keyword);
        if (!searched) {
            return { message: "Could not find search input on this page" };
        }

        await this.storeContinuation("searchForProduct_onResults", {
            keyword,
            storeName,
        });

        return {
            message: `Searching for "${keyword}"... Results will appear shortly.`,
        };
    }

    private async executeAddToCart(
        productName: string,
    ): Promise<{ message: string; entities?: any[] }> {
        if (!this.context) throw new Error("Context not available");

        const product = await extractComponent<ProductTileType>(
            ProductTile,
            productName,
        );

        if (!product?.addToCartButtonSelector) {
            return { message: `Could not find "${productName}" on this page` };
        }

        if (product.availability === "Out of stock") {
            return { message: `"${product.name}" is out of stock` };
        }

        await this.context.ui.clickOn(product.addToCartButtonSelector);

        return {
            message: `Added "${product.name}" (${product.price}) to cart`,
            entities: [
                {
                    name: product.name,
                    type: ["product"],
                    metadata: { price: product.price, brand: product.brand },
                },
            ],
        };
    }

    private async executeRemoveFromCart(
        productName: string,
    ): Promise<{ message: string }> {
        // This would require navigating to cart and finding remove button
        return {
            message: `Remove from cart not yet implemented for "${productName}"`,
        };
    }

    private async executeGetShoppingCart(
        storeName?: string,
    ): Promise<{ message: string; entities?: any[] }> {
        if (!this.context) throw new Error("Context not available");

        const cartButton =
            await extractComponent<ShoppingCartButtonType>(ShoppingCartButton);

        if (cartButton?.detailsLinkSelector) {
            await this.context.ui.clickOn(cartButton.detailsLinkSelector);
            await new Promise((r) => setTimeout(r, 500));
        }

        const cartDetails =
            await extractComponent<ShoppingCartDetailsType>(
                ShoppingCartDetails,
            );

        if (!cartDetails) {
            return { message: "Could not retrieve cart details", entities: [] };
        }

        const entities: any[] = [];
        if (cartDetails.productsInCart) {
            for (const p of cartDetails.productsInCart) {
                entities.push({
                    name: p.name,
                    type: ["product"],
                    metadata: { price: p.price },
                });
            }
        }

        const count = cartDetails.productsInCart?.length ?? 0;
        return {
            message: `Cart has ${count} item(s) from ${cartDetails.storeName}. Total: ${cartDetails.totalAmount}`,
            entities,
        };
    }

    private async executeAddToList(
        listName: string,
        productName: string,
    ): Promise<{ message: string }> {
        // This is a multi-step action: search product → click add to list → select list
        return {
            message: `Add to list not yet fully implemented for "${productName}" to "${listName}"`,
        };
    }

    private async executeBuyAllInList(
        listName: string,
        storeName?: string,
    ): Promise<{ message: string; entities?: any[] }> {
        if (!this.context) throw new Error("Context not available");

        // Step 1: Go to homepage first
        const wentHome = await this.goToHomepage();
        if (!wentHome) {
            return { message: "Could not navigate to homepage" };
        }

        await this.storeContinuation("buyAllInList_onHome", {
            listName,
            storeName,
        });

        return {
            message: `Going to homepage to start buying from "${listName}"...`,
        };
    }

    private async executeSearchForRecipe(
        keyword: string,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        // Go to homepage first for recipe search
        await this.goToHomepage();
        await new Promise((r) => setTimeout(r, 500));

        const searched = await this.searchOnWebsite(keyword, "recipes: ");
        if (!searched) {
            return { message: "Could not find search input" };
        }

        await this.storeContinuation("buyAllInRecipe_onResults", {
            recipeName: keyword,
        });

        return { message: `Searching for recipe "${keyword}"...` };
    }

    private async executeBuyAllInRecipe(
        recipeName: string,
        storeName?: string,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        // Go to homepage first
        await this.goToHomepage();
        await new Promise((r) => setTimeout(r, 500));

        const searched = await this.searchOnWebsite(recipeName, "recipes: ");
        if (!searched) {
            return { message: "Could not find search input" };
        }

        await this.storeContinuation("buyAllInRecipe_onResults", {
            recipeName,
            storeName,
        });

        return { message: `Searching for recipe "${recipeName}"...` };
    }

    private async executeSaveRecipe(
        recipeName: string,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        const recipe =
            await extractComponent<RecipeHeroSectionType>(RecipeHeroSection);

        if (!recipe?.saveButtonSelector) {
            return { message: `Could not find recipe "${recipeName}" to save` };
        }

        await this.context.ui.clickOn(recipe.saveButtonSelector);

        return { message: `Saved recipe "${recipe.recipeName}"` };
    }

    private async executeSetPreferredStore(
        storeName: string,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        // Go to homepage to select store
        await this.goToHomepage();

        await this.storeContinuation("setPreferredStore_onHome", { storeName });

        return { message: `Going to homepage to select "${storeName}"...` };
    }

    private async executeFindNearbyStore(): Promise<{
        message: string;
        entities?: any[];
    }> {
        if (!this.context) throw new Error("Context not available");

        const storesList =
            await extractComponent<NearbyStoresListType>(NearbyStoresList);

        if (!storesList?.stores || storesList.stores.length === 0) {
            return { message: "No nearby stores found on this page" };
        }

        const entities = storesList.stores.map((s) => ({
            name: s.name,
            type: ["store"],
            metadata: { subtitle: s.subtitle },
        }));

        const storeNames = storesList.stores.map((s) => s.name).join(", ");

        return {
            message: `Found ${storesList.stores.length} nearby stores: ${storeNames}`,
            entities,
        };
    }

    private async executeBuyItAgain(
        storeName: string,
        allItems?: boolean,
        productName?: string,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        // Need to navigate: home → store → buy it again
        await this.goToHomepage();

        await this.storeContinuation("buyItAgain_inStore", {
            storeName,
            allItems,
            productName,
        });

        return {
            message: `Going to "${storeName}" to access Buy It Again...`,
        };
    }

    // ===== Continuation Handler =====

    async handleContinuation(
        continuation: ContinuationState,
        context: WebAgentContext,
    ): Promise<void> {
        this.context = context;
        const step = continuation.step as InstacartContinuationStep;
        const data = continuation.data as InstacartContinuationData;

        console.log(`[InstacartWebAgent] Handling continuation: ${step}`);

        try {
            let result: { message: string; entities?: any[] };

            switch (step) {
                case "searchForProduct_onResults":
                    result =
                        await this.continueSearchForProduct_showResults(data);
                    break;
                case "buyAllInList_onHome":
                    result = await this.continueBuyAllInList_selectStore(data);
                    break;
                case "buyAllInList_inStore":
                    result = await this.continueBuyAllInList_goToLists(data);
                    break;
                case "buyAllInList_onListsPage":
                    result = await this.continueBuyAllInList_selectList(data);
                    break;
                case "buyAllInList_onListDetails":
                    result = await this.continueBuyAllInList_addAll(data);
                    break;
                case "buyAllInRecipe_onResults":
                    result =
                        await this.continueBuyAllInRecipe_selectRecipe(data);
                    break;
                case "buyAllInRecipe_onRecipePage":
                    result =
                        await this.continueBuyAllInRecipe_addIngredients(data);
                    break;
                case "setPreferredStore_onHome":
                    result = await this.continueSetPreferredStore_select(data);
                    break;
                case "buyItAgain_inStore":
                    result = await this.continueBuyItAgain_goToPage(data);
                    break;
                case "buyItAgain_onBuyItAgainPage":
                    result = await this.continueBuyItAgain_addItems(data);
                    break;
                default:
                    console.warn(
                        `[InstacartWebAgent] Unknown continuation step: ${step}`,
                    );
                    return;
            }

            await context.notify(result.message);
            console.log(
                `[InstacartWebAgent] Continuation ${step} completed: ${result.message}`,
            );
        } catch (error) {
            console.error(
                `[InstacartWebAgent] Error in continuation ${step}:`,
                error,
            );
            await context.notify(`Error: ${(error as Error).message}`);
        }
    }

    // Continuation step implementations

    private async continueSearchForProduct_showResults(
        data: InstacartContinuationData,
    ): Promise<{ message: string; entities?: any[] }> {
        const products = await extractComponent<ProductTileType[]>(
            ProductTile,
            data.keyword,
        );

        if (!products || (Array.isArray(products) && products.length === 0)) {
            return { message: `No results found for "${data.keyword}"` };
        }

        // If it's a single product tile
        const product = Array.isArray(products) ? products[0] : products;
        return {
            message: `Found "${product.name}" - ${product.price}. Say "add to cart" to add it.`,
            entities: [
                {
                    name: product.name,
                    type: ["product"],
                    metadata: { price: product.price },
                },
            ],
        };
    }

    private async continueBuyAllInList_selectStore(
        data: InstacartContinuationData,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        if (data.storeName) {
            const store = await extractComponent<StoreInfoType>(
                StoreInfo,
                data.storeName,
            );
            if (store?.linkSelector) {
                await this.context.ui.clickOn(store.linkSelector);
                await this.storeContinuation("buyAllInList_inStore", data);
                return { message: `Selecting store "${data.storeName}"...` };
            }
        }

        // No store specified or not found, proceed to lists
        await this.storeContinuation("buyAllInList_inStore", data);
        return { message: "Proceeding to lists..." };
    }

    private async continueBuyAllInList_goToLists(
        data: InstacartContinuationData,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        const listsNav =
            await extractComponent<ListsNavigationLinkType>(
                ListsNavigationLink,
            );
        if (!listsNav?.linkSelector) {
            return { message: "Could not find Lists navigation link" };
        }

        await this.context.ui.clickOn(listsNav.linkSelector);
        await this.storeContinuation("buyAllInList_onListsPage", data);

        return { message: "Navigating to Lists page..." };
    }

    private async continueBuyAllInList_selectList(
        data: InstacartContinuationData,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        const list = await extractComponent<ListInfoType>(
            ListInfo,
            data.listName,
        );
        if (!list?.detailsLinkSelector) {
            return { message: `Could not find list "${data.listName}"` };
        }

        await this.context.ui.clickOn(list.detailsLinkSelector);
        await this.storeContinuation("buyAllInList_onListDetails", data);

        return { message: `Opening list "${list.name}"...` };
    }

    private async continueBuyAllInList_addAll(
        data: InstacartContinuationData,
    ): Promise<{ message: string; entities?: any[] }> {
        if (!this.context) throw new Error("Context not available");

        const listDetails =
            await extractComponent<ListDetailsInfoType>(ListDetailsInfo);

        if (!listDetails?.products || listDetails.products.length === 0) {
            return { message: "No products found in this list" };
        }

        const results = await this.addAllProductsToCart(
            listDetails.products,
            listDetails.storeName || "store",
        );

        const entities = results.addedToCart.map((p) => ({
            name: p.name,
            type: ["product"],
            metadata: { price: p.price, status: "added" },
        }));

        const unavailableNames = results.unavailable.map((p) => p.name);
        let message = `Added ${results.addedToCart.length} items to cart.`;
        if (results.unavailable.length > 0) {
            message += ` ${results.unavailable.length} unavailable: ${unavailableNames.join(", ")}`;
        }

        return { message, entities };
    }

    private async continueBuyAllInRecipe_selectRecipe(
        data: InstacartContinuationData,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        const recipe = await extractComponent<RecipeInfoType>(
            RecipeInfo,
            data.recipeName,
        );
        if (!recipe?.detailsLinkSelector) {
            return { message: `Could not find recipe "${data.recipeName}"` };
        }

        await this.context.ui.clickOn(recipe.detailsLinkSelector);
        await this.storeContinuation("buyAllInRecipe_onRecipePage", data);

        return { message: `Opening recipe "${recipe.name}"...` };
    }

    private async continueBuyAllInRecipe_addIngredients(
        data: InstacartContinuationData,
    ): Promise<{ message: string; entities?: any[] }> {
        if (!this.context) throw new Error("Context not available");

        const recipe =
            await extractComponent<RecipeHeroSectionType>(RecipeHeroSection);

        if (!recipe) {
            return { message: "Could not find recipe details" };
        }

        // Click add all ingredients button
        if (recipe.addAllIngredientsSelector) {
            await this.context.ui.clickOn(recipe.addAllIngredientsSelector);

            const entities = recipe.ingredients.map((p) => ({
                name: p.name,
                type: ["ingredient"],
                metadata: { price: p.price },
            }));

            return {
                message: `Added ${recipe.ingredients.length} ingredients from "${recipe.recipeName}" to cart.`,
                entities,
            };
        }

        return { message: "Could not find add ingredients button" };
    }

    private async continueSetPreferredStore_select(
        data: InstacartContinuationData,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        const store = await extractComponent<StoreInfoType>(
            StoreInfo,
            data.storeName,
        );

        if (!store?.linkSelector) {
            return { message: `Could not find store "${data.storeName}"` };
        }

        await this.context.ui.clickOn(store.linkSelector);

        return { message: `Selected "${store.name}" as your store.` };
    }

    private async continueBuyItAgain_goToPage(
        data: InstacartContinuationData,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        // First select store if needed
        if (data.storeName) {
            const store = await extractComponent<StoreInfoType>(
                StoreInfo,
                data.storeName,
            );
            if (store?.linkSelector) {
                await this.context.ui.clickOn(store.linkSelector);
                await new Promise((r) => setTimeout(r, 500));
            }
        }

        const buyItAgainNav =
            await extractComponent<BuyItAgainNavigationLinkType>(
                BuyItAgainNavigationLink,
            );

        if (!buyItAgainNav?.linkSelector) {
            return { message: "Could not find Buy It Again navigation" };
        }

        await this.context.ui.clickOn(buyItAgainNav.linkSelector);
        await this.storeContinuation("buyItAgain_onBuyItAgainPage", data);

        return { message: "Navigating to Buy It Again..." };
    }

    private async continueBuyItAgain_addItems(
        data: InstacartContinuationData,
    ): Promise<{ message: string; entities?: any[] }> {
        if (!this.context) throw new Error("Context not available");

        const buyItAgain = await extractComponent<BuyItAgainHeaderSectionType>(
            BuyItAgainHeaderSection,
        );

        if (!buyItAgain?.products || buyItAgain.products.length === 0) {
            return { message: "No Buy It Again items found" };
        }

        if (data.allItems) {
            // Add all items
            const results = await this.addAllProductsToCart(
                buyItAgain.products,
                data.storeName || "store",
            );

            return {
                message: `Added ${results.addedToCart.length} items from Buy It Again.`,
                entities: results.addedToCart.map((p) => ({
                    name: p.name,
                    type: ["product"],
                })),
            };
        } else if (data.productName) {
            // Add specific product
            const product = buyItAgain.products.find((p) =>
                p.name.toLowerCase().includes(data.productName!.toLowerCase()),
            );

            if (!product?.addToCartButtonSelector) {
                return {
                    message: `Could not find "${data.productName}" in Buy It Again`,
                };
            }

            await this.context.ui.clickOn(product.addToCartButtonSelector);

            return {
                message: `Added "${product.name}" from Buy It Again.`,
                entities: [{ name: product.name, type: ["product"] }],
            };
        }

        return { message: "Specify allItems or productName for Buy It Again" };
    }
}
