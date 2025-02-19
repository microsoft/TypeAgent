// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent } from "@typeagent/agent-sdk";
import { BrowserConnector } from "../browserConnector.mjs";
import {
    BrowseProductCategoriesAction,
    NavigateToPage,
} from "./schema/userActionsPool.mjs";
import { handleCommerceAction } from "../commerce/actionHandler.mjs";
import { NavigationLink } from "./schema/pageComponents.mjs";

export function createTempAgentForSchema(
    browser: BrowserConnector,
    agent: any,
    context: any,
): AppAgent {
    return {
        async executeAction(action: any, tempContext: any): Promise<undefined> {
            console.log(`Executing action: ${action.actionName}`);
            switch (action.actionName) {
                case "addToCartAction":
                case "viewShoppingCartAction":
                case "findNearbyStoreAction":
                case "getLocationInStore":
                case "searchForProductAction":
                case "selectSearchResult":
                    handleCommerceAction(action, context);
                    break;
                case "browseProductCategoriesAction":
                    handleBrowseProductCategory(action);
                    break;
                case "filterProductsAction":
                    break;
                case "navigateToPage":
                    handleNavigateToPage(action);
                    break;
                case "navigateToProductPage":
                    break;
                case "removeFromCartAction":
                    break;
                case "signUpForNewsletterAction":
                    break;
            }
        },
    };

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

    async function handleNavigateToPage(action: NavigateToPage) {
        const link = (await getComponentFromPage(
            "NavigationLink",
            `link text ${action.parameters.keywords}`,
        )) as NavigationLink;
        console.log(link);

        await followLink(link?.linkCssSelector);
    }

    async function handleBrowseProductCategory(
        action: BrowseProductCategoriesAction,
    ) {
        let linkText = action.parameters?.categoryName
            ? `link text ${action.parameters.categoryName}`
            : "";
        const link = (await getComponentFromPage(
            "NavigationLink",
            linkText,
        )) as NavigationLink;
        console.log(link);

        await followLink(link?.linkCssSelector);
    }
}
