// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    ParameterDefinitions,
    ActionResult,
    ParsedCommandParams,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
import {
    CommandHandlerTable,
    executeCommandFromHandlers,
} from "@typeagent/agent-sdk/helpers/command";
import { BrowserActionContext } from "./browserActions.mjs";
import { BrowserPageToolsActions } from "./pageToolsActionSchema.mjs";

type CommandExecutor = (
    handlers: CommandHandlerTable,
    commands: string[],
    params: ParsedCommandParams<ParameterDefinitions> | undefined,
    context: ActionContext<BrowserActionContext>,
) => Promise<ActionResult | undefined>;

export function executeBrowserPageToolsAction(
    action: TypeAgentAction<BrowserPageToolsActions, "browser.pageTools">,
    context: ActionContext<BrowserActionContext>,
    handlers: CommandHandlerTable,
    execute: CommandExecutor = executeCommandFromHandlers,
): Promise<ActionResult | undefined> {
    switch (action.actionName) {
        case "extractCurrentPageKnowledge":
            return execute(handlers, ["extractKnowledge"], undefined, context);
        case "answerCurrentPageQuestion":
            return execute(
                handlers,
                ["ask"],
                {
                    args: { question: action.parameters.question },
                    flags: undefined,
                },
                context,
            );
        case "startPageActionRecording":
            return execute(
                handlers,
                ["actions", "record"],
                {
                    args: { name: action.parameters.name },
                    flags: undefined,
                },
                context,
            );
        case "stopPageActionRecording":
            return execute(
                handlers,
                ["actions", "stop", "recording"],
                {
                    args: { description: action.parameters?.description },
                    flags: undefined,
                } as unknown as ParsedCommandParams<ParameterDefinitions>,
                context,
            );
    }
}
