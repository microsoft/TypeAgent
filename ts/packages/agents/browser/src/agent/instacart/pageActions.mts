// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { BrowserConnector } from "../browserConnector.mjs";
import { PurchaseResults } from "../commerce/schema/shoppingResults.mjs";
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
import { ECommerceSiteAgent } from "../commerce/translator.mjs";
import { InstacartActions } from "./schema/userActions.mjs";

export type UIElementSchemas = {
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

export function setupPageActions(
    browser: BrowserConnector,
    agent: ECommerceSiteAgent<InstacartActions>,
) {
    return {
        getPageComponent: getPageComponent,
        followLink: followLink,
        goToHomepage: goToHomepage,
        searchOnWebsite: searchOnWebsite,
        addAllProductsToCart: addAllProductsToCart,
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
        console.log(link);

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

    async function addAllProductsToCart(
        products: ProductTile[],
        storeName: string,
    ) {
        let results: PurchaseResults = {
            addedToCart: [],
            unavailable: [],
            storeName: storeName,
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
}
