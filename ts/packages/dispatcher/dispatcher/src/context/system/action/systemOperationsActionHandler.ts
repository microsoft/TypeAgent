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

/** Returns `{ [key]: value }` when value is defined, `{}` otherwise. */
function opt(value: unknown, key: string): Record<string, unknown> {
    return value !== undefined ? { [key]: value } : {};
}

export function executeSystemOperationsAction(
    action: TypeAgentAction<SystemOperationsAction, "system.operations">,
    context: ActionContext<CommandHandlerContext>,
    systemHandlers: CommandHandlerTable,
): Promise<ActionResult | undefined> {
    const execute = (commands: string[], params?: ParsedCommandParams<any>) =>
        executeCommandFromHandlers(systemHandlers, commands, params, context);
    const p: any = action.parameters;

    switch (action.actionName) {
        case "executeTypedAction": {
            const actionParameters =
                p.actionParametersJson === undefined
                    ? undefined
                    : JSON.parse(p.actionParametersJson);
            return execute(["action"], {
                args: {
                    schemaName: p.schemaName,
                    actionName: p.actionName,
                },
                flags: {
                    ...opt(actionParameters, "parameters"),
                    ...opt(p.naturalLanguage, "naturalLanguage"),
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
                flags: { paged: p.paged ?? false },
            });
        case "displayContent":
            return execute(["display"], {
                args: { text: p.content },
                flags: {
                    speak: p.speak ?? false,
                    type: p.type ?? "text",
                    inline: p.inline ?? false,
                },
            } as unknown as ParsedCommandParams<any>);
        case "exitTypeAgent":
            return execute(["exit"]);
        case "showCommandHelp":
            return execute(["help"], {
                args: { ...opt(p.command, "command") },
                flags: { all: p.all ?? false },
            });
        case "openFolder":
            return execute(["open"], {
                args: { folder: p.folder },
                flags: {},
            });
        case "listRegisteredPorts":
            return execute(["ports"], { args: {}, flags: {} });
        case "runCommandScript":
            return execute(["run"], {
                args: { input: p.input },
                flags: {},
            });
        case "restartAgentServer":
            return execute(["server", "restart"]);
        case "shutdownAgentServer":
            return execute(["shutdown"]);
        case "configureTrace":
            return execute(["trace"], {
                args: { ...opt(p.namespaces, "namespaces") },
                flags: { clear: p.clear ?? false },
            } as unknown as ParsedCommandParams<any>);
        default:
            throw new Error(
                `Unknown system operations action: ${action.actionName}`,
            );
    }
}
