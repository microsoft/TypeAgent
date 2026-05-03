// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    CommandHandlerContext,
    getRequestId,
} from "../../commandHandlerContext.js";
import { ManageConversationPayload } from "../manageConversationPayload.js";

// Each handler dispatches the same "manage-conversation" client action
// emitted by the natural-language conversationActionHandler — so the CLI
// and Shell already know how to render the result.
function dispatchManageConversation(
    context: ActionContext<CommandHandlerContext>,
    payload: ManageConversationPayload,
): void {
    const systemContext = context.sessionContext.agentContext;
    systemContext.clientIO.takeAction(
        getRequestId(systemContext),
        "manage-conversation",
        payload,
    );
}

class ConversationNewCommandHandler implements CommandHandler {
    public readonly description =
        "Create a new conversation, optionally with a name";
    public readonly parameters = {
        args: {
            name: {
                description: "Name for the new conversation (optional)",
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { name } = params.args;
        dispatchManageConversation(
            context,
            name ? { subcommand: "new", name } : { subcommand: "new" },
        );
    }
}

class ConversationListCommandHandler implements CommandHandlerNoParams {
    public readonly description = "List all conversations";
    public async run(context: ActionContext<CommandHandlerContext>) {
        dispatchManageConversation(context, { subcommand: "list" });
    }
}

class ConversationInfoCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show info about the current conversation";
    public async run(context: ActionContext<CommandHandlerContext>) {
        dispatchManageConversation(context, { subcommand: "info" });
    }
}

class ConversationSwitchCommandHandler implements CommandHandler {
    public readonly description =
        "Switch to a conversation by name (defaults to the next conversation in the list)";
    public readonly parameters = {
        args: {
            name: {
                description:
                    "Name of the conversation to switch to (omit to cycle to the next)",
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { name } = params.args;
        dispatchManageConversation(
            context,
            name ? { subcommand: "switch", name } : { subcommand: "next" },
        );
    }
}

class ConversationPrevCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Switch to the previous conversation in the list (wraps around)";
    public async run(context: ActionContext<CommandHandlerContext>) {
        dispatchManageConversation(context, { subcommand: "prev" });
    }
}

class ConversationNextCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Switch to the next conversation in the list (wraps around)";
    public async run(context: ActionContext<CommandHandlerContext>) {
        dispatchManageConversation(context, { subcommand: "next" });
    }
}

class ConversationRenameCommandHandler implements CommandHandler {
    public readonly description =
        "Rename a conversation. With one argument, renames the current conversation; with two, renames the named conversation.";
    public readonly parameters = {
        args: {
            nameOrNewName: {
                description:
                    "New name (renames current) or existing name (when newName given)",
            },
            newName: {
                description: "New name when renaming a specific conversation",
                optional: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const { nameOrNewName, newName } = params.args;
        const payload: ManageConversationPayload =
            newName !== undefined
                ? {
                      subcommand: "rename",
                      name: nameOrNewName,
                      newName,
                  }
                : { subcommand: "rename", newName: nameOrNewName };
        dispatchManageConversation(context, payload);
    }
}

class ConversationDeleteCommandHandler implements CommandHandler {
    public readonly description = "Delete a conversation by name";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the conversation to delete",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        dispatchManageConversation(context, {
            subcommand: "delete",
            name: params.args.name,
        });
    }
}

export function getConversationCommandHandlers(): CommandHandlerTable {
    return {
        description: "Conversation management commands",
        commands: {
            new: new ConversationNewCommandHandler(),
            list: new ConversationListCommandHandler(),
            info: new ConversationInfoCommandHandler(),
            switch: new ConversationSwitchCommandHandler(),
            prev: new ConversationPrevCommandHandler(),
            next: new ConversationNextCommandHandler(),
            rename: new ConversationRenameCommandHandler(),
            delete: new ConversationDeleteCommandHandler(),
        },
    };
}
