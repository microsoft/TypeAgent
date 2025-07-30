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
import registerDebug from "debug";

const debug = registerDebug(
    "typeagent:browser:discover:tempAgentActionHandler",
);

// Context interface for temp agent action handler functions
interface TempAgentActionHandlerContext {
    browser: BrowserConnector;
    agent: any;
    sessionContext: SessionContext<BrowserActionContext>;
    actionUtils: ReturnType<typeof setupAuthoringActions>;
}

async function handleNavigateToPage(
    action: NavigateToPage,
    ctx: TempAgentActionHandlerContext,
): Promise<void> {
    const link = (await ctx.actionUtils.getComponentFromPage(
        "NavigationLink",
        `link text ${action.parameters.keywords}`,
    )) as NavigationLink;
    debug(link);

    await ctx.actionUtils.followLink(link?.linkCssSelector);
}

async function handleBrowseProductCategory(
    action: BrowseProductCategories,
    ctx: TempAgentActionHandlerContext,
): Promise<void> {
    let linkText = action.parameters?.categoryName
        ? `link text ${action.parameters.categoryName}`
        : "";
    const link = (await ctx.actionUtils.getComponentFromPage(
        "NavigationLink",
        linkText,
    )) as NavigationLink;
    debug(link);

    await ctx.actionUtils.followLink(link?.linkCssSelector);
}

async function handleUserDefinedAction(
    action: any,
    ctx: TempAgentActionHandlerContext,
): Promise<void> {
    const url = await getSessionBrowserControl(ctx.sessionContext).getPageUrl();
    const agentContext = ctx.sessionContext.agentContext;

    if (!agentContext.macrosStore) {
        throw new Error("ActionsStore not available for temp agent");
    }

    const allActions = await agentContext.macrosStore.getMacrosForUrl(url!);

    // Filter for user-authored actions only
    const userActions = allActions.filter(
        (action: any) => action.author === "user",
    );

    const intentJson = new Map<string, RecordedUserIntent>();
    const actionsJson = new Map<string, PageActionsPlan>();

    for (const storedMacro of userActions) {
        if (storedMacro.definition.intentJson) {
            // Convert from StoredUserIntent to RecordedUserIntent
            const storedIntent = storedMacro.definition
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
            intentJson.set(storedMacro.name, recordedIntent);
        }
        if (storedMacro.definition.steps) {
            // Convert MacroStep[] to PageActionsPlan format
            const actionPlan: PageActionsPlan = {
                planName: storedMacro.name,
                description: storedMacro.description,
                intentSchemaName: storedMacro.name,
                steps: storedMacro.definition.steps as any, // Type conversion needed here
            };
            actionsJson.set(storedMacro.name, actionPlan);
        }
    }

    if (
        !intentJson.has(action.actionName) ||
        !actionsJson.has(action.actionName)
    ) {
        debug(
            `Action ${action.actionName} was not found on the list of user-defined actions`,
        );
        return;
    }

    const targetIntent = intentJson.get(
        action.actionName,
    ) as RecordedUserIntent;
    const targetPlan = actionsJson.get(action.actionName) as PageActionsPlan;

    const paramsMap = new Map(Object.entries(action.parameters || {}));

    await ctx.actionUtils.runDynamicAction(targetIntent, targetPlan, paramsMap);
}

export function createTempAgentForSchema(
    browser: BrowserConnector,
    agent: any,
    context: SessionContext<BrowserActionContext>,
): AppAgent {
    const actionUtils = setupAuthoringActions(browser, agent, context);
    const ctx: TempAgentActionHandlerContext = {
        browser,
        agent,
        sessionContext: context,
        actionUtils,
    };

    return {
        async executeAction(action: any, tempContext: any): Promise<undefined> {
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
                    await handleBrowseProductCategory(action, ctx);
                    break;
                case "filterProducts":
                    break;
                case "navigateToPage":
                    await handleNavigateToPage(action, ctx);
                    break;
                case "navigateToProductPage":
                    break;
                case "removeFromCart":
                    break;
                case "signUpForNewsletter":
                    break;
                default:
                    await handleUserDefinedAction(action, ctx);
                    break;
            }
        },
    };
}
