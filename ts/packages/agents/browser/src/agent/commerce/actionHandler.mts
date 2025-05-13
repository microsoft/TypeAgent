// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../actionHandler.mjs";
import { BrowserConnector } from "../browserConnector.mjs";
import { createCommercePageTranslator } from "./translator.mjs";
import {
    ProductDetailsHeroTile,
    ProductTile,
    SearchInput,
    ShoppingCartButton,
    ShoppingCartDetails,
    StoreLocation,
} from "./schema/pageComponents.mjs";
import { ShoppingActions } from "./schema/userActions.mjs";
import { ShoppingPlanActions } from "./schema/planActions.mjs";
import { createActionResultNoDisplay } from "@typeagent/agent-sdk/helpers/action";
import { createExecutionTracker } from "../planVisualizationClient.mjs";
import { PageState } from "./schema/pageStates.mjs";

export async function handleCommerceAction(
    action: ShoppingActions,
    context: ActionContext<BrowserActionContext>,
) {
    let message = "OK";
    if (!context.sessionContext.agentContext.browserConnector) {
        throw new Error("No connection to browser session.");
    }

    const browser: BrowserConnector =
        context.sessionContext.agentContext.browserConnector;

    const agent = await createCommercePageTranslator("GPT_4_O_MINI");

    switch (action.actionName) {
        case "getLocationInStore":
            await handleFindInStore(action);
            break;
        case "findNearbyStore":
            await handleFindNearbyStore(action);
            break;
        case "viewShoppingCart":
            await handleViewShoppingCart(action);
            break;
        case "buyProduct":
            return await handleShoppingRequest(action);
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
            console.error(`Attempt to get ${componentType} failed`);
            console.error(response.message);
            return;
        }

        console.timeEnd(timerName);
        return response.data;
    }

    async function followLink(linkSelector: string | undefined) {
        if (!linkSelector) return;

        await browser.clickOn(linkSelector);
        await browser.awaitPageInteraction();
        await browser.awaitPageLoad();
    }

    async function searchForProduct(productName: string) {
        const selector = (await getComponentFromPage(
            "SearchInput",
        )) as SearchInput;
        const searchSelector = selector.cssSelector;

        await browser.clickOn(searchSelector);
        await browser.enterTextIn(productName, searchSelector);
        await browser.clickOn(selector.submitButtonCssSelector);
        await new Promise((r) => setTimeout(r, 400));
        await browser.awaitPageLoad();
    }

    async function selectSearchResult(position?: number, productName?: string) {
        let request =
            position === undefined
                ? `Search result: ${productName}`
                : `Search result: position ${position}`;
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

    async function handleFindInStore(action: any) {
        await searchForProduct(action.parameters.productName);
        await selectSearchResult(
            action.parameters.position,
            action.parameters.productName,
        );

        // wait for delay-loaded items to settle even after pageLoad is declared
        await new Promise((r) => setTimeout(r, 1000));

        const targetProduct = (await getComponentFromPage(
            "ProductDetailsHeroTile",
        )) as ProductDetailsHeroTile;

        if (targetProduct && targetProduct.physicalLocationInStore) {
            message = `Found ${targetProduct.numberInStock} at ${targetProduct.physicalLocationInStore} in the ${targetProduct.storeName} store`;
            return;
        } else {
            message = `Did not find target product in stock`;
            console.log(targetProduct);
        }
    }

    async function handleFindNearbyStore(action: any) {
        //StoreLocation

        const storeInfo = (await getComponentFromPage(
            "StoreLocation",
        )) as StoreLocation;

        if (storeInfo.locationName) {
            message = `Nearest store is ${storeInfo.locationName} (${storeInfo.zipCode})`;
        }
    }

    async function handleViewShoppingCart(action: any) {
        const cartButton = (await getComponentFromPage(
            "ShoppingCartButton",
        )) as ShoppingCartButton;
        console.log(cartButton);

        await followLink(cartButton?.detailsLinkCssSelector);

        const cartDetails = (await getComponentFromPage(
            "ShoppingCartDetails",
        )) as ShoppingCartDetails;
        console.log(cartDetails);
    }

    async function runUserAction(action: any) {
        console.log(
            `Running: ${action.actionName} with parameters ${JSON.stringify(action.parameters)}`,
        );
        switch (action.actionName) {
            case "searchForProduct":
                await searchForProduct(action.parameters.productName);
                break;
            case "goToProductPage":
            case "selectSearchResult":
                if (action.parameters.productName === undefined) {
                    throw new Error("Missing product name");
                }
                await selectSearchResult(
                    action.parameters.position,
                    action.parameters.productName,
                );
                break;
            case "addToCart":
                await handleAddToCart(action);
                break;
            case "getLocationInStore":
                await handleFindInStore(action);
                break;
            case "findNearbyStore":
                await handleFindNearbyStore(action);
                break;
            case "viewShoppingCart":
                await handleViewShoppingCart(action);
                break;
        }

        return true;
    }

    async function handleShoppingRequest(action: any) {
        let executionHistory: any[] = [];
        let lastAction: any;

        const planVisualizationEndpoint = `http://localhost:${context.sessionContext.getSharedLocalHostPort("planVisualizer")}`;

        if (!planVisualizationEndpoint) {
            throw new Error(
                "Plan visualization endpoint not assigned. Please check your configuration.",
            );
        }
        console.log("Plan visualizer: " + planVisualizationEndpoint);

        const { trackState, reset } = createExecutionTracker(
            planVisualizationEndpoint,
            action.parameters.userRequest,
        );

        await reset(true);

        context.actionIO.appendDisplay({
            type: "text",
            speak: true,
            content: "Working on it ...",
        });

        const finalStateQuery = `The user would like to meet the goal: "${action.parameters.userRequest}". 
        Use your knowledge to predict what the state of the page should be once this goal is achieved.`;

        const desiredState = await agent.getPageState(finalStateQuery);

        let userRequest = action.parameters.userRequest;

        if (desiredState.success) {
            userRequest = `The user would like to meet the goal: "${action.parameters.userRequest}". 
        When this goal is met, the page state should be: ${JSON.stringify(desiredState.data)}`;
        }

        while (true) {
            const htmlFragments = await browser.getHtmlFragments();
            const screenshot = await browser.getCurrentPageScreenshot();
            const currentStateRequest = await agent.getPageState(
                undefined,
                htmlFragments,
            );
            let currentState = undefined;
            if (currentStateRequest.success) {
                currentState = currentStateRequest.data as PageState;

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

            const response = await agent.getNextPageAction(
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
                context.actionIO.appendDisplay({
                    type: "text",
                    speak: true,
                    content: "Completed ",
                });

                await trackState("Completed", "", "end", screenshot);
                break;
            }

            if (nextAction.actionName === "clarifyBuyAction") {
                context.actionIO.appendDisplay({
                    type: "text",
                    speak: true,
                    content: nextAction.parameters.question,
                });

                const result = createActionResultNoDisplay(
                    nextAction.parameters.question,
                );
                result.additionalInstructions = [
                    `The assistant asked the user: ${nextAction.parameters.question}`,
                ];

                return result;
            }

            await trackState(
                currentState?.pageType ?? "",
                nextAction.actionName,
                "action",
                screenshot,
            );

            let actionSucceeded = await runUserAction(nextAction);
            console.log(`Succeeded?: ${actionSucceeded}`);

            executionHistory.push({
                state: currentState,
                action: nextAction,
            });

            lastAction = nextAction;
        }
    }

    return message;
}
