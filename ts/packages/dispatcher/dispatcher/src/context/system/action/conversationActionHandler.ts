// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { processCommandNoLock } from "../../../command/command.js";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { ConversationAction } from "../schema/conversationActionSchema.js";
import { ActionContext, TypeAgentAction } from "@typeagent/agent-sdk";

// Quote a conversation name so the command parser keeps it as a single
// argument; names often contain spaces (and, rarely, quotes).
function quoteName(name: string): string {
    return `"${name.replace(/"/g, '\\"')}"`;
}

// Each conversation action runs its equivalent `@conversation` command, which
// owns the actual work (forwarding the manage-conversation payload to the
// client). This mirrors the history agent and keeps the command canonical, so
// the two paths cannot drift.
export async function executeConversationAction(
    action: TypeAgentAction<ConversationAction>,
    context: ActionContext<CommandHandlerContext>,
) {
    const systemContext = context.sessionContext.agentContext;
    let resultEntity: { name: string; type: string[] } | undefined;
    let command: string;
    switch (action.actionName) {
        case "newConversation": {
            // Grammar matches that emit `parameters: {}` are normalized away
            // by the grammar engine, so `action.parameters` may be missing on
            // grammar-cache hits even though the schema marks it required.
            const name = action.parameters?.name;
            command = name
                ? `@conversation new ${quoteName(name)}`
                : "@conversation new";
            resultEntity = {
                name: name ?? "new conversation",
                type: ["conversation"],
            };
            break;
        }
        case "listConversation":
            command = "@conversation list";
            break;
        case "findConversation":
            command = `@conversation find ${action.parameters.query}`;
            break;
        case "searchConversation":
            command = `@conversation search ${action.parameters.query}`;
            break;
        case "showConversationInfo":
            command = "@conversation info";
            break;
        case "switchConversation":
            command = `@conversation switch ${quoteName(action.parameters.name)}`;
            break;
        case "nextConversation":
            command = "@conversation next";
            break;
        case "prevConversation":
            command = "@conversation prev";
            break;
        case "renameConversation": {
            const { name, newName } = action.parameters;
            command = name
                ? `@conversation rename ${quoteName(name)} ${quoteName(newName)}`
                : `@conversation rename ${quoteName(newName)}`;
            resultEntity = {
                name: newName,
                type: ["conversation"],
            };
            break;
        }
        case "deleteConversation":
            command = `@conversation delete ${quoteName(action.parameters.name)}`;
            break;
        case "help":
            command = "@conversation help";
            break;
        default:
            throw new Error(
                `Invalid action name: ${(action as { actionName: string }).actionName}`,
            );
    }

    await processCommandNoLock(command, systemContext);
    return { entities: [], resultEntity };
}
