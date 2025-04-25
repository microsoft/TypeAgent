// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent } from "@typeagent/agent-sdk";
import { BrowserConnector } from "../browserConnector.mjs";
import {
    BrowseProductCategories,
    NavigateToPage,
} from "./schema/userActionsPool.mjs";
import { handleCommerceAction } from "../commerce/actionHandler.mjs";
import { NavigationLink } from "./schema/pageComponents.mjs";
import { PageActionsPlan, UserIntent } from "./schema/recordedActions.mjs";
import { setupAuthoringActions } from "./authoringUtilities.mjs";

export function createTempAgentForSchema(
    browser: BrowserConnector,
    agent: any,
    context: any,
): AppAgent {
    const actionUtils = setupAuthoringActions(browser, agent);
    return {
        async executeAction(action: any, tempContext: any): Promise<undefined> {
            console.log(`Executing action: ${action.actionName}`);
            switch (action.actionName) {
                case "addToCart":
                case "viewShoppingCart":
                case "findNearbyStore":
                case "getLocationInStore":
                case "searchForProduct":
                case "selectSearchResult":
                    handleCommerceAction(action, tempContext);
                    break;
                case "browseProductCategories":
                    handleBrowseProductCategory(action);
                    break;
                case "filterProducts":
                    break;
                case "navigateToPage":
                    handleNavigateToPage(action);
                    break;
                case "navigateToProductPage":
                    break;
                case "removeFromCart":
                    break;
                case "signUpForNewsletter":
                    break;
                default:
                    handleUserDefinedAction(action);
                    break;
            }
        },
    };

    async function handleNavigateToPage(action: NavigateToPage) {
        const link = (await actionUtils.getComponentFromPage(
            "NavigationLink",
            `link text ${action.parameters.keywords}`,
        )) as NavigationLink;
        console.log(link);

        await actionUtils.followLink(link?.linkCssSelector);
    }

    async function handleBrowseProductCategory(
        action: BrowseProductCategories,
    ) {
        let linkText = action.parameters?.categoryName
            ? `link text ${action.parameters.categoryName}`
            : "";
        const link = (await actionUtils.getComponentFromPage(
            "NavigationLink",
            linkText,
        )) as NavigationLink;
        console.log(link);

        await actionUtils.followLink(link?.linkCssSelector);
    }

    async function handleUserDefinedAction(action: any) {
        const url = await browser.getPageUrl();
        const intentJson = new Map(
            Object.entries(
                (await browser.getCurrentPageStoredProperty(
                    url!,
                    "authoredIntentJson",
                )) ?? {},
            ),
        );

        const actionsJson = new Map(
            Object.entries(
                (await browser.getCurrentPageStoredProperty(
                    url!,
                    "authoredActionsJson",
                )) ?? {},
            ),
        );

        if (
            !intentJson.has(action.actionName) ||
            !actionsJson.has(action.actionName)
        ) {
            console.log(
                `Action ${action.actionName} was not found on the list of user-defined actions`,
            );
            return;
        }

        const targetIntent = intentJson.get(action.actionName) as UserIntent;
        const targetPlan = actionsJson.get(
            action.actionName,
        ) as PageActionsPlan;

        console.log(`Running ${targetPlan.planName}`);

        const paramsMap = new Map(Object.entries(action.parameters));

        await actionUtils.runDynamicAction(targetIntent, targetPlan, paramsMap);
    }
}
