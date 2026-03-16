// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, SessionContext } from "@typeagent/agent-sdk";
import { BrowserControl } from "../../common/browserControl.mjs";
import {
    BrowseProductCategories,
    NavigateToPage,
} from "./schema/userActionsPool.mjs";
import { NavigationLink } from "./schema/pageComponents.mjs";
import { setupAuthoringActions } from "./authoringUtilities.mjs";
import { BrowserActionContext } from "../browserActions.mjs";
import { handleWebFlowAction } from "../webFlows/actionHandler.mjs";
import registerDebug from "debug";

const debug = registerDebug(
    "typeagent:browser:discover:tempAgentActionHandler",
);

// Context interface for temp agent action handler functions
interface TempAgentActionHandlerContext {
    browser: BrowserControl;
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

export function createTempAgentForSchema(
    browser: BrowserControl,
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
            // Execute as a webFlow
            const webFlowStore = ctx.sessionContext.agentContext.webFlowStore;
            if (webFlowStore) {
                const flow = await webFlowStore.get(action.actionName);
                if (flow) {
                    debug(
                        `Delegating ${action.actionName} to webFlow executor`,
                    );
                    const result = await handleWebFlowAction(
                        {
                            actionName: action.actionName,
                            parameters: action.parameters,
                        },
                        ctx.sessionContext,
                    );
                    debug(`WebFlow result: ${result.displayText}`);
                    return;
                }
            }

            // Hardcoded handlers for built-in actions
            switch (action.actionName) {
                case "browseProductCategories":
                    await handleBrowseProductCategory(action, ctx);
                    break;
                case "navigateToPage":
                    await handleNavigateToPage(action, ctx);
                    break;
                default:
                    debug(`No webFlow found for action: ${action.actionName}`);
                    break;
            }
        },
    };
}
