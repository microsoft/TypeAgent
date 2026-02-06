// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../browserActions.mjs";
import { BrowserConnector } from "../browserConnector.mjs";
import { createCommercePageTranslator } from "./translator.mjs";
import {
    BookReservationsModule,
    BookSelectorButton,
    ProductDetailsHeroTile,
    ProductTile,
    RestaurantResult,
    SearchInput,
    ShoppingCartButton,
    ShoppingCartDetails,
    StoreLocation,
} from "./schema/pageComponents.mjs";
import { ShoppingActions } from "./schema/userActions.mjs";
import { ShoppingPlanActions } from "./schema/planActions.mjs";
import {
    createActionResult,
    createActionResultNoDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { createExecutionTracker } from "../planVisualizationClient.mjs";
import { PageState } from "./schema/pageStates.mjs";
import {
    ElementDescriptionResult,
    PageStateMatchResult,
    PageContentQueryResult,
} from "./schema/queryResults.mjs";

// Entity collection infrastructure for commerce actions
export interface EntityInfo {
    name: string;
    type: string[];
    metadata?: Record<string, any>;
}

export interface CommerceActionResult {
    displayText: string;
    entities: EntityInfo[];
    additionalInstructions?: string[];
    noDisplay?: boolean;
}

export class EntityCollector {
    private entities: EntityInfo[] = [];

    addEntity(name: string, types: string[], metadata?: any): void {
        const existing = this.entities.find((e) => e.name === name);
        if (existing) {
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
interface CommerceActionHandlerContext {
    browser: BrowserConnector;
    agent: any;
    entities: EntityCollector;
}

export async function handleCommerceAction(
    action: ShoppingActions,
    context: ActionContext<BrowserActionContext>,
) {
    if (!context.sessionContext.agentContext.browserConnector) {
        throw new Error("No connection to browser session.");
    }

    const browser: BrowserConnector =
        context.sessionContext.agentContext.browserConnector;

    const agent = await createCommercePageTranslator("GPT_4_O_MINI");

    // Create entity collector and action context
    const entityCollector = new EntityCollector();
    const actionContext: CommerceActionHandlerContext = {
        browser,
        agent,
        entities: entityCollector,
    };

    let result: CommerceActionResult;

    switch (action.actionName) {
        case "getLocationInStore":
            result = await handleFindInStore(action, actionContext);
            break;
        case "findNearbyStore":
            result = await handleFindNearbyStore(action, actionContext);
            break;
        case "viewShoppingCart":
            result = await handleViewShoppingCart(action, actionContext);
            break;
        case "buyProduct":
            /*
            result = await handleShoppingRequest(
                action,
                actionContext,
                context,
            );
            */

            result = await handleFindAndAddToCart(
                action.parameters.productName || action.parameters.userRequest,
                actionContext,
            );

            break;
        case "searchForReservation":
            result = await handleSearchForReservation(action, actionContext);
            break;
        case "selectReservation":
            result = await handleSelectReservation(action, actionContext);
            break;
        case "getElementByDescription":
            result = await handleGetElementByDescription(action, actionContext);
            break;
        case "isPageStateMatched":
            result = await handleIsPageStateMatched(action, actionContext);
            break;
        case "queryPageContent":
            result = await handleQueryPageContent(action, actionContext);
            break;
        default:
            result = { displayText: "OK", entities: [] };
    }

    // Convert to appropriate ActionResult type
    if (result.noDisplay) {
        const actionResult = createActionResultNoDisplay(
            result.displayText,
            result.entities,
        );
        if (result.additionalInstructions) {
            actionResult.additionalInstructions = result.additionalInstructions;
        }
        return actionResult;
    } else {
        return createActionResult(
            result.displayText,
            undefined,
            result.entities,
        );
    }
}

// Helper function for getting page components
async function getComponentFromPage(
    ctx: CommerceActionHandlerContext,
    componentType: string,
    selectionCondition?: string,
) {
    const htmlFragments = await ctx.browser.getHtmlFragments();
    const timerName = `getting ${componentType} section`;

    console.time(timerName);
    const response = await ctx.agent.getPageComponentSchema(
        componentType,
        selectionCondition,
        htmlFragments,
        undefined,
    );

    if (!response.success) {
        console.error(`Attempt to get ${componentType} failed`);
        console.error(response.message);
        return;
    }

    console.timeEnd(timerName);
    return response.data;
}

async function followLink(
    ctx: CommerceActionHandlerContext,
    linkSelector: string | undefined,
) {
    if (!linkSelector) return;

    await ctx.browser.clickOn(linkSelector);
    await ctx.browser.awaitPageInteraction();
    await ctx.browser.awaitPageLoad();
}

async function searchOnWebsite(
    ctx: CommerceActionHandlerContext,
    productName: string,
) {
    const selector = (await getComponentFromPage(
        ctx,
        "SearchInput",
    )) as SearchInput;
    const searchSelector = selector.cssSelector;

    await ctx.browser.clickOn(searchSelector);
    await ctx.browser.enterTextIn(productName, searchSelector);
    await ctx.browser.clickOn(selector.submitButtonCssSelector);
    await new Promise((r) => setTimeout(r, 400));
    await ctx.browser.awaitPageLoad();
}

async function selectSearchResult(
    ctx: CommerceActionHandlerContext,
    position?: number,
    productName?: string,
) {
    let request =
        position === undefined
            ? `Search result: ${productName}`
            : `Search result: position ${position}`;
    const targetProduct = (await getComponentFromPage(
        ctx,
        "ProductTile",
        request,
    )) as ProductTile;

    await ctx.browser.clickOn(targetProduct.detailsLinkSelector);
    await new Promise((r) => setTimeout(r, 200));
    await ctx.browser.awaitPageLoad();
}

async function handleAddToCart(action: any, ctx: CommerceActionHandlerContext) {
    const targetProduct = (await getComponentFromPage(
        ctx,
        "ProductDetailsHeroTile",
    )) as ProductDetailsHeroTile;

    if (targetProduct.addToCartButton) {
        await ctx.browser.clickOn(targetProduct.addToCartButton.cssSelector);
    }
}

async function handleFindAndAddToCart(
    productName: string,
    ctx: CommerceActionHandlerContext,
) {
    let message = "OK";
    await searchOnWebsite(ctx, productName);
    await selectSearchResult(ctx, undefined, productName);

    const targetProduct = (await getComponentFromPage(
        ctx,
        "ProductDetailsHeroTile",
    )) as ProductDetailsHeroTile;

    if (targetProduct.addToCartButton) {
        await ctx.browser.clickOn(targetProduct.addToCartButton.cssSelector);
    }

    return { displayText: message, entities: ctx.entities.getEntities() };
}

async function handleFindInStore(
    action: any,
    ctx: CommerceActionHandlerContext,
): Promise<CommerceActionResult> {
    await searchOnWebsite(ctx, action.parameters.productName);
    await selectSearchResult(
        ctx,
        action.parameters.position,
        action.parameters.productName,
    );

    // wait for delay-loaded items to settle even after pageLoad is declared
    await new Promise((r) => setTimeout(r, 1000));

    const targetProduct = (await getComponentFromPage(
        ctx,
        "ProductDetailsHeroTile",
    )) as ProductDetailsHeroTile;

    let message = "OK";

    if (targetProduct && targetProduct.physicalLocationInStore) {
        // Add product entity with store location information
        ctx.entities.addEntity(
            targetProduct.productName || action.parameters.productName,
            ["product"],
            {
                source: "store_lookup",
                stockQuantity: targetProduct.numberInStock,
                physicalLocation: targetProduct.physicalLocationInStore,
                storeName: targetProduct.storeName,
            },
        );

        message = `Found ${targetProduct.numberInStock} at ${targetProduct.physicalLocationInStore} in the ${targetProduct.storeName} store`;
    } else {
        message = `Did not find target product in stock`;
        console.log(targetProduct);
    }

    return { displayText: message, entities: ctx.entities.getEntities() };
}

async function handleFindNearbyStore(
    action: any,
    ctx: CommerceActionHandlerContext,
): Promise<CommerceActionResult> {
    let message = "OK";
    const storeInfo = (await getComponentFromPage(
        ctx,
        "StoreLocation",
    )) as StoreLocation;

    if (storeInfo.locationName) {
        // Add store entity
        ctx.entities.addEntity(storeInfo.locationName, ["store"], {
            source: "location_lookup",
            zipCode: storeInfo.zipCode,
        });

        message = `Nearest store is ${storeInfo.locationName} (${storeInfo.zipCode})`;
    }

    return { displayText: message, entities: ctx.entities.getEntities() };
}

async function handleViewShoppingCart(
    action: any,
    ctx: CommerceActionHandlerContext,
): Promise<CommerceActionResult> {
    let message = "OK";

    const cartButton = (await getComponentFromPage(
        ctx,
        "ShoppingCartButton",
    )) as ShoppingCartButton;
    console.log(cartButton);

    await followLink(ctx, cartButton?.detailsLinkCssSelector);

    const cartDetails = (await getComponentFromPage(
        ctx,
        "ShoppingCartDetails",
    )) as ShoppingCartDetails;
    console.log(cartDetails);

    // Add shopping cart entity tracking
    if (cartDetails) {
        if (cartDetails.storeName) {
            ctx.entities.addEntity(
                cartDetails.storeName,
                ["store", "shoppingCart"],
                {
                    source: "cart_view",
                    totalAmount: cartDetails.totalAmount,
                    deliveryInfo: cartDetails.deliveryInformation,
                },
            );
        }

        // Add product entities from cart
        if (cartDetails.productsInCart) {
            for (let product of cartDetails.productsInCart) {
                ctx.entities.addEntity(product.productName, ["product"], {
                    source: "cart",
                    price: product.price,
                    rating: product.rating,
                    store: cartDetails.storeName,
                });
            }
        }
    }

    return { displayText: message, entities: ctx.entities.getEntities() };
}

async function runUserAction(
    action: ShoppingPlanActions,
    ctx: CommerceActionHandlerContext,
): Promise<boolean> {
    switch (action.actionName) {
        case "searchForProduct":
            await searchOnWebsite(ctx, action.parameters.productName);
            break;
        case "goToProductPage":
            if (action.parameters.productName === undefined) {
                throw new Error("Missing product name");
            }
            await selectSearchResult(
                ctx,
                action.parameters.position,
                action.parameters.productName,
            );
            break;
        case "addToCart":
            await handleAddToCart(action, ctx);
            break;
        case "getLocationInStore":
            await handleFindInStore(action, ctx);
            break;
        case "findNearbyStore":
            await handleFindNearbyStore(action, ctx);
            break;
        case "viewShoppingCart":
            await handleViewShoppingCart(action, ctx);
            break;
    }

    return true;
}

export async function handleShoppingRequest(
    action: any,
    ctx: CommerceActionHandlerContext,
    actionContext: ActionContext<BrowserActionContext>,
): Promise<CommerceActionResult> {
    let executionHistory: any[] = [];
    let lastAction: any;

    const port = actionContext.sessionContext.agentContext.localHostPort;
    const planVisualizationEndpoint = `http://localhost:${port}`;

    if (!planVisualizationEndpoint) {
        console.warn(
            "Plan visualization endpoint not assigned. Please check your configuration.",
        );
    }
    console.log("Plan visualizer: " + planVisualizationEndpoint);

    const { trackState, reset } = createExecutionTracker(
        planVisualizationEndpoint,
        action.parameters.userRequest,
    );

    await reset(true);

    actionContext.actionIO.appendDisplay({
        type: "text",
        speak: true,
        content: "Working on it ...",
    });

    const finalStateQuery = `The user would like to meet the goal: "${action.parameters.userRequest}". 
    Use your knowledge to predict what the state of the page should be once this goal is achieved.`;

    const desiredState = await ctx.agent.getPageState(finalStateQuery);

    let userRequest = action.parameters.userRequest;

    if (desiredState.success) {
        userRequest = `The user would like to meet the goal: "${action.parameters.userRequest}". 
    When this goal is met, the page state should be: ${JSON.stringify(desiredState.data)}`;
    }

    while (true) {
        const htmlFragments = await ctx.browser.getHtmlFragments();
        let screenshot = "";
        try {
            screenshot = await ctx.browser.getCurrentPageScreenshot();
        } catch (error) {
            console.warn(
                "Screenshot capture failed, continuing without screenshot:",
                (error as Error)?.message,
            );
        }
        const currentStateRequest = await ctx.agent.getPageState(
            undefined,
            htmlFragments,
        );
        let currentState = undefined;
        if (currentStateRequest.success) {
            currentState = currentStateRequest.data as PageState;

            // Track page state as entity
            if (currentState?.pageType) {
                ctx.entities.addEntity(
                    `pageState_${executionHistory.length}`,
                    ["pageState"],
                    {
                        source: "plan_execution",
                        pageType: currentState.pageType,
                        step: executionHistory.length + 1,
                    },
                );
            }

            await trackState(
                currentState?.pageType ?? "",
                undefined,
                "action",
                screenshot,
            );
        }

        const executionHistoryText =
            executionHistory.length > 0
                ? executionHistory
                      .map((entry, index) => {
                          return `
Page State ${index + 1}: ${JSON.stringify(entry.state, null, 2)}
Action ${index + 1}: ${entry.action.actionName}
Parameters: ${JSON.stringify(entry.action.parameters)}`;
                      })
                      .join("\n\n")
                : "No actions executed yet.";

        const response = await ctx.agent.getNextPageAction(
            userRequest,
            htmlFragments,
            undefined,
            executionHistoryText,
            lastAction,
        );

        if (!response.success) {
            console.error(`Attempt to get next action failed`);
            console.error(response.message);
            await trackState("Failed", "", "end", screenshot);
            break;
        }

        const nextAction = response.data as ShoppingPlanActions;

        if (nextAction.actionName === "planCompleted") {
            actionContext.actionIO.appendDisplay({
                type: "text",
                speak: true,
                content: "Completed ",
            });

            await trackState("Completed", "", "end", screenshot);
            return {
                displayText: "Completed",
                entities: ctx.entities.getEntities(),
            };
        }

        if (nextAction.actionName === "clarifyBuyAction") {
            actionContext.actionIO.appendDisplay({
                type: "text",
                speak: true,
                content: nextAction.parameters.question,
            });

            return {
                displayText: nextAction.parameters.question,
                entities: ctx.entities.getEntities(),
            };
        }

        await trackState(
            currentState?.pageType ?? "",
            nextAction.actionName,
            "action",
            screenshot,
        );

        let actionSucceeded = await runUserAction(nextAction, ctx);
        console.log(`Succeeded?: ${actionSucceeded}`);

        executionHistory.push({
            state: currentState,
            action: nextAction,
        });

        lastAction = nextAction;
    }

    // Fallback return if loop exits unexpectedly
    return {
        displayText: "Shopping request completed",
        entities: ctx.entities.getEntities(),
    };
}

function generateBookingMessage(slots: BookSelectorButton[]): string {
    const times = slots
        .map((slot) => slot.time)
        .filter((time): time is string => Boolean(time));

    if (times.length === 0) {
        return "Sorry, there are no available tables at the moment.";
    }

    const timePhrase = formatTimeList(times);
    const countPhrase = `I found ${times.length} table${times.length > 1 ? "s" : ""} available.`;

    return `${countPhrase} You can dine at ${timePhrase}. Which time should I reserve?`;
}

function formatTimeList(times: string[]): string {
    if (times.length === 1) {
        return times[0];
    } else if (times.length === 2) {
        return `${times[0]} or ${times[1]}`;
    } else {
        const allButLast = times.slice(0, -1).join(", ");
        const last = times[times.length - 1];
        return `${allButLast}, or ${last}`;
    }
}
async function selectRestaurantSearchResult(
    ctx: CommerceActionHandlerContext,
    restaurantName: string,
) {
    let request = `Search result: ${restaurantName}`;
    const targetRestaurant = (await getComponentFromPage(
        ctx,
        "RestaurantResult",
        request,
    )) as RestaurantResult;

    await ctx.browser.clickOn(targetRestaurant.detailsLinkCssSelector);
    await new Promise((r) => setTimeout(r, 200));
    await ctx.browser.awaitPageLoad();
}

async function handleSearchForReservation(
    action: any,
    ctx: CommerceActionHandlerContext,
): Promise<CommerceActionResult> {
    await searchOnWebsite(ctx, action.parameters.restaurantName);
    await selectRestaurantSearchResult(ctx, action.parameters.restaurantName);

    const reservationDraft = {
        numberOfPeople: action.parameters.numberOfPeople,
        time: action.parameters.time,
        restaurantName: action.parameters.restaurantName,
    };

    // Track reservation request entity
    ctx.entities.addEntity(action.parameters.restaurantName, ["restaurant"], {
        source: "reservation_search",
        requestedTime: action.parameters.time,
        partySize: action.parameters.numberOfPeople,
    });

    let additionalInstructions = [
        `Current reservation data: ${JSON.stringify(reservationDraft)}`,
    ];

    const reservationInfo = (await getComponentFromPage(
        ctx,
        "BookReservationsModule",
    )) as BookReservationsModule;

    let confirmationMessage;
    if (
        reservationInfo &&
        reservationInfo.availableTimeSlots &&
        reservationInfo.availableTimeSlots.length > 0
    ) {
        // Track available time slots as entities
        reservationInfo.availableTimeSlots.forEach((slot, index) => {
            ctx.entities.addEntity(
                `${action.parameters.restaurantName}_slot_${index}`,
                ["timeSlot"],
                {
                    source: "reservation_availability",
                    restaurant: action.parameters.restaurantName,
                    time: slot.time,
                    cssSelector: slot.cssSelector,
                },
            );
        });

        confirmationMessage = generateBookingMessage(
            reservationInfo.availableTimeSlots,
        );
        additionalInstructions.push(
            `If the user selects a time slot, the next action should be "selectReservation"`,
        );
    } else {
        confirmationMessage =
            "I did not find an available table at the selected time. Please select a different day or time.";
    }

    additionalInstructions.push(
        `The assistant asked the user: ${confirmationMessage}`,
    );

    return {
        displayText: confirmationMessage,
        entities: ctx.entities.getEntities(),
        additionalInstructions,
        noDisplay: true,
    };
}

async function handleSelectReservation(
    action: any,
    ctx: CommerceActionHandlerContext,
): Promise<CommerceActionResult> {
    await searchOnWebsite(ctx, action.parameters.restaurantName);
    await selectSearchResult(ctx, undefined, action.parameters.restaurantName);

    const reservationInfo = (await getComponentFromPage(
        ctx,
        "BookReservationsModule",
    )) as BookReservationsModule;

    let message = `Did not find target time in available slots`;

    // Track reservation attempt
    ctx.entities.addEntity(action.parameters.restaurantName, ["restaurant"], {
        source: "reservation_selection",
        requestedTime: action.parameters.time,
        status: "attempted",
    });

    if (
        reservationInfo &&
        reservationInfo.availableTimeSlots &&
        reservationInfo.availableTimeSlots.length > 0
    ) {
        const slots = reservationInfo.availableTimeSlots;
        const targetSlot = slots.find(
            (slot) => slot.time === action.parameters.time,
        );
        if (targetSlot) {
            await ctx.browser.clickOn(targetSlot.cssSelector);
            await new Promise((r) => setTimeout(r, 200));
            message = "I made the reservation";

            // Track successful reservation
            ctx.entities.addEntity(
                `reservation_${action.parameters.restaurantName}_${action.parameters.time}`,
                ["reservation"],
                {
                    source: "successful_booking",
                    restaurant: action.parameters.restaurantName,
                    time: action.parameters.time,
                    status: "confirmed",
                },
            );
        }
    }

    return { displayText: message, entities: ctx.entities.getEntities() };
}

/**
 * Handler for getElementByDescription action
 * Locates element on page and returns its information
 */
async function handleGetElementByDescription(
    action: any,
    ctx: CommerceActionHandlerContext,
): Promise<CommerceActionResult> {
    const htmlFragments = await ctx.browser.getHtmlFragments();
    let screenshot: string | undefined;

    try {
        screenshot = await ctx.browser.getCurrentPageScreenshot();
    } catch (error) {
        console.warn("Screenshot capture failed:", (error as Error)?.message);
    }

    console.time("getElementByDescription");
    const response = await ctx.agent.getElementByDescription(
        action.parameters.elementDescription,
        action.parameters.elementType,
        htmlFragments,
        screenshot,
    );
    console.timeEnd("getElementByDescription");

    if (!response.success) {
        const errorMsg = `Failed to locate element: ${response.message}`;
        console.error(errorMsg);
        return {
            displayText: errorMsg,
            entities: ctx.entities.getEntities(),
        };
    }

    const elementInfo = response.data as ElementDescriptionResult;

    if (!elementInfo.found) {
        const notFoundMsg = `Element not found: ${elementInfo.notFoundReason || "No matching element on page"}`;
        return {
            displayText: notFoundMsg,
            entities: ctx.entities.getEntities(),
        };
    }

    // Track element as entity for knowledge collection
    ctx.entities.addEntity(
        elementInfo.elementName,
        ["uiElement", elementInfo.elementType || "element"],
        {
            source: "element_query",
            cssSelector: elementInfo.elementCssSelector,
            text: elementInfo.elementText,
            attributes: elementInfo.elementAttributes,
            html: elementInfo.elementHtml?.substring(0, 500), // Truncate long HTML
        },
    );

    const successMsg =
        `Found element: ${elementInfo.elementName}` +
        (elementInfo.elementCssSelector
            ? ` (selector: ${elementInfo.elementCssSelector})`
            : "") +
        (elementInfo.elementText ? ` - "${elementInfo.elementText}"` : "");

    return {
        displayText: successMsg,
        entities: ctx.entities.getEntities(),
    };
}

/**
 * Handler for isPageStateMatched action
 * Verifies current page state against expected condition
 */
async function handleIsPageStateMatched(
    action: any,
    ctx: CommerceActionHandlerContext,
): Promise<CommerceActionResult> {
    const htmlFragments = await ctx.browser.getHtmlFragments();
    let screenshot: string | undefined;

    try {
        screenshot = await ctx.browser.getCurrentPageScreenshot();
    } catch (error) {
        console.warn("Screenshot capture failed:", (error as Error)?.message);
    }

    console.time("checkPageStateMatch");
    const response = await ctx.agent.checkPageStateMatch(
        action.parameters.expectedStateDescription,
        htmlFragments,
        screenshot,
    );
    console.timeEnd("checkPageStateMatch");

    if (!response.success) {
        const errorMsg = `Failed to verify page state: ${response.message}`;
        console.error(errorMsg);
        return {
            displayText: errorMsg,
            entities: ctx.entities.getEntities(),
        };
    }

    const matchResult = response.data as PageStateMatchResult;

    // Track page state as entity
    ctx.entities.addEntity(`pageState_${Date.now()}`, ["pageState"], {
        source: "state_verification",
        pageType: matchResult.currentPageState.pageType,
        matched: matchResult.matched,
        confidence: matchResult.matchDetails?.confidence,
        expectedState: action.parameters.expectedStateDescription,
    });

    const statusMsg = matchResult.matched
        ? `✓ Page state matched: ${matchResult.explanation}`
        : `✗ Page state not matched: ${matchResult.explanation}`;

    return {
        displayText: statusMsg,
        entities: ctx.entities.getEntities(),
    };
}

/**
 * Handler for queryPageContent action
 * Answers user questions using page content
 */
async function handleQueryPageContent(
    action: any,
    ctx: CommerceActionHandlerContext,
): Promise<CommerceActionResult> {
    const htmlFragments = await ctx.browser.getHtmlFragments();
    let screenshot: string | undefined;

    try {
        screenshot = await ctx.browser.getCurrentPageScreenshot();
    } catch (error) {
        console.warn("Screenshot capture failed:", (error as Error)?.message);
    }

    console.time("queryPageContent");
    const response = await ctx.agent.queryPageContent(
        action.parameters.query,
        htmlFragments,
        screenshot,
    );
    console.timeEnd("queryPageContent");

    if (!response.success) {
        const errorMsg = `Failed to query page content: ${response.message}`;
        console.error(errorMsg);
        return {
            displayText: errorMsg,
            entities: ctx.entities.getEntities(),
        };
    }

    const queryResult = response.data as PageContentQueryResult;

    if (!queryResult.answered) {
        const unableMsg = `Unable to answer query: ${queryResult.unableToAnswerReason || "Information not found on page"}`;

        if (
            queryResult.suggestedNextSteps &&
            queryResult.suggestedNextSteps.length > 0
        ) {
            const suggestions = queryResult.suggestedNextSteps.join(", ");
            return {
                displayText: `${unableMsg}. Suggested: ${suggestions}`,
                entities: ctx.entities.getEntities(),
            };
        }

        return {
            displayText: unableMsg,
            entities: ctx.entities.getEntities(),
        };
    }

    // Track query result as entity
    ctx.entities.addEntity(`query_${Date.now()}`, ["queryResult"], {
        source: "content_query",
        query: action.parameters.query,
        answer: queryResult.answerText,
        confidence: queryResult.confidence,
        evidence: queryResult.evidence?.relevantText,
    });

    const answerMsg = queryResult.answerText || "Query answered successfully";
    const confidenceInfo = queryResult.confidence
        ? ` (confidence: ${(queryResult.confidence * 100).toFixed(0)}%)`
        : "";

    return {
        displayText: `${answerMsg}${confidenceInfo}`,
        entities: ctx.entities.getEntities(),
    };
}
