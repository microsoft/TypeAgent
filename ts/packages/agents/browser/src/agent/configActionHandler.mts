// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ActionResult,
    ParsedCommandParams,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    executeCommandFromHandlers,
} from "@typeagent/agent-sdk/helpers/command";
import { BrowserActionContext } from "./browserActions.mjs";
import { BrowserConfigActions } from "./configActionSchema.mjs";

type CommandExecutor = (
    handlers: CommandHandlerTable,
    commands: string[],
    params: ParsedCommandParams<any> | undefined,
    context: ActionContext<BrowserActionContext>,
) => Promise<ActionResult | undefined>;

export async function executeBrowserConfigAction(
    action: TypeAgentAction<BrowserConfigActions, "browser.config">,
    context: ActionContext<BrowserActionContext>,
    handlers: CommandHandlerTable,
    execute: CommandExecutor = executeCommandFromHandlers,
): Promise<ActionResult | undefined> {
    switch (action.actionName) {
        case "useExternalBrowserControl":
            return execute(handlers, ["external", "on"], undefined, context);
        case "useClientBrowserControl":
            return execute(handlers, ["external", "off"], undefined, context);
        case "listUrlResolvers":
            return execute(handlers, ["resolver", "list"], undefined, context);
        case "toggleKeywordResolver":
            return execute(
                handlers,
                ["resolver", "keyword"],
                undefined,
                context,
            );
        case "toggleHistoryResolver":
            return execute(
                handlers,
                ["resolver", "history"],
                undefined,
                context,
            );
        case "showLookupSettings":
            return execute(handlers, ["lookup", "status"], undefined, context);
        case "setLookupMode":
            return execute(
                handlers,
                ["lookup", "mode"],
                {
                    args: { mode: action.parameters.mode },
                    flags: undefined,
                },
                context,
            );
        case "listSearchProviders":
            return execute(handlers, ["search", "list"], undefined, context);
        case "setSearchProvider":
            return execute(
                handlers,
                ["search", "set"],
                {
                    args: { provider: action.parameters.provider },
                    flags: undefined,
                },
                context,
            );
        case "showSearchProvider":
            return execute(
                handlers,
                ["search", "show"],
                {
                    args: {
                        provider:
                            action.parameters?.provider?.trim() || undefined,
                    },
                    flags: undefined,
                },
                context,
            );
        case "addSearchProvider":
            return execute(
                handlers,
                ["search", "add"],
                {
                    args: {
                        provider: action.parameters.provider,
                        url: action.parameters.url,
                    },
                    flags: undefined,
                },
                context,
            );
        case "removeSearchProvider":
            return execute(
                handlers,
                ["search", "remove"],
                {
                    args: { provider: action.parameters.provider },
                    flags: undefined,
                },
                context,
            );
        case "importSearchProviders":
            return execute(
                handlers,
                ["search", "import"],
                {
                    args: { browser: action.parameters.browser },
                    flags: undefined,
                },
                context,
            );
    }
}
