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
import { ConstructionAction } from "../schema/constructionActionSchema.js";

export function executeConstructionAction(
    action: TypeAgentAction<ConstructionAction, "system.construction">,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable,
): Promise<ActionResult | undefined> {
    const execute = (commands: string[], params?: ParsedCommandParams<any>) =>
        executeCommandFromHandlers(handlers, commands, params, context);
    const toggle = (commands: string[], enabled: boolean) =>
        execute([...commands, enabled ? "on" : "off"]);

    switch (action.actionName) {
        case "newConstructionStore":
        case "loadConstructionStore":
        case "saveConstructionStore":
            return execute(
                [
                    action.actionName === "newConstructionStore"
                        ? "new"
                        : action.actionName === "loadConstructionStore"
                          ? "load"
                          : "save",
                ],
                {
                    args: {
                        ...(action.parameters?.file === undefined
                            ? {}
                            : { file: action.parameters.file }),
                    },
                    flags: {},
                },
            );
        case "setConstructionAutoSave":
            return toggle(["auto"], action.parameters.enabled);
        case "disableConstructionStore":
            return execute(["off"]);
        case "showConstructionInfo":
            return execute(["info"]);
        case "listConstructions":
            return execute(["list"], {
                args: {},
                flags: {
                    verbose: action.parameters?.verbose ?? false,
                    all: action.parameters?.allMatchStrings ?? false,
                    builtin: action.parameters?.builtIn ?? false,
                    ...(action.parameters?.match === undefined
                        ? {}
                        : { match: action.parameters.match }),
                    ...(action.parameters?.part === undefined
                        ? {}
                        : { part: action.parameters.part }),
                    ...(action.parameters?.ids === undefined
                        ? {}
                        : { id: action.parameters.ids }),
                },
            } as unknown as ParsedCommandParams<any>);
        case "importConstructions":
            return execute(["import"], {
                args: {
                    ...(action.parameters?.files === undefined
                        ? {}
                        : { file: action.parameters.files }),
                },
                flags: {
                    extended: action.parameters?.extended ?? false,
                },
            } as unknown as ParsedCommandParams<any>);
        case "pruneConstructions":
            return execute(["prune"]);
        case "deleteConstruction":
            return execute(["delete"], {
                args: {
                    namespace: action.parameters.namespace,
                    id: action.parameters.id,
                },
                flags: {},
            });
        case "setBuiltInConstructionCache":
            return toggle(["builtin"], action.parameters.enabled);
        case "setConstructionMerge":
            return toggle(["merge"], action.parameters.enabled);
        case "setWildcardMatching":
            return toggle(["wildcard"], action.parameters.enabled);
        case "setEntityWildcardMatching":
            return toggle(["wildcard", "entity"], action.parameters.enabled);
    }
}
