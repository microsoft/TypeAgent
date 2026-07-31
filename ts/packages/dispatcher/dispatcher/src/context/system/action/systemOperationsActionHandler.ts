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
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { SystemOperationsAction } from "../schema/systemOperationsActionSchema.js";

export function executeSystemOperationsAction(
    action: TypeAgentAction<SystemOperationsAction, "system.operations">,
    context: ActionContext<CommandHandlerContext>,
    systemHandlers: CommandHandlerTable,
): Promise<ActionResult | undefined> {
    const execute = (commands: string[], params?: ParsedCommandParams<any>) =>
        executeCommandFromHandlers(systemHandlers, commands, params, context);

    switch (action.actionName) {
        case "executeTypedAction": {
            const actionParameters =
                action.parameters.actionParametersJson === undefined
                    ? undefined
                    : JSON.parse(action.parameters.actionParametersJson);
            return execute(["action"], {
                args: {
                    schemaName: action.parameters.schemaName,
                    actionName: action.parameters.actionName,
                },
                flags: {
                    ...(actionParameters === undefined
                        ? {}
                        : { parameters: actionParameters }),
                    ...(action.parameters.naturalLanguage === undefined
                        ? {}
                        : {
                              naturalLanguage:
                                  action.parameters.naturalLanguage,
                          }),
                },
            } as unknown as ParsedCommandParams<any>);
        }
        case "clearConsole":
            return execute(["clear"]);
        case "deepClearConsole":
            return execute(["clear", "deep"]);
        case "startDebugger":
            return execute(["debug"]);
        case "showQuestionCards":
            return execute(["demo", "questionCards"], {
                args: {},
                flags: { paged: action.parameters?.paged ?? false },
            });
        case "displayContent":
            return execute(["display"], {
                args: { text: action.parameters.content },
                flags: {
                    speak: action.parameters.speak ?? false,
                    type: action.parameters.type ?? "text",
                    inline: action.parameters.inline ?? false,
                },
            } as unknown as ParsedCommandParams<any>);
        case "exitTypeAgent":
            return execute(["exit"]);
        case "showCommandHelp":
            return execute(["help"], {
                args: {
                    ...(action.parameters?.command === undefined
                        ? {}
                        : { command: action.parameters.command }),
                },
                flags: { all: action.parameters?.all ?? false },
            });
        case "openFolder":
            return execute(["open"], {
                args: { folder: action.parameters.folder },
                flags: {},
            });
        case "listRegisteredPorts":
            return execute(["ports"], { args: {}, flags: {} });
        case "runCommandScript":
            return execute(["run"], {
                args: { input: action.parameters.input },
                flags: {},
            });
        case "restartAgentServer":
            return execute(["server", "restart"]);
        case "shutdownAgentServer":
            return execute(["shutdown"]);
        case "configureTrace":
            return execute(["trace"], {
                args: {
                    ...(action.parameters?.namespaces === undefined
                        ? {}
                        : { namespaces: action.parameters.namespaces }),
                },
                flags: { clear: action.parameters?.clear ?? false },
            } as unknown as ParsedCommandParams<any>);
    }
}
