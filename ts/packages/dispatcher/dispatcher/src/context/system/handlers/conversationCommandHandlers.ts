// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import type {
    CompletionGroups,
    DisplayContent,
    PartialParsedCommandParams,
    SessionContext,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { displayWarn } from "@typeagent/agent-sdk/helpers/display";
import {
    CommandHandlerContext,
    ConversationIndexTarget,
    getRequestId,
} from "../../commandHandlerContext.js";
import {
    renderConversationIndexProgress,
    renderConversationIndexSummary,
} from "../conversationIndexProgress.js";
import { ManageConversationPayload } from "../manageConversationPayload.js";
import registerDebug from "debug";

const debugIndex = registerDebug("dispatcher:conversation:index");

// Forward the manage-conversation payload to the client, which performs the
// actual switch/rename/etc. The equivalent conversation action runs these
// commands (see conversationActionHandler), so the payload is built in exactly
// one place. Each handler's `action` property records that equivalence for
// tooling such as the action browser.
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
        dispatchManageConversation(
            context,
            name ? { subcommand: "new", name } : { subcommand: "new" },
        );
    }
}

class ConversationListCommandHandler implements CommandHandlerNoParams {
    public readonly description = "List all conversations";
    public readonly action = "listConversation";
    public async run(context: ActionContext<CommandHandlerContext>) {
        dispatchManageConversation(context, { subcommand: "list" });
    }
}

class ConversationInfoCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show info about the current conversation";
    public readonly action = "showConversationInfo";
    public async run(context: ActionContext<CommandHandlerContext>) {
        dispatchManageConversation(context, { subcommand: "info" });
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
        dispatchManageConversation(
            context,
            name ? { subcommand: "switch", name } : { subcommand: "next" },
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
        dispatchManageConversation(context, { subcommand: "prev" });
    }
}

class ConversationNextCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Switch to the next conversation in the list (wraps around)";
    public readonly action = "nextConversation";
    public async run(context: ActionContext<CommandHandlerContext>) {
        dispatchManageConversation(context, { subcommand: "next" });
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
        const payload: ManageConversationPayload =
            newName !== undefined
                ? { subcommand: "rename", name: nameOrNewName, newName }
                : { subcommand: "rename", newName: nameOrNewName };
        dispatchManageConversation(context, payload);
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
        dispatchManageConversation(context, {
            subcommand: "delete",
            name: params.args.name,
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

class ConversationFindCommandHandler implements CommandHandler {
    public readonly description =
        "Fuzzy-find conversations by name (lexical + embedding)";
    public readonly action = "findConversation";
    public readonly parameters = {
        args: {
            query: {
                description: "Name (or approximate name) to search for",
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        dispatchManageConversation(context, {
            subcommand: "find",
            query: params.args.query,
        });
    }
}

class ConversationSearchCommandHandler implements CommandHandler {
    public readonly description =
        "Search conversation content (knowPro message index)";
    public readonly action = "searchConversation";
    public readonly parameters = {
        args: {
            query: {
                description: "Text to search for across conversation content",
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        dispatchManageConversation(context, {
            subcommand: "search",
            query: params.args.query,
        });
    }
}

class ConversationIndexCommandHandler implements CommandHandler {
    public readonly description =
        "Index conversation history so its content is searchable across conversations";
    public readonly action = "indexConversation";
    public readonly parameters = {
        args: {
            name: {
                description:
                    "Conversation to index by name, or 'all' for every conversation. Omit to index the current conversation.",
                optional: true,
                implicitQuotes: true,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ): Promise<void> {
        const systemContext = context.sessionContext.agentContext;
        const indexer = systemContext.indexConversations;
        if (indexer === undefined) {
            displayWarn(
                "Conversation content indexing is not available in this host.",
                context,
            );
            return;
        }
        const { name } = params.args;
        const target: ConversationIndexTarget =
            name === undefined
                ? { scope: "current" }
                : name.toLowerCase() === "all"
                  ? { scope: "all" }
                  : { scope: "named", name };

        // Non-blocking: create the progress bubble now, then index in the
        // background and replace that bubble in place via clientIO.setDisplay
        // (keyed by requestId) so the agent stays usable while indexing runs.
        const requestId = getRequestId(systemContext);
        const asMessage = (content: DisplayContent) => ({
            message: content,
            requestId,
            source: "system",
            actionIndex: 0,
        });
        const setBar = (content: DisplayContent) =>
            systemContext.clientIO.setDisplay(asMessage(content));
        systemContext.clientIO.appendDisplay(
            asMessage(renderConversationIndexProgress({ done: 0, total: 0 })),
            "block",
        );
        debugIndex("started (%s)", name ?? "current");
        void indexer(target, (progress) => {
            debugIndex(
                "progress %d/%d (%s)",
                progress.done,
                progress.total,
                progress.name,
            );
            setBar(renderConversationIndexProgress(progress));
        })
            .then((result) => {
                debugIndex("finished: %o", result);
                setBar(
                    result.notFound !== undefined
                        ? `No conversation named "${result.notFound}".`
                        : renderConversationIndexSummary(result.indexed),
                );
            })
            .catch((e) => {
                const message = e instanceof Error ? e.message : String(e);
                debugIndex("failed: %s", message);
                setBar(`Indexing failed: ${message}`);
            });
    }
    public async getCompletion(
        context: SessionContext<CommandHandlerContext>,
        _params: PartialParsedCommandParams<typeof this.parameters>,
        names: string[],
    ): Promise<CompletionGroups> {
        // Offer existing conversation names plus the special "all" target.
        const groups = completeConversationName(context, names, "name");
        if (names.includes("name")) {
            groups.groups.push({ name: "all", completions: ["all"] });
        }
        return groups;
    }
}

class ConversationHelpCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show conversation command help";
    public readonly action = "help";
    public async run(context: ActionContext<CommandHandlerContext>) {
        dispatchManageConversation(context, { subcommand: "help" });
    }
}

export function getConversationCommandHandlers(): CommandHandlerTable {
    return {
        description: "Conversation management commands",
        defaultSubCommand: "help",
        commands: {
            new: new ConversationNewCommandHandler(),
            list: new ConversationListCommandHandler(),
            find: new ConversationFindCommandHandler(),
            search: new ConversationSearchCommandHandler(),
            index: new ConversationIndexCommandHandler(),
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
