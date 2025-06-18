// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    Entity,
    ParsedCommandParams,
} from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { ChatHistoryEntry } from "../../chatHistory.js";
import { SchemaCreator as sc, validateType } from "action-schema";
import { checkOverwriteFile } from "../../../utils/commandHandlerUtils.js";
import fs from "node:fs";
import { expandHome } from "../../../utils/fsUtils.js";

class HistoryListCommandHandler implements CommandHandlerNoParams {
    public readonly description = "List history";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const systemContext = context.sessionContext.agentContext;
        const history = systemContext.chatHistory;

        let index = 0;
        const output = [];
        for (const entry of history.entries) {
            output.push(`${index}: ${JSON.stringify(entry, undefined, 2)}`);
            index++;
        }

        displayResult(output, context);
    }
}

class HistoryClearCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Clear the history";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const systemContext = context.sessionContext.agentContext;
        const history = systemContext.chatHistory;

        history.entries.length = 0;

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
        const { index } = param.args;

        if (index < 0 || index >= systemContext.chatHistory.entries.length) {
            throw new Error(
                `The supplied index (${index}) is outside the range of available indices (0, ${systemContext.chatHistory.entries.length})`,
            );
        } else if (isNaN(index)) {
            throw new Error(
                `The supplied value '${index}' is not a valid index.`,
            );
        }

        systemContext.chatHistory.entries.splice(index, 1);
        displayResult(
            `Message ${index} deleted. ${systemContext.chatHistory.entries.length} messages remain in the chat history.`,
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

        await fs.promises.writeFile(
            filename,
            JSON.stringify(systemContext.chatHistory.entries, null, 2),
        );
        displayResult(`Chat history saved to ${filename}.`, context);
    }
}

type ChatHistoryInputAssistant = {
    text: string;
    source: string;
    entities?: Entity[];
    additionalInstructions?: string[];
};
export type ChatHistoryInput = {
    user: string;
    assistant: ChatHistoryInputAssistant | ChatHistoryInputAssistant[];
};

function convertAssistantMessage(
    entries: ChatHistoryEntry[],
    message: ChatHistoryInputAssistant,
) {
    entries.push({
        role: "assistant",
        text: message.text,
        sourceAppAgentName: message.source,
        entities: message.entities,
        additionalInstructions: message.additionalInstructions,
    });
}

function convertChatHistoryInputEntry(
    entries: ChatHistoryEntry[],
    message: ChatHistoryInput,
) {
    entries.push({
        role: "user",
        text: message.user,
    });
    const assistant = message.assistant;
    if (Array.isArray(assistant)) {
        assistant.forEach((m) => convertAssistantMessage(entries, m));
    } else {
        convertAssistantMessage(entries, assistant);
    }
}

function getChatHistoryInput(
    message: ChatHistoryInput | ChatHistoryInput[],
): ChatHistoryEntry[] {
    const entries: ChatHistoryEntry[] = [];
    if (Array.isArray(message)) {
        message.forEach((m) => convertChatHistoryInputEntry(entries, m));
    } else {
        convertChatHistoryInputEntry(entries, message);
    }
    return entries;
}

const assistantInputSchema = sc.obj({
    text: sc.string(),
    source: sc.string(),
    entities: sc.optional(
        sc.array(
            sc.obj({
                name: sc.string(),
                type: sc.array(sc.string()),
                uniqueId: sc.optional(sc.string()),
            }),
        ),
    ),
    additionalInstructions: sc.optional(sc.array(sc.string())),
});

const messageInputSchema = sc.obj({
    user: sc.string(),
    assistant: sc.union(assistantInputSchema, sc.array(assistantInputSchema)),
});

const chatHistoryInputSchema = sc.union(
    messageInputSchema,
    sc.array(messageInputSchema),
);

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
        const { messages } = param.args;

        if (messages.length === 0) {
            throw new Error("No messages to insert.");
        }

        validateType(chatHistoryInputSchema, messages);

        const chatHistoryInput = getChatHistoryInput(
            messages as unknown as ChatHistoryInput | ChatHistoryInput[],
        );
        systemContext.chatHistory.entries.push(...chatHistoryInput);

        const messageCount = Array.isArray(messages) ? messages.length : 1;
        displayResult(
            `Inserted ${messageCount} entries, ${chatHistoryInput.length} messages into chat history. ${systemContext.chatHistory.entries.length} messages in total.`,
            context,
        );
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
        },
    };
}
