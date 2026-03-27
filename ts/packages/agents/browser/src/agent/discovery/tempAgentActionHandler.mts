// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, SessionContext } from "@typeagent/agent-sdk";
import { BrowserControl } from "../../common/browserControl.mjs";
import {
    BrowseProductCategories,
    NavigateToPage,
} from "./schema/userActionsPool.mjs";
import { NavigationLink } from "./schema/pageComponents.mjs";
import {
    BrowserActionContext,
    getCurrentPageScreenshot,
} from "../browserActions.mjs";
import { handleWebFlowAction } from "../webFlows/actionHandler.mjs";
import registerDebug from "debug";

const debug = registerDebug(
    "typeagent:browser:discover:tempAgentActionHandler",
);

interface TempAgentActionHandlerContext {
    browser: BrowserControl;
    agent: any;
    sessionContext: SessionContext<BrowserActionContext>;
}

async function getComponentFromPage(
    ctx: TempAgentActionHandlerContext,
    componentType: string,
    selectionCondition?: string,
) {
    const htmlFragments = await ctx.browser.getHtmlFragments();
    let screenshot = "";
    try {
        screenshot = await getCurrentPageScreenshot(ctx.browser);
    } catch (error) {
        console.warn(
            "Screenshot capture failed, continuing without screenshot:",
            (error as Error)?.message,
        );
    }
    const screenshots = screenshot ? [screenshot] : [];

    const response = await ctx.agent.getPageComponentSchema(
        componentType,
        selectionCondition,
        htmlFragments,
        screenshots,
    );

    if (!response.success) {
        console.error(`Attempt to get ${componentType} failed`);
        console.error(response.message);
        return;
    }

    return response.data;
}

async function followLink(
    ctx: TempAgentActionHandlerContext,
    linkSelector: string | undefined,
) {
    if (!linkSelector) return;
    await ctx.browser.clickOn(linkSelector);
    await ctx.browser.awaitPageInteraction();
    await ctx.browser.awaitPageLoad();
}

async function handleNavigateToPage(
    action: NavigateToPage,
    ctx: TempAgentActionHandlerContext,
): Promise<void> {
    const link = (await getComponentFromPage(
        ctx,
        "NavigationLink",
        `link text ${action.parameters.keywords}`,
    )) as NavigationLink;
    debug(link);

    await followLink(ctx, link?.linkCssSelector);
}

async function handleBrowseProductCategory(
    action: BrowseProductCategories,
    ctx: TempAgentActionHandlerContext,
): Promise<void> {
    let linkText = action.parameters?.categoryName
        ? `link text ${action.parameters.categoryName}`
        : "";
    const link = (await getComponentFromPage(
        ctx,
        "NavigationLink",
        linkText,
    )) as NavigationLink;
    debug(link);

    await followLink(ctx, link?.linkCssSelector);
}

export function createTempAgentForSchema(
    browser: BrowserControl,
    agent: any,
    context: SessionContext<BrowserActionContext>,
): AppAgent {
    const ctx: TempAgentActionHandlerContext = {
        browser,
        agent,
        sessionContext: context,
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
