// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
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

export async function handleCommerceAction(
    action: ShoppingActions,
    context: SessionContext<BrowserActionContext>,
) {
    let message = "OK";
    if (!context.agentContext.browserConnector) {
        throw new Error("No connection to browser session.");
    }

    const browser: BrowserConnector = context.agentContext.browserConnector;

    const agent = await createCommercePageTranslator("GPT_4_O_MINI");

    switch (action.actionName) {
        case "searchForProductAction":
            await searchForProduct(action.parameters.productName);
            break;
        case "selectSearchResult":
            if (action.parameters.productName === undefined) {
                throw new Error("Missing product name");
            }
            await selectSearchResult(action.parameters.productName);
            break;
        case "addToCartAction":
            await handleAddToCart(action);
            break;
        case "getLocationInStore":
            await handleFindInStore(action);
            break;
        case "findNearbyStoreAction":
            await handleFindNearbyStore(action);
            break;
        case "viewShoppingCartAction":
            await handleViewShoppingCart(action);
            break;
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

    async function selectSearchResult(productName: string) {
        const request = `Search result: ${productName}`;
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
        await selectSearchResult(action.parameters.productName);

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

    return message;
}
