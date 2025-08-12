// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";

import { checkOverwriteFile } from "../../../utils/commandHandlerUtils.js";
import fs from "node:fs";
import { expandHome } from "../../../utils/fsUtils.js";
import { isChatHistoryInput } from "../../chatHistory.js";
import { setActivityContext } from "../../../execute/activityContext.js";

class HistoryListCommandHandler implements CommandHandlerNoParams {
    public readonly description = "List history";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const systemContext = context.sessionContext.agentContext;
        const history = systemContext.chatHistory;
        displayResult(history.getStrings(), context);
    }
}

class HistoryClearCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Clear the history";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const systemContext = context.sessionContext.agentContext;
        const history = systemContext.chatHistory;
        history.clear();
        displayResult("Chat history cleared.", context);
    }
}

class HistoryDeleteCommandHandler implements CommandHandler {
    public readonly description =
        "Delete a specific message from the chat history";
    public readonly parameters = {
        args: {
            index: {
                description: "Chat history index to delete.",
                type: "number",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        param: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const history = systemContext.chatHistory;
        const { index } = param.args;
        history.delete(index);
        displayResult(
            `Message ${index} deleted. ${history.count()} messages remain in the chat history.`,
            context,
        );
    }
}

class HistorySaveCommandHandler implements CommandHandler {
    public readonly description: string = "Save the chat history to a file";
    public readonly parameters = {
        args: {
            file: {
                description: "File to save the chat history to",
                type: "string",
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        param: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const { file } = param.args;

        if (!file) {
            throw new Error("Filename is required to save chat history.");
        }

        const filename = expandHome(file);

        await checkOverwriteFile(filename, systemContext);

        const data = systemContext.chatHistory.export();
        if (data === undefined) {
            throw new Error("No chat history to save.");
        }
        await fs.promises.writeFile(filename, JSON.stringify(data, null, 2));

        const count = Array.isArray(data) ? data.length : 1;
        displayResult(
            `${count} chat history input entries saved to ${filename}.`,
            context,
        );
    }
}

class HistoryInsertCommandHandler implements CommandHandler {
    public readonly description = "Insert messages to chat history";
    public readonly parameters = {
        args: {
            messages: {
                description: "Chat history messages to insert",
                type: "json",
                implicitQuotes: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        param: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const history = systemContext.chatHistory;
        const { messages } = param.args;

        const messageCount = Array.isArray(messages) ? messages.length : 1;
        if (messageCount === 0) {
            throw new Error("No messages to insert.");
        }

        if (!isChatHistoryInput(messages)) {
            throw new Error(
                "Invalid chat history input. Please provide a valid array of messages.",
            );
        }

        const prevCount = history.count();
        history.import(messages);
        const currCount = history.count();

        const info = history.getLastActivityContextInfo();
        if (info !== undefined) {
            setActivityContext(
                info.sourceSchemaName,
                info.resultActivityContext,
                systemContext,
            );
        }

        displayResult(
            `Inserted ${messageCount} input entries, ${currCount - prevCount} messages into chat history. Current total ${currCount} messages.`,
            context,
        );
    }
}

class HistoryEntityListCommandHandler implements CommandHandler {
    public readonly description =
        "Shows all of the entities currently in 'working memory.'";
    public readonly parameters = {} as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        param: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const translateConfig = systemContext.session.getConfig().translation;
        const entities = systemContext.chatHistory.getTopKEntities(
            translateConfig.history.limit,
        );

        displayResult(
            entities.map((e) => JSON.stringify(e, null, 2)),
            context,
        );
    }
}

class HistoryEntityDeleteCommandHandler implements CommandHandler {
    public readonly description =
        "Delete entities from the chat history (working memory).";
    public readonly parameters = {
        args: {
            entityId: {
                description: "The UniqueId of the entity",
                type: "string",
                implicitQuotes: true,
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        param: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const entityId = param.args.entityId;

        const deleted = systemContext.chatHistory.deleteEntityById(entityId);

        if (deleted) {
            displayResult(`Entity with id '${entityId}' was deleted.`, context);
        } else {
            displayResult(
                `Entity with id '${entityId}' was not deleted because it was not found.`,
                context,
            );
        }
    }
}

export function getHistoryCommandHandlers(): CommandHandlerTable {
    return {
        description: "History commands",
        defaultSubCommand: "list",
        commands: {
            list: new HistoryListCommandHandler(),
            clear: new HistoryClearCommandHandler(),
            delete: new HistoryDeleteCommandHandler(),
            insert: new HistoryInsertCommandHandler(),
            save: new HistorySaveCommandHandler(),
            entities: {
                description: "History entity commands",
                defaultSubCommand: "list",
                commands: {
                    list: new HistoryEntityListCommandHandler(),
                    delete: new HistoryEntityDeleteCommandHandler(),
                },
            },
        },
    };
}
