// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import type {
    CompletionGroups,
    PartialParsedCommandParams,
    SessionContext,
    TypeAgentAction,
} from "@typeagent/agent-sdk";
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
import { ConversationAction } from "../schema/conversationActionSchema.js";
import { executeConversationAction } from "../action/conversationActionHandler.js";

// A @conversation command runs its equivalent conversation action, so the
// subcommand-to-payload mapping lives only in executeConversationAction and the
// two paths cannot drift. Each handler's `action` property records that
// equivalence for tooling such as the action browser.
function runConversationAction(
    context: ActionContext<CommandHandlerContext>,
    action: ConversationAction,
) {
    return executeConversationAction(
        action as TypeAgentAction<ConversationAction>,
        context,
    );
}

// Offer existing conversation names as completions for the given argument.
// The list is provided by the host (agentServer's ConversationManager) via
// context.getConversationList; standalone hosts return no completions. Because
// completion is served by the dispatcher, every client (CLI, shells, browser)
// gets these suggestions through the same path with no client-side work.
function completeConversationName(
    context: SessionContext<CommandHandlerContext>,
    names: string[],
    argName: string,
): CompletionGroups {
    const groups: CompletionGroups = { groups: [] };
    if (!names.includes(argName)) {
        return groups;
    }
    const conversations = context.agentContext.getConversationList?.() ?? [];
    if (conversations.length === 0) {
        return groups;
    }
    groups.groups.push({
        name: "conversation",
        completions: conversations.map((c) => c.name),
        // Names frequently contain spaces (e.g. imported Copilot summaries);
        // quote them so they parse as a single argument.
        needQuotes: true,
    });
    return groups;
}

class ConversationNewCommandHandler implements CommandHandler {
    public readonly description =
        "Create a new conversation, optionally with a name";
    public readonly action = "newConversation";
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
        return runConversationAction(context, {
            actionName: "newConversation",
            parameters: name !== undefined ? { name } : {},
        });
    }
}

class ConversationListCommandHandler implements CommandHandlerNoParams {
    public readonly description = "List all conversations";
    public readonly action = "listConversation";
    public async run(context: ActionContext<CommandHandlerContext>) {
        return runConversationAction(context, {
            actionName: "listConversation",
        });
    }
}

class ConversationInfoCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show info about the current conversation";
    public readonly action = "showConversationInfo";
    public async run(context: ActionContext<CommandHandlerContext>) {
        return runConversationAction(context, {
            actionName: "showConversationInfo",
        });
    }
}

class ConversationSwitchCommandHandler implements CommandHandler {
    public readonly description =
        "Switch to a conversation by name (defaults to the next conversation in the list)";
    public readonly action = "switchConversation";
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
        // With no name, cycle to the next conversation (a CLI convenience the
        // switchConversation action does not have).
        return runConversationAction(
            context,
            name
                ? { actionName: "switchConversation", parameters: { name } }
                : { actionName: "nextConversation" },
        );
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<CompletionGroups> {
        return completeConversationName(context, names, "name");
    }
}

class ConversationPrevCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Switch to the previous conversation in the list (wraps around)";
    public readonly action = "prevConversation";
    public async run(context: ActionContext<CommandHandlerContext>) {
        return runConversationAction(context, {
            actionName: "prevConversation",
        });
    }
}

class ConversationNextCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Switch to the next conversation in the list (wraps around)";
    public readonly action = "nextConversation";
    public async run(context: ActionContext<CommandHandlerContext>) {
        return runConversationAction(context, {
            actionName: "nextConversation",
        });
    }
}

class ConversationRenameCommandHandler implements CommandHandler {
    public readonly description =
        "Rename a conversation. With one argument, renames the current conversation; with two, renames the named conversation.";
    public readonly action = "renameConversation";
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
        return runConversationAction(
            context,
            newName !== undefined
                ? {
                      actionName: "renameConversation",
                      parameters: { name: nameOrNewName, newName },
                  }
                : {
                      actionName: "renameConversation",
                      parameters: { newName: nameOrNewName },
                  },
        );
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<CompletionGroups> {
        // First arg can name an existing conversation (when a second arg is
        // supplied); offer existing names there. The new-name arg is freeform.
        return completeConversationName(context, names, "nameOrNewName");
    }
}

class ConversationDeleteCommandHandler implements CommandHandler {
    public readonly description = "Delete a conversation by name";
    public readonly action = "deleteConversation";
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
        return runConversationAction(context, {
            actionName: "deleteConversation",
            parameters: { name: params.args.name },
        });
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<CompletionGroups> {
        return completeConversationName(context, names, "name");
    }
}

class ConversationHelpCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show conversation command help";
    public async run(context: ActionContext<CommandHandlerContext>) {
        // No equivalent action; ask the client to render command help.
        const systemContext = context.sessionContext.agentContext;
        const payload: ManageConversationPayload = { subcommand: "help" };
        systemContext.clientIO.takeAction(
            getRequestId(systemContext),
            "manage-conversation",
            payload,
        );
    }
}

export function getConversationCommandHandlers(): CommandHandlerTable {
    return {
        description: "Conversation management commands",
        defaultSubCommand: "help",
        commands: {
            new: new ConversationNewCommandHandler(),
            list: new ConversationListCommandHandler(),
            info: new ConversationInfoCommandHandler(),
            switch: new ConversationSwitchCommandHandler(),
            prev: new ConversationPrevCommandHandler(),
            next: new ConversationNextCommandHandler(),
            rename: new ConversationRenameCommandHandler(),
            delete: new ConversationDeleteCommandHandler(),
            help: new ConversationHelpCommandHandler(),
        },
    };
}
