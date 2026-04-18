// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getRequestId } from "../../commandHandlerContext.js";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { SessionAction } from "../schema/sessionActionSchema.js";
import { ActionContext, TypeAgentAction } from "@typeagent/agent-sdk";

export async function executeSessionAction(
    action: TypeAgentAction<SessionAction>,
    context: ActionContext<CommandHandlerContext>,
) {
    const agentContext = context.sessionContext.agentContext;
    const requestId = getRequestId(agentContext);
    let payload: { subcommand: string; name?: string; newName?: string };

    let resultEntity: { name: string; type: string[] } | undefined;

    switch (action.actionName) {
        case "newSession": {
            const name = action.parameters.name;
            payload = name
                ? { subcommand: "new", name }
                : { subcommand: "new" };
            resultEntity = {
                name: name ?? "new conversation",
                type: ["conversation", "session"],
            };
            break;
        }
        case "listSession":
            payload = { subcommand: "list" };
            break;
        case "showConversationInfo":
            payload = { subcommand: "info" };
            break;
        case "switchSession":
            payload = { subcommand: "switch", name: action.parameters.name };
            break;
        case "renameSession": {
            const renameName = action.parameters.name;
            payload = renameName
                ? {
                      subcommand: "rename",
                      name: renameName,
                      newName: action.parameters.newName,
                  }
                : { subcommand: "rename", newName: action.parameters.newName };
            resultEntity = {
                name: action.parameters.newName,
                type: ["conversation", "session"],
            };
            break;
        }
        case "deleteSession":
            payload = { subcommand: "delete", name: action.parameters.name };
            break;
        default:
            throw new Error(
                `Invalid action name: ${(action as { actionName: string }).actionName}`,
            );
    }

    agentContext.clientIO.takeAction(requestId, "manage-conversation", payload);
    return { entities: [], resultEntity };
}
