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
    ProductDetailsHero,
    ShoppingCartButton,
    ShoppingCartDetails,
    StoreInfo,
    SearchInputType,
    ProductTileType,
    ProductDetailsHeroType,
    ShoppingCartButtonType,
    ShoppingCartDetailsType,
    StoreInfoType,
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

const COMMERCE_URL_PATTERNS = [
    /amazon\.(com|co\.uk|de|fr|es|it|nl|in|ca|com\.mx|com\.br|com\.au)/,
    /target\.com/,
    /walmart\.com/,
    /bestbuy\.com/,
    /homedepot\.com/,
    /lowes\.com/,
    /costco\.com/,
    /ebay\.com/,
    /opentable\.com/,
    /resy\.com/,
];

const COMMERCE_SCHEMA_TS = `
export type CommerceActions =
    | FindNearbyStore
    | ViewShoppingCart
    | SelectReservation
    | BuyProduct
    | GetLocationInStore
    | SearchForReservation;

export type FindNearbyStore = {
    actionName: "findNearbyStore";
};

export type ViewShoppingCart = {
    actionName: "viewShoppingCart";
};

export type SelectReservation = {
    actionName: "selectReservation";
    parameters: {
        time: string;
    };
};

export type BuyProduct = {
    actionName: "buyProduct";
    parameters: {
        productName: string;
    };
};

export type GetLocationInStore = {
    actionName: "getLocationInStore";
    parameters: {
        productName: string;
    };
};

export type SearchForReservation = {
    actionName: "searchForReservation";
    parameters: {
        restaurantName: string;
        time: string;
        numberOfPeople: number;
    };
};
`;

type CommerceActions =
    | FindNearbyStore
    | ViewShoppingCart
    | SelectReservation
    | BuyProduct
    | GetLocationInStore
    | SearchForReservation;

type FindNearbyStore = {
    actionName: "findNearbyStore";
};

type ViewShoppingCart = {
    actionName: "viewShoppingCart";
};

type SelectReservation = {
    actionName: "selectReservation";
    parameters: {
        time: string;
    };
};

type BuyProduct = {
    actionName: "buyProduct";
    parameters: {
        productName: string;
    };
};

type GetLocationInStore = {
    actionName: "getLocationInStore";
    parameters: {
        productName: string;
    };
};

type SearchForReservation = {
    actionName: "searchForReservation";
    parameters: {
        restaurantName: string;
        time: string;
        numberOfPeople: number;
    };
};

// Site-specific component definitions (not in common)
const RestaurantResult: PageComponentDefinition = {
    typeName: "RestaurantResult",
    schema: `{
    restaurantName: string;
    rating: string;
    detailsLinkSelector: string;
}`,
};

const BookReservationsModule: PageComponentDefinition = {
    typeName: "BookReservationsModule",
    schema: `{
    date: string;
    targetTime: string;
    availableTimeSlots?: { time?: string; cssSelector: string; }[];
    numberOfPeople?: number;
}`,
};

const StoreLocation: PageComponentDefinition = {
    typeName: "StoreLocation",
    schema: `{
    locationName: string;
    zipCode: string;
}`,
};

// Type interfaces for site-specific components
interface RestaurantResultType {
    restaurantName: string;
    rating: string;
    detailsLinkSelector: string;
}

interface BookReservationsModuleType {
    date: string;
    targetTime: string;
    availableTimeSlots?: { time?: string; cssSelector: string }[];
    numberOfPeople?: number;
}

interface StoreLocationType {
    locationName: string;
    zipCode: string;
}

// Continuation step types for multi-step workflows
type CommerceContinuationStep =
    | "buyProduct_onResults"
    | "buyProduct_onDetails"
    | "getLocationInStore_onResults"
    | "getLocationInStore_onDetails"
    | "searchForReservation_onResults"
    | "searchForReservation_onRestaurant";

interface CommerceContinuationData {
    productName?: string;
    restaurantName?: string;
    time?: string;
    numberOfPeople?: number;
    [key: string]: unknown;
}

export class CommerceWebAgent implements WebAgent {
    name = "commerce";
    urlPatterns = COMMERCE_URL_PATTERNS;

    private context: WebAgentContext | null = null;
    private registered = false;

    async initialize(context: WebAgentContext): Promise<void> {
        console.log("[CommerceWebAgent] initialize() called");
        this.context = context;
        const url = context.getCurrentUrl();
        console.log(`[CommerceWebAgent] URL: ${url}`);

        const notificationId = `commerce-${Date.now()}`;
        await context.notify(
            "Loading the commerce agent for shopping assistance...",
            notificationId,
        );

        // wait for page to settle
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await this.registerWithTypeAgent();

        await context.notify(
            "Commerce agent ready. Try asking to buy a product, view your cart, or find nearby stores.",
            notificationId,
        );

        console.log("[CommerceWebAgent] Initialization complete");
    }

    private async registerWithTypeAgent(): Promise<void> {
        if (this.registered) {
            console.log("[CommerceWebAgent] Already registered with TypeAgent");
            return;
        }

        if (!window.registerTypeAgent) {
            console.error("[CommerceWebAgent] registerTypeAgent not available");
            return;
        }

        this.registered = true;

        const agent = this.createAppAgent();
        const manifest: AppAgentManifest = {
            emojiChar: "🛒",
            description:
                "Commerce agent for shopping on e-commerce websites. Can buy products, view shopping cart, find nearby stores, find product locations, and make restaurant reservations.",
            schema: {
                description:
                    "Actions for shopping on e-commerce websites including buying products, viewing cart, finding stores, and making reservations.",
                schemaType: "CommerceActions",
                schemaFile: { content: COMMERCE_SCHEMA_TS, format: "ts" },
            },
        };

        try {
            console.log("[CommerceWebAgent] Registering with TypeAgent...");
            await window.registerTypeAgent("commerce", manifest, agent);
            console.log(
                "[CommerceWebAgent] Successfully registered with TypeAgent",
            );
        } catch (error) {
            this.registered = false;
            console.error(
                "[CommerceWebAgent] Failed to register with TypeAgent:",
                error,
            );
        }
    }

    private createAppAgent(): AppAgent {
        const webAgent = this;
        return {
            async executeAction(
                action: TypeAgentAction<CommerceActions>,
            ): Promise<ActionResult | undefined> {
                console.log(
                    `[CommerceWebAgent] executeAction: ${action.actionName}`,
                );
                try {
                    let message = "OK";
                    const entities: any[] = [];

                    switch (action.actionName) {
                        case "findNearbyStore": {
                            const result =
                                await webAgent.executeFindNearbyStore();
                            message = result.message;
                            if (result.entity) {
                                entities.push(result.entity);
                            }
                            break;
                        }
                        case "viewShoppingCart": {
                            const result =
                                await webAgent.executeViewShoppingCart();
                            message = result.message;
                            entities.push(...result.entities);
                            break;
                        }
                        case "selectReservation": {
                            const params = action.parameters;
                            const result =
                                await webAgent.executeSelectReservation(
                                    params.time,
                                );
                            message = result.message;
                            break;
                        }
                        case "buyProduct": {
                            const params = action.parameters;
                            const result = await webAgent.executeBuyProduct(
                                params.productName,
                            );
                            message = result.message;
                            entities.push(...(result.entities || []));
                            break;
                        }
                        case "getLocationInStore": {
                            const params = action.parameters;
                            const result =
                                await webAgent.executeGetLocationInStore(
                                    params.productName,
                                );
                            message = result.message;
                            if (result.entity) {
                                entities.push(result.entity);
                            }
                            break;
                        }
                        case "searchForReservation": {
                            const params = action.parameters;
                            const result =
                                await webAgent.executeSearchForReservation(
                                    params.restaurantName,
                                    params.time,
                                    params.numberOfPeople,
                                );
                            message = result.message;
                            entities.push(...(result.entities || []));
                            break;
                        }
                    }

                    console.log(
                        "[CommerceWebAgent] executeAction completed successfully",
                    );
                    return {
                        entities,
                        displayContent: message,
                    };
                } catch (error) {
                    console.error(
                        "[CommerceWebAgent] executeAction error:",
                        error,
                    );
                    throw error;
                }
            },
        };
    }

    // Helper to store continuation before navigation
    private async storeContinuation(
        step: CommerceContinuationStep,
        data: CommerceContinuationData,
    ): Promise<void> {
        console.log("[CommerceWebAgent] Getting tabId for continuation...");
        const tabId = await platformAdapter.getTabId();
        console.log("[CommerceWebAgent] Got tabId:", tabId);
        if (!tabId) {
            console.warn(
                "[CommerceWebAgent] Could not get tabId for continuation",
            );
            return;
        }

        const continuationData = {
            type: "commerce",
            step,
            data,
            url: window.location.href,
        };
        console.log(
            "[CommerceWebAgent] Storing continuation:",
            tabId,
            continuationData,
        );
        continuationStorage.set(tabId, continuationData);
        console.log(
            `[CommerceWebAgent] Stored continuation: ${step} for tabId: ${tabId}`,
        );
    }

    // Helper to search on website
    private async searchOnWebsite(searchTerm: string): Promise<boolean> {
        if (!this.context) return false;

        console.log(`[CommerceWebAgent] Searching for: ${searchTerm}`);
        const searchInput =
            await extractComponent<SearchInputType>(SearchInput);

        console.log("[CommerceWebAgent] Extracted search input:", searchInput);

        if (!searchInput?.cssSelector) {
            console.error("[CommerceWebAgent] Search input not found");
            return false;
        }

        await this.context.ui.clickOn(searchInput.cssSelector);
        await this.context.ui.enterTextIn(searchInput.cssSelector, searchTerm);
        await this.context.ui.clickOn(searchInput.submitButtonCssSelector);

        return true;
    }

    // ===== Simple Actions (no continuation) =====

    private async executeFindNearbyStore(): Promise<{
        message: string;
        entity?: any;
    }> {
        if (!this.context) {
            throw new Error("Commerce context not available");
        }

        console.log("[CommerceWebAgent] Extracting StoreLocation...");
        const storeInfo =
            await extractComponent<StoreLocationType>(StoreLocation);

        if (storeInfo?.locationName) {
            const entity = {
                name: storeInfo.locationName,
                type: ["store"],
                metadata: {
                    source: "location_lookup",
                    zipCode: storeInfo.zipCode,
                },
            };
            return {
                message: `Nearest store is ${storeInfo.locationName} (${storeInfo.zipCode})`,
                entity,
            };
        }

        return {
            message: "Could not find nearby store information on this page",
        };
    }

    private async executeViewShoppingCart(): Promise<{
        message: string;
        entities: any[];
    }> {
        if (!this.context) {
            throw new Error("Commerce context not available");
        }

        const entities: any[] = [];

        console.log("[CommerceWebAgent] Extracting ShoppingCartButton...");
        const cartButton =
            await extractComponent<ShoppingCartButtonType>(ShoppingCartButton);

        if (cartButton?.detailsLinkSelector) {
            console.log("[CommerceWebAgent] Clicking cart button...");
            await this.context.ui.clickOn(cartButton.detailsLinkSelector);
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        console.log("[CommerceWebAgent] Extracting ShoppingCartDetails...");
        const cartDetails =
            await extractComponent<ShoppingCartDetailsType>(
                ShoppingCartDetails,
            );

        if (cartDetails) {
            if (cartDetails.storeName) {
                entities.push({
                    name: cartDetails.storeName,
                    type: ["store", "shoppingCart"],
                    metadata: {
                        source: "cart_view",
                        totalAmount: cartDetails.totalAmount,
                        deliveryInfo: cartDetails.deliveryInformation,
                    },
                });
            }

            if (cartDetails.productsInCart) {
                for (const product of cartDetails.productsInCart) {
                    entities.push({
                        name: product.name,
                        type: ["product"],
                        metadata: {
                            source: "cart",
                            price: product.price,
                            store: cartDetails.storeName,
                        },
                    });
                }
            }

            const itemCount = cartDetails.productsInCart?.length ?? 0;
            return {
                message: `Shopping cart has ${itemCount} item(s). Total: ${cartDetails.totalAmount}`,
                entities,
            };
        }

        return {
            message: "Could not retrieve shopping cart details",
            entities: [],
        };
    }

    private async executeSelectReservation(time: string): Promise<{
        message: string;
    }> {
        if (!this.context) {
            throw new Error("Commerce context not available");
        }

        console.log("[CommerceWebAgent] Extracting BookReservationsModule...");
        const reservationInfo =
            await extractComponent<BookReservationsModuleType>(
                BookReservationsModule,
            );

        if (
            reservationInfo?.availableTimeSlots &&
            reservationInfo.availableTimeSlots.length > 0
        ) {
            const targetSlot = reservationInfo.availableTimeSlots.find(
                (slot) => slot.time === time,
            );

            if (targetSlot?.cssSelector) {
                console.log(`[CommerceWebAgent] Clicking time slot: ${time}`);
                await this.context.ui.clickOn(targetSlot.cssSelector);
                await new Promise((resolve) => setTimeout(resolve, 200));
                return { message: `Selected reservation time: ${time}` };
            }

            const available = reservationInfo.availableTimeSlots
                .map((s) => s.time)
                .filter(Boolean)
                .join(", ");
            return {
                message: `Time ${time} not available. Available times: ${available}`,
            };
        }

        return { message: "No available time slots found on this page" };
    }

    // ===== Multi-Step Actions (with continuation) =====

    private async executeBuyProduct(productName: string): Promise<{
        message: string;
        entities?: any[];
    }> {
        if (!this.context) {
            throw new Error("Commerce context not available");
        }

        // Step 1: Search for product
        const searched = await this.searchOnWebsite(productName);
        if (!searched) {
            return { message: "Could not find search input on this page" };
        }

        // Store continuation and wait for navigation
        await this.storeContinuation("buyProduct_onResults", { productName });

        return {
            message: `Searching for "${productName}"... Please wait for the results page to load.`,
        };
    }

    private async executeGetLocationInStore(productName: string): Promise<{
        message: string;
        entity?: any;
    }> {
        if (!this.context) {
            throw new Error("Commerce context not available");
        }

        // Step 1: Search for product
        const searched = await this.searchOnWebsite(productName);
        if (!searched) {
            return { message: "Could not find search input on this page" };
        }

        // Store continuation and wait for navigation
        await this.storeContinuation("getLocationInStore_onResults", {
            productName,
        });

        return {
            message: `Searching for "${productName}" to find store location... Please wait.`,
        };
    }

    private async executeSearchForReservation(
        restaurantName: string,
        time: string,
        numberOfPeople: number,
    ): Promise<{
        message: string;
        entities?: any[];
    }> {
        if (!this.context) {
            throw new Error("Commerce context not available");
        }

        // Step 1: Search for restaurant
        const searched = await this.searchOnWebsite(restaurantName);
        if (!searched) {
            return { message: "Could not find search input on this page" };
        }

        // Store continuation and wait for navigation
        await this.storeContinuation("searchForReservation_onResults", {
            restaurantName,
            time,
            numberOfPeople,
        });

        return {
            message: `Searching for "${restaurantName}"... Please wait for the results.`,
        };
    }

    // ===== Continuation Handler =====

    async handleContinuation(
        continuation: ContinuationState,
        context: WebAgentContext,
    ): Promise<void> {
        this.context = context;
        const step = continuation.step as CommerceContinuationStep;
        const data = continuation.data as CommerceContinuationData;

        console.log(`[CommerceWebAgent] Handling continuation: ${step}`);

        try {
            let result: { message: string; entities?: any[]; entity?: any };

            switch (step) {
                case "buyProduct_onResults":
                    result = await this.continueBuyProduct_selectResult(data);
                    break;
                case "buyProduct_onDetails":
                    result = await this.continueBuyProduct_addToCart(data);
                    break;
                case "getLocationInStore_onResults":
                    result =
                        await this.continueGetLocationInStore_selectResult(
                            data,
                        );
                    break;
                case "getLocationInStore_onDetails":
                    result =
                        await this.continueGetLocationInStore_extractLocation(
                            data,
                        );
                    break;
                case "searchForReservation_onResults":
                    result =
                        await this.continueSearchForReservation_selectRestaurant(
                            data,
                        );
                    break;
                case "searchForReservation_onRestaurant":
                    result =
                        await this.continueSearchForReservation_showSlots(data);
                    break;
                default:
                    console.warn(
                        `[CommerceWebAgent] Unknown continuation step: ${step}`,
                    );
                    return;
            }

            // Notify user of result
            await context.notify(result.message);
            console.log(
                `[CommerceWebAgent] Continuation ${step} completed: ${result.message}`,
            );
        } catch (error) {
            console.error(
                `[CommerceWebAgent] Error handling continuation ${step}:`,
                error,
            );
            await context.notify(
                `Error during ${step}: ${(error as Error).message}`,
            );
        }
    }

    // Continuation step handlers for buyProduct
    private async continueBuyProduct_selectResult(
        data: CommerceContinuationData,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        const productName = data.productName || "";
        console.log(
            `[CommerceWebAgent] On results page, selecting: ${productName}`,
        );

        const product = await extractComponent<ProductTileType>(
            ProductTile,
            productName,
        );

        if (!product?.detailsLinkSelector) {
            return { message: `Could not find "${productName}" in results` };
        }

        await this.context.ui.clickOn(product.detailsLinkSelector);
        await this.storeContinuation("buyProduct_onDetails", { productName });

        return { message: `Clicking on "${product.name}"...` };
    }

    private async continueBuyProduct_addToCart(
        data: CommerceContinuationData,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        console.log("[CommerceWebAgent] On details page, adding to cart");

        const details =
            await extractComponent<ProductDetailsHeroType>(ProductDetailsHero);

        if (!details?.addToCartButtonSelector) {
            return {
                message: "Could not find add-to-cart button on this page",
            };
        }

        await this.context.ui.clickOn(details.addToCartButtonSelector);

        return {
            message: `Added "${details.name}" (${details.price}) to cart`,
        };
    }

    // Continuation step handlers for getLocationInStore
    private async continueGetLocationInStore_selectResult(
        data: CommerceContinuationData,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        const productName = data.productName || "";
        console.log(
            `[CommerceWebAgent] On results page, selecting: ${productName}`,
        );

        const product = await extractComponent<ProductTileType>(
            ProductTile,
            productName,
        );

        if (!product?.detailsLinkSelector) {
            return { message: `Could not find "${productName}" in results` };
        }

        await this.context.ui.clickOn(product.detailsLinkSelector);
        await this.storeContinuation("getLocationInStore_onDetails", {
            productName,
        });

        return { message: `Clicking on "${product.name}"...` };
    }

    private async continueGetLocationInStore_extractLocation(
        data: CommerceContinuationData,
    ): Promise<{ message: string; entity?: any }> {
        if (!this.context) throw new Error("Context not available");

        console.log("[CommerceWebAgent] On details page, extracting location");

        // Wait for page to settle
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const details =
            await extractComponent<ProductDetailsHeroType>(ProductDetailsHero);

        if (details?.physicalLocationInStore) {
            const entity = {
                name: details.name,
                type: ["product"],
                metadata: {
                    source: "store_lookup",
                    stockQuantity: details.numberInStock,
                    physicalLocation: details.physicalLocationInStore,
                    storeName: details.storeName,
                },
            };

            return {
                message: `Found ${details.numberInStock || "some"} at ${details.physicalLocationInStore} in ${details.storeName || "store"}`,
                entity,
            };
        }

        return { message: "Could not find store location information" };
    }

    // Continuation step handlers for searchForReservation
    private async continueSearchForReservation_selectRestaurant(
        data: CommerceContinuationData,
    ): Promise<{ message: string }> {
        if (!this.context) throw new Error("Context not available");

        const restaurantName = data.restaurantName || "";
        console.log(
            `[CommerceWebAgent] On results page, selecting: ${restaurantName}`,
        );

        const restaurant = await extractComponent<RestaurantResultType>(
            RestaurantResult,
            restaurantName,
        );

        if (!restaurant?.detailsLinkSelector) {
            return {
                message: `Could not find "${restaurantName}" in results`,
            };
        }

        await this.context.ui.clickOn(restaurant.detailsLinkSelector);
        await this.storeContinuation("searchForReservation_onRestaurant", data);

        return { message: `Opening "${restaurant.restaurantName}"...` };
    }

    private async continueSearchForReservation_showSlots(
        data: CommerceContinuationData,
    ): Promise<{ message: string; entities?: any[] }> {
        if (!this.context) throw new Error("Context not available");

        console.log("[CommerceWebAgent] On restaurant page, showing slots");

        const reservationInfo =
            await extractComponent<BookReservationsModuleType>(
                BookReservationsModule,
            );

        const entities: any[] = [];

        if (data.restaurantName) {
            entities.push({
                name: data.restaurantName,
                type: ["restaurant"],
                metadata: {
                    source: "reservation_search",
                    requestedTime: data.time,
                    partySize: data.numberOfPeople,
                },
            });
        }

        if (
            reservationInfo?.availableTimeSlots &&
            reservationInfo.availableTimeSlots.length > 0
        ) {
            const times = reservationInfo.availableTimeSlots
                .map((s) => s.time)
                .filter(Boolean);

            reservationInfo.availableTimeSlots.forEach((slot, i) => {
                if (slot.time) {
                    entities.push({
                        name: `${data.restaurantName}_slot_${i}`,
                        type: ["timeSlot"],
                        metadata: {
                            restaurant: data.restaurantName,
                            time: slot.time,
                        },
                    });
                }
            });

            const timeList =
                times.length === 1
                    ? times[0]
                    : times.length === 2
                      ? `${times[0]} or ${times[1]}`
                      : `${times.slice(0, -1).join(", ")}, or ${times[times.length - 1]}`;

            return {
                message: `Found ${times.length} table(s) available at ${timeList}. Which time should I reserve?`,
                entities,
            };
        }

        return {
            message:
                "No available tables found at the selected time. Try a different day or time.",
            entities,
        };
    }
}
