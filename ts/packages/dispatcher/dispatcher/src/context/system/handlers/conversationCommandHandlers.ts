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

// Each handler dispatches the same "manage-conversation" client action
// emitted by the natural-language conversationActionHandler — so the CLI
// and Shell already know how to render the result.
function dispatchManageConversation(
    context: ActionContext<CommandHandlerContext>,
    payload: { subcommand: string; name?: string; newName?: string },
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
    public readonly description = "Switch to an existing conversation";
    public readonly parameters = {
        args: {
            name: {
                description: "Name of the conversation to switch to",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        dispatchManageConversation(context, {
            subcommand: "switch",
            name: params.args.name,
        });
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
        const payload: { subcommand: string; name?: string; newName: string } =
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
            rename: new ConversationRenameCommandHandler(),
            delete: new ConversationDeleteCommandHandler(),
        },
    };
}
