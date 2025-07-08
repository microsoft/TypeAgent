// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, SessionContext } from "@typeagent/agent-sdk";
import { BrowserConnector } from "../browserConnector.mjs";
import {
    BrowseProductCategories,
    NavigateToPage,
} from "./schema/userActionsPool.mjs";
import { handleCommerceAction } from "../commerce/actionHandler.mjs";
import { NavigationLink } from "./schema/pageComponents.mjs";
import {
    PageActionsPlan,
    UserIntent as RecordedUserIntent,
} from "./schema/recordedActions.mjs";
import { setupAuthoringActions } from "./authoringUtilities.mjs";
import {
    BrowserActionContext,
    getSessionBrowserControl,
} from "../actionHandler.mjs";
import { UserIntent as StoredUserIntent } from "../storage/types.mjs";

export function createTempAgentForSchema(
    browser: BrowserConnector,
    agent: any,
    context: SessionContext<BrowserActionContext>,
): AppAgent {
    const actionUtils = setupAuthoringActions(browser, agent, context);
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
        const url = await getSessionBrowserControl(context).getPageUrl();
        const agentContext = context.agentContext;

        if (!agentContext.actionsStore) {
            throw new Error("ActionsStore not available for temp agent");
        }

        const allActions = await agentContext.actionsStore.getActionsForUrl(
            url!,
        );

        // Filter for user-authored actions only
        const userActions = allActions.filter(
            (action) => action.author === "user",
        );

        const intentJson = new Map<string, RecordedUserIntent>();
        const actionsJson = new Map<string, PageActionsPlan>();

        for (const storedAction of userActions) {
            if (storedAction.definition.intentJson) {
                // Convert from StoredUserIntent to RecordedUserIntent
                const storedIntent = storedAction.definition
                    .intentJson as StoredUserIntent;
                const recordedIntent: RecordedUserIntent = {
                    actionName: storedIntent.actionName,
                    parameters: storedIntent.parameters.map((param) => ({
                        shortName: param.shortName,
                        name: param.description, // Use description as name
                        type: param.type,
                        defaultValue: param.defaultValue,
                        valueOptions: [], // Not available in stored format
                        description: param.description,
                        required: param.required,
                    })),
                };
                intentJson.set(storedAction.name, recordedIntent);
            }
            if (storedAction.definition.actionSteps) {
                // Convert ActionStep[] to PageActionsPlan format
                const actionPlan: PageActionsPlan = {
                    planName: storedAction.name,
                    description: storedAction.description,
                    intentSchemaName: storedAction.name,
                    steps: storedAction.definition.actionSteps as any, // Type conversion needed here
                };
                actionsJson.set(storedAction.name, actionPlan);
            }
        }

        if (
            !intentJson.has(action.actionName) ||
            !actionsJson.has(action.actionName)
        ) {
            console.log(
                `Action ${action.actionName} was not found on the list of user-defined actions`,
            );
            return;
        }

        const targetIntent = intentJson.get(
            action.actionName,
        ) as RecordedUserIntent;
        const targetPlan = actionsJson.get(
            action.actionName,
        ) as PageActionsPlan;

        console.log(`Running ${targetPlan.planName}`);

        const paramsMap = new Map(Object.entries(action.parameters));

        await actionUtils.runDynamicAction(targetIntent, targetPlan, paramsMap);
    }
}
