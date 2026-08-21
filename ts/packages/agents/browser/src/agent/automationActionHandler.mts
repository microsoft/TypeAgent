// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    executeCommandFromHandlers,
} from "@typeagent/agent-sdk/helpers/command";
import { BrowserActionContext } from "./browserActions.mjs";
import { BrowserAutomationActions } from "./automationActionSchema.mjs";

type CommandExecutor = (
    handlers: CommandHandlerTable,
    commands: string[],
    params: undefined,
    context: ActionContext<BrowserActionContext>,
) => Promise<ActionResult | undefined>;

export function executeBrowserAutomationAction(
    action: TypeAgentAction<BrowserAutomationActions, "browser.automation">,
    context: ActionContext<BrowserActionContext>,
    handlers: CommandHandlerTable,
    execute: CommandExecutor = executeCommandFromHandlers,
): Promise<ActionResult | undefined> {
    switch (action.actionName) {
        case "launchHiddenAutomationBrowser":
            return execute(
                handlers,
                ["auto", "launch", "hidden"],
                undefined,
                context,
            );
        case "launchStandaloneAutomationBrowser":
            return execute(
                handlers,
                ["auto", "launch", "standalone"],
                undefined,
                context,
            );
        case "closeAutomationBrowser":
            return execute(handlers, ["auto", "close"], undefined, context);
    }
}
