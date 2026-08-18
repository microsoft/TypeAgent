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
import type { CommandHandlerContext } from "../../commandHandlerContext.js";
import { ConstructionAction } from "../schema/constructionActionSchema.js";
import {
    CommandParams,
    ActionParams,
    actionParams,
    opt,
} from "./actionParams.js";

const STORE_CMDS: Record<string, string> = {
    newConstructionStore: "new",
    loadConstructionStore: "load",
    saveConstructionStore: "save",
};

function executeConstructionStoreAction(
    actionName: string,
    p: ActionParams,
    execute: (
        commands: string[],
        params?: CommandParams,
    ) => Promise<ActionResult | undefined>,
): Promise<ActionResult | undefined> {
    return execute([STORE_CMDS[actionName]], {
        args: { ...opt(p.file, "file") },
        flags: {},
    });
}

export function executeConstructionAction(
    action: TypeAgentAction<ConstructionAction, "system.construction">,
    context: ActionContext<CommandHandlerContext>,
    handlers: CommandHandlerTable,
): Promise<ActionResult | undefined> {
    const execute = (commands: string[], params?: CommandParams) =>
        executeCommandFromHandlers(handlers, commands, params, context);
    const toggle = (commands: string[], enabled: boolean) =>
        execute([...commands, enabled ? "on" : "off"]);
    const p = actionParams(action);

    if (action.actionName in STORE_CMDS) {
        return executeConstructionStoreAction(action.actionName, p, execute);
    }

    switch (action.actionName) {
        case "setConstructionAutoSave":
            return toggle(["auto"], p.enabled);
        case "disableConstructionStore":
            return execute(["off"]);
        case "showConstructionInfo":
            return execute(["info"]);
        case "listConstructions":
            return execute(["list"], {
                args: {},
                flags: {
                    verbose: p.verbose ?? false,
                    all: p.allMatchStrings ?? false,
                    builtin: p.builtIn ?? false,
                    ...opt(p.match, "match"),
                    ...opt(p.part, "part"),
                    ...opt(p.ids, "id"),
                },
            } as unknown as CommandParams);
        case "importConstructions":
            return execute(["import"], {
                args: { ...opt(p.files, "file") },
                flags: { extended: p.extended ?? false },
            } as unknown as CommandParams);
        case "pruneConstructions":
            return execute(["prune"]);
        case "deleteConstruction":
            return execute(["delete"], {
                args: { namespace: p.namespace, id: p.id },
                flags: {},
            });
        case "setBuiltInConstructionCache":
            return toggle(["builtin"], p.enabled);
        case "setConstructionMerge":
            return toggle(["merge"], p.enabled);
        case "setWildcardMatching":
            return toggle(["wildcard"], p.enabled);
        case "setEntityWildcardMatching":
            return toggle(["wildcard", "entity"], p.enabled);
        default:
            throw new Error(
                `Unknown construction action: ${(action as ConstructionAction).actionName}`,
            );
    }
}
